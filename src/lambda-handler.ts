/**
 * AWS Lambda Handler for Capture MCP Server
 *
 * This module provides a Lambda-compatible entry point that wraps the MCP server
 * with AWS Powertools for observability (Logger, Metrics).
 *
 * Environment Variables:
 * - POWERTOOLS_SERVICE_NAME: Service name for Powertools (default: capture-mcp-server)
 * - POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
 * - API_KEY_BUCKET: S3 bucket for API key validation (optional, enables auth when set)
 * - API_KEY_PREFIX: S3 object key prefix (default: "api-keys/")
 * - SAM_GOV_API_KEY: Default SAM.gov API key (optional)
 * - TANGO_API_KEY: Default Tango API key (optional)
 * - HIGHERGOV_API_KEY: Default HigherGov API key (optional)
 *
 * Headers:
 * - X-Api-Key: Server access API key (required when API_KEY_BUCKET is configured)
 * - X-Sam-Api-Key: SAM.gov API key for tool access
 * - X-Tango-Api-Key: Tango API key for tool access
 * - X-Highergov-Api-Key: HigherGov API key for tool access
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import express, { Request, Response, NextFunction } from 'express';
import { SERVER_VERSION } from './mcp-factory.js';
import { createCaptureMcpHandler } from './mcp-http.js';
import { createS3ApiKeyMiddleware, AuthenticatedRequest } from './middleware/s3-api-key.js';

// Initialize Powertools
const logger = new Logger({
  serviceName: process.env.POWERTOOLS_SERVICE_NAME || 'capture-mcp-server',
});

const metrics = new Metrics({
  serviceName: process.env.POWERTOOLS_SERVICE_NAME || 'capture-mcp-server',
  namespace: process.env.POWERTOOLS_METRICS_NAMESPACE || 'CaptureMCP',
});

/**
 * Creates the Express app for the Lambda handler
 */
function createApp(): express.Application {
  const app = express();
  app.use(express.json());

  // Add request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.appendKeys({
      path: req.path,
      method: req.method,
    });
    next();
  });

  // Health check endpoint (before auth middleware so it's always accessible)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      transport: 'lambda',
      version: SERVER_VERSION,
      protocolVersion: '2026-07-28',
      authMode: process.env.API_KEY_BUCKET ? 's3-api-key' : 'none'
    });
  });

  // Add S3 API key authentication if API_KEY_BUCKET is configured
  if (process.env.API_KEY_BUCKET) {
    logger.info('S3 API key authentication enabled', {
      bucket: process.env.API_KEY_BUCKET,
      prefix: process.env.API_KEY_PREFIX || 'api-keys/'
    });
    app.use(createS3ApiKeyMiddleware());
  } else {
    logger.warn('S3 API key authentication DISABLED - API_KEY_BUCKET not set');
  }

  // Stateless MCP handler serving both the 2026-07-28 protocol and the
  // 2025-era legacy path (JSON responses only — API Gateway +
  // serverless-express cannot stream SSE).
  const handleMcp = createCaptureMcpHandler({
    // API Gateway's buffered Lambda integration cannot carry an unbounded
    // subscriptions/listen SSE response. Zero uses the SDK's bounded,
    // JSON-RPC "Subscription limit reached" response for that method while
    // ordinary modern calls remain single-response JSON.
    maxSubscriptions: 0,
    responseMode: 'json',
    onerror: (error) => {
      if (error.message === 'subscriptions/listen refused: subscription limit reached (0)') {
        logger.info('Subscription stream refused on request/response-only Lambda deployment');
        return;
      }
      logger.error('Error handling MCP request', { error });
      metrics.addMetric('MCPRequestError', MetricUnit.Count, 1);
    },
    onKeysResolved: (resolved, era) => {
      logger.debug('API Key Sources', {
        protocolEra: era,
        samSource: resolved.sources.sam,
        tangoSource: resolved.sources.tango,
        higherGovSource: resolved.sources.highergov,
      });
    },
    onToolCall: (toolName) => {
      logger.info('Tool call started', { toolName });
    },
    onToolResult: (toolName, success, errorMessage) => {
      if (success) {
        logger.info('Tool call completed', { toolName, success: true });
      } else {
        logger.error('Tool call failed', { toolName, error: errorMessage });
      }
    },
  });

  // MCP endpoint
  app.post('/mcp', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const authReq = req as AuthenticatedRequest;

    // Log API key owner if authenticated via S3
    if (authReq.apiKeyOwner) {
      logger.appendKeys({ apiKeyOwner: authReq.apiKeyOwner });
    }

    await handleMcp(req, res);

    logger.info('MCP request handled', {
      writableEnded: res.writableEnded,
      headersSent: res.headersSent,
      latencyMs: Date.now() - startTime
    });

    if (res.statusCode < 500) {
      metrics.addMetric('MCPRequestSuccess', MetricUnit.Count, 1);
    }
    metrics.addMetric('MCPRequestLatency', MetricUnit.Milliseconds, Date.now() - startTime);
  });

  // Handle unsupported methods
  app.all('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: 'Method not allowed. Use POST for MCP requests.'
      },
      id: null
    });
  });

  return app;
}

// Create the Express app
const app = createApp();

// Create the serverless-express handler with promise resolution
const serverlessExpressInstance = serverlessExpress({
  app,
  resolutionMode: 'PROMISE'
});

/**
 * Lambda handler with Powertools instrumentation
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  // Add Lambda context to logger
  logger.addContext(context);

  // Track cold starts
  const isColdStart = (global as any).__COLD_START__ === undefined;
  if (isColdStart) {
    (global as any).__COLD_START__ = true;
    metrics.addMetric('ColdStart', MetricUnit.Count, 1);
  }

  // Log incoming request
  logger.info('Lambda invocation started', {
    requestId: context.awsRequestId,
    path: event.rawPath,
    method: event.requestContext?.http?.method,
    coldStart: isColdStart,
  });

  try {
    // Invoke the serverless-express handler - it returns a promise with resolutionMode: 'PROMISE'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (serverlessExpressInstance as any)(event, context) as APIGatewayProxyResultV2;

    // Log completion
    logger.info('Lambda invocation completed', {
      statusCode: typeof result === 'object' && result && 'statusCode' in result ? result.statusCode : 200,
    });

    // Publish metrics
    metrics.publishStoredMetrics();

    return result;
  } catch (error) {
    logger.error('Lambda invocation failed', { error });

    // Record error metric
    metrics.addMetric('LambdaError', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();

    // Return error response
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      })
    };
  }
};

// Export the app for testing
export { app };
