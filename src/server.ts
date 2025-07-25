#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Import tool implementations
import { initializeTools, callTool } from './tools/index.js';

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
    // Initialize tools once
    this.tools = await initializeTools();

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        const result = await callTool(name, args || {});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return { 
          content: [{ 
            type: "text", 
            text: JSON.stringify({ error: errorMessage }, null, 2) 
          }],
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