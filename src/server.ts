#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Import tool implementations
import { initializeTools, callTool, ApiKeyConfig } from './tools/index.js';

class CaptureMCPServer {
  private server: Server;
  private tools: Tool[] = [];

  constructor() {
    this.server = new Server(
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

    this.setupHandlers();
  }

  private async setupHandlers() {
    // Check which API keys are available
    const config: ApiKeyConfig = {
      hasSamApiKey: !!process.env.SAM_GOV_API_KEY,
      hasTangoApiKey: !!process.env.TANGO_API_KEY
    };

    // Log startup info
    if (process.env.DEBUG) {
      console.error("Capture MCP Server initializing...");
      console.error("API Key Status:");
      console.error(`  SAM.gov API Key: ${config.hasSamApiKey ? "✓ Configured" : "✗ Not set"}`);
      console.error(`  Tango API Key: ${config.hasTangoApiKey ? "✓ Configured" : "✗ Not set"}`);
      console.error("  USASpending.gov: ✓ Always available (public API)");

      if (!config.hasSamApiKey && !config.hasTangoApiKey) {
        console.error("\nWARNING: No API keys configured. Only USASpending.gov tools will be available.");
        console.error("Set SAM_GOV_API_KEY and/or TANGO_API_KEY environment variables to enable additional tools.");
      }
    }

    // Initialize tools with configuration
    this.tools = await initializeTools(config);

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        const result = await callTool(name, args ?? {});
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
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Only log to stderr in debug mode
    if (process.env.DEBUG) {
      console.error("Capture MCP Server running on stdio");
    }
  }
}

// Start the server
const server = new CaptureMCPServer();
server.run().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
