#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from 'express';

// Import tool implementations
import { initializeTools, callTool, ApiKeyConfig } from './tools/index.js';

// Transport mode: 'stdio' (default) or 'http'
const TRANSPORT_MODE = process.env.MCP_TRANSPORT || 'stdio';
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);

/**
 * Creates and configures the MCP server with all handlers
 */
function createServer(): Server {
  const server = new Server(
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

  return server;
}

/**
 * API key overrides from HTTP headers
 */
interface ApiKeyOverrides {
  samKey?: string;
  tangoKey?: string;
}

/**
 * Sets up request handlers on the server
 * @param server MCP server instance
 * @param config API key configuration (determines which tools are available)
 * @param apiKeyOverrides Optional API keys from HTTP headers to inject into tool calls
 */
async function setupHandlers(
  server: Server, 
  config: ApiKeyConfig,
  apiKeyOverrides?: ApiKeyOverrides
): Promise<Tool[]> {
  // Initialize tools with configuration
  const tools = await initializeTools(config);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      // Pass API key overrides to callTool for header-based key injection
      const result = await callTool(name, args ?? {}, apiKeyOverrides);
      const structured =
        result !== null && typeof result === 'object' && !Array.isArray(result) ? result : undefined;
      const textPayload =
        structured !== undefined
          ? JSON.stringify(structured, null, 2)
          : result === undefined
            ? 'undefined'
            : String(result);

      return {
        content: [{ type: "text", text: textPayload }],
        ...(structured ? { structuredContent: structured } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
 * Logs startup information
 */
function logStartupInfo(config: ApiKeyConfig, toolCount: number): void {
  if (process.env.DEBUG) {
    console.error("Capture MCP Server initializing...");
    console.error(`Transport mode: ${TRANSPORT_MODE}`);
    console.error("API Key Status:");
    console.error(`  SAM.gov API Key: ${config.hasSamApiKey ? "✓ Configured" : "✗ Not set"}`);
    console.error(`  Tango API Key: ${config.hasTangoApiKey ? "✓ Configured" : "✗ Not set"}`);
    console.error("  USASpending.gov: ✓ Always available (public API)");
    console.error(`Total tools available: ${toolCount}`);

    if (!config.hasSamApiKey && !config.hasTangoApiKey) {
      console.error("\nWARNING: No API keys configured. Only USASpending.gov tools will be available.");
      console.error("Set SAM_GOV_API_KEY and/or TANGO_API_KEY environment variables to enable additional tools.");
    }
  }
}

/**
 * Run the server in stdio mode (for local desktop clients)
 */
async function runStdioMode(): Promise<void> {
  const server = createServer();
  
  // Check which API keys are available
  const config: ApiKeyConfig = {
    hasSamApiKey: !!process.env.SAM_GOV_API_KEY,
    hasTangoApiKey: !!process.env.TANGO_API_KEY
  };

  const tools = await setupHandlers(server, config);
  logStartupInfo(config, tools.length);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  if (process.env.DEBUG) {
    console.error("Capture MCP Server running on stdio");
  }
}

/**
 * Run the server in HTTP mode (for AWS Lambda/remote clients)
 * Uses StreamableHTTP transport per MCP 2025-06-18 spec
 */
async function runHttpMode(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', transport: 'http', version: '1.0.0' });
  });

  // MCP endpoint - stateless mode for Lambda compatibility
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      // Create a fresh server instance for each request (stateless)
      const server = createServer();
      
      // Extract API keys from headers (case-insensitive)
      const headerSamKey = req.get('X-Sam-Api-Key') || req.get('x-sam-api-key');
      const headerTangoKey = req.get('X-Tango-Api-Key') || req.get('x-tango-api-key');
      
      // API keys: headers take precedence over env vars
      const samApiKey = headerSamKey || process.env.SAM_GOV_API_KEY;
      const tangoApiKey = headerTangoKey || process.env.TANGO_API_KEY;
      
      // Build config - tools enabled if key available from any source
      const config: ApiKeyConfig = {
        hasSamApiKey: !!samApiKey,
        hasTangoApiKey: !!tangoApiKey,
        samApiKey,
        tangoApiKey
      };

      // Build API key overrides for injection into tool calls
      const apiKeyOverrides: ApiKeyOverrides = {
        samKey: samApiKey,
        tangoKey: tangoApiKey
      };

      if (process.env.DEBUG) {
        console.error('API Key Sources:');
        console.error(`  SAM.gov: ${headerSamKey ? 'header' : samApiKey ? 'env' : 'none'}`);
        console.error(`  Tango: ${headerTangoKey ? 'header' : tangoApiKey ? 'env' : 'none'}`);
      }

      await setupHandlers(server, config, apiKeyOverrides);

      // Create stateless transport (sessionIdGenerator: undefined)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      // Clean up transport when response closes
      res.on('close', () => {
        transport.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
            data: process.env.DEBUG ? (error instanceof Error ? error.message : String(error)) : undefined
          },
          id: null
        });
      }
    }
  });

  // Handle unsupported methods on /mcp
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

  // Start the HTTP server
  app.listen(HTTP_PORT, () => {
    console.error(`Capture MCP Server running in HTTP mode on port ${HTTP_PORT}`);
    console.error(`MCP endpoint: http://localhost:${HTTP_PORT}/mcp`);
    console.error(`Health check: http://localhost:${HTTP_PORT}/health`);
    
    if (process.env.DEBUG) {
      const config: ApiKeyConfig = {
        hasSamApiKey: !!process.env.SAM_GOV_API_KEY,
        hasTangoApiKey: !!process.env.TANGO_API_KEY
      };
      console.error("API Key Status:");
      console.error(`  SAM.gov API Key: ${config.hasSamApiKey ? "✓ Configured" : "✗ Not set"}`);
      console.error(`  Tango API Key: ${config.hasTangoApiKey ? "✓ Configured" : "✗ Not set"}`);
      console.error("  USASpending.gov: ✓ Always available (public API)");
    }
  }).on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  if (TRANSPORT_MODE === 'http') {
    await runHttpMode();
  } else if (TRANSPORT_MODE === 'stdio') {
    await runStdioMode();
  } else {
    console.error(`Unknown transport mode: ${TRANSPORT_MODE}`);
    console.error('Valid options: stdio (default), http');
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
