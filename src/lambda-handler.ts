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
 * 
 * Headers:
 * - X-Api-Key: Server access API key (required when API_KEY_BUCKET is configured)
 * - X-Sam-Api-Key: SAM.gov API key for tool access
 * - X-Tango-Api-Key: Tango API key for tool access
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import express, { Request, Response, NextFunction } from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { initializeTools, callTool, ApiKeyConfig } from './tools/index.js';
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
 * API key overrides from HTTP headers
 */
interface ApiKeyOverrides {
  samKey?: string;
  tangoKey?: string;
}

/**
 * Creates and configures the MCP server
 */
function createMcpServer(): Server {
  return new Server(
    {
      name: "Capture MCP Server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
}

/**
 * Sets up request handlers on the MCP server
 */
async function setupHandlers(
  server: Server, 
  config: ApiKeyConfig,
  apiKeyOverrides?: ApiKeyOverrides
): Promise<Tool[]> {
  const tools = await initializeTools(config);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    logger.info('Tool call started', { toolName: name });
    
    try {
      const result = await callTool(name, args ?? {}, apiKeyOverrides);
      const structured =
        result !== null && typeof result === 'object' && !Array.isArray(result) ? result : undefined;
      const textPayload =
        structured !== undefined
          ? JSON.stringify(structured, null, 2)
          : result === undefined
            ? 'undefined'
            : String(result);

      logger.info('Tool call completed', { toolName: name, success: true });
      
      return {
        content: [{ type: "text", text: textPayload }],
        ...(structured ? { structuredContent: structured } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Tool call failed', { toolName: name, error: errorMessage });
      
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify({ error: errorMessage }, null, 2) 
        }],
        structuredContent: { error: errorMessage },
        isError: true 
      };
    }
  });

  return tools;
}

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
      version: '1.0.0',
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
      
      // Extract API keys from headers
      const headerSamKey = req.get('X-Sam-Api-Key') || req.get('x-sam-api-key');
      const headerTangoKey = req.get('X-Tango-Api-Key') || req.get('x-tango-api-key');
      
      const samApiKey = headerSamKey || process.env.SAM_GOV_API_KEY;
      const tangoApiKey = headerTangoKey || process.env.TANGO_API_KEY;
      
      const config: ApiKeyConfig = {
        hasSamApiKey: !!samApiKey,
        hasTangoApiKey: !!tangoApiKey,
        samApiKey,
        tangoApiKey
      };

      const apiKeyOverrides: ApiKeyOverrides = {
        samKey: samApiKey,
        tangoKey: tangoApiKey
      };

      // Log API key sources
      logger.debug('API Key Sources', {
        samSource: headerSamKey ? 'header' : samApiKey ? 'env' : 'none',
        tangoSource: headerTangoKey ? 'header' : tangoApiKey ? 'env' : 'none',
      });

      await setupHandlers(server, config, apiKeyOverrides);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      res.on('close', () => {
        transport.close();
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

