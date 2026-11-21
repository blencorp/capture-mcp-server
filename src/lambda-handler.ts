/**
 * AWS Lambda Handler for Capture MCP Server
 * 
 * This module provides a Lambda-compatible entry point that wraps the MCP server
 * with AWS Powertools for observability (Logger, Metrics).
 * 
 * Environment Variables:
 * - POWERTOOLS_SERVICE_NAME: Service name for Powertools (default: capture-mcp-server)
 * - POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
 * - API_KEY_BUCKET: S3 bucket for API key validation (REQUIRED: without it /mcp answers 503)
 * - API_KEY_PREFIX: S3 object key prefix (default: "api-keys/")
 *
 * Headers:
 * - X-Api-Key: Server access API key (required)
 * - X-Sam-Api-Key / X-Tango-Api-Key / X-Highergov-Api-Key: the caller's OWN provider keys.
 *   The function never falls back to keys in its environment: provider keys are personal.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import express, { type Request, type Response, type NextFunction } from 'express';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { headerKeys, resolveRequestKeys } from './auth/request-keys.js';
import { createMcpServer } from './http-app.js';
import { registerToolHandlers } from './mcp-handlers.js';
import { SERVER_VERSION } from './version.js';
import { createS3ApiKeyMiddleware, type AuthenticatedRequest } from './middleware/s3-api-key.js';

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
export type LambdaAppOptions = {
  /**
   * Authenticates /mcp callers. Defaults to S3 API-key auth when API_KEY_BUCKET is set; with no
   * authenticator the app refuses MCP requests. Tests inject a fake.
   */
  authenticate?: express.RequestHandler;
};

export function createApp(options: LambdaAppOptions = {}): express.Application {
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
      authMode: options.authenticate ? 'custom' : process.env.API_KEY_BUCKET ? 's3-api-key' : 'unconfigured'
    });
  });

  const authenticate =
    options.authenticate ?? (process.env.API_KEY_BUCKET ? createS3ApiKeyMiddleware() : undefined);
  if (authenticate) {
    logger.info('MCP authentication enabled', {
      mode: options.authenticate ? 'custom' : 's3-api-key',
      prefix: process.env.API_KEY_PREFIX || 'api-keys/',
    });
    app.use(authenticate);
  } else {
    // Fail closed: an unauthenticated function would be open to anyone who finds its URL.
    logger.error('API_KEY_BUCKET is not set; refusing MCP requests');
    app.use('/mcp', (_req: Request, res: Response) => {
      res.status(503).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Server authentication is not configured' },
        id: null,
      });
    });
  }

  // MCP endpoint
  app.post('/mcp', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const authReq = req as AuthenticatedRequest;
    
    // Log API key owner if authenticated via S3
    if (authReq.apiKeyOwner) {
      logger.appendKeys({ apiKeyOwner: authReq.apiKeyOwner });
    }
    
    try {
      const server = createMcpServer();
      // Only the caller's own provider keys, from their headers; never this function's env.
      await registerToolHandlers(
        server,
        resolveRequestKeys({ kind: 'caller', headers: headerKeys(name => req.get(name)) }),
        {
          started: toolName => logger.info('Tool call started', { toolName }),
          finished: (toolName, error) =>
            error
              ? logger.error('Tool call failed', { toolName, error })
              : logger.info('Tool call completed', { toolName, success: true }),
        },
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      res.on('close', () => {
        void transport.close();
      });

      await server.connect(transport);
      
      logger.info('MCP transport connected, handling request');
      
      // handleRequest writes the response - don't call res.end() ourselves
      await transport.handleRequest(req, res, req.body);
      
      logger.info('MCP request handled', { 
        writableEnded: res.writableEnded,
        headersSent: res.headersSent,
        latencyMs: Date.now() - startTime 
      });
      
      // Record success metrics
      metrics.addMetric('MCPRequestSuccess', MetricUnit.Count, 1);
      metrics.addMetric('MCPRequestLatency', MetricUnit.Milliseconds, Date.now() - startTime);
      
    } catch (error) {
      logger.error('Error handling MCP request', { error });
      
      // Record error metrics
      metrics.addMetric('MCPRequestError', MetricUnit.Count, 1);
      
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
            data: process.env.POWERTOOLS_LOG_LEVEL === 'DEBUG' 
              ? (error instanceof Error ? error.message : String(error)) 
              : undefined
          },
          id: null
        });
      }
    }
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
  const coldStartState = globalThis as { __COLD_START__?: boolean };
  const isColdStart = coldStartState.__COLD_START__ === undefined;
  if (isColdStart) {
    coldStartState.__COLD_START__ = true;
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

