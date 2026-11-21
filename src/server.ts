#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { resolveRequestKeys } from './auth/request-keys.js';
import { createHttpApp, createMcpServer, httpAuthFromEnv } from './http-app.js';
import { registerToolHandlers } from './mcp-handlers.js';

// Transport mode: 'stdio' (default) or 'http'
const TRANSPORT_MODE = process.env.MCP_TRANSPORT || 'stdio';
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);

function logKeyStatus(): void {
  if (!process.env.DEBUG) return;
  const status = (name: string) => (process.env[name] ? '✓ Configured' : '✗ Not set');
  console.error('API Key Status:');
  console.error(`  SAM.gov API Key: ${status('SAM_GOV_API_KEY')}`);
  console.error(`  Tango API Key: ${status('TANGO_API_KEY')}`);
  console.error(`  HigherGov API Key: ${status('HIGHERGOV_API_KEY')}`);
  console.error('  USASpending.gov: ✓ Always available (public API)');
}

/** stdio: a single local user; the operator's environment keys are that user's keys. */
async function runStdioMode(): Promise<void> {
  const server = createMcpServer();
  const catalog = await registerToolHandlers(server, resolveRequestKeys({ kind: 'operator', env: process.env }));
  logKeyStatus();
  if (process.env.DEBUG) console.error(`Total tools available: ${catalog.tools.length}`);
  await server.connect(new StdioServerTransport());
}

async function runHttpMode(): Promise<void> {
  const auth = httpAuthFromEnv(process.env, HTTP_PORT);
  // Without auth, listen on loopback only unless HOST explicitly says otherwise.
  const host = process.env.HOST || (auth.mode === 'insecure' ? '127.0.0.1' : '0.0.0.0');
  const app = createHttpApp({ auth });

  app
    .listen(HTTP_PORT, host, () => {
      console.error(`Capture MCP Server running in HTTP mode on ${host}:${HTTP_PORT} (auth: ${auth.mode})`);
      if (auth.mode === 'insecure') {
        console.error('WARNING: no authentication. Anyone who can reach this port uses this server\'s API keys.');
      }
      logKeyStatus();
    })
    .on('error', error => {
      console.error('Server error:', error);
      process.exit(1);
    });
}

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

main().catch(error => {
  console.error('Failed to start server:', error instanceof Error ? error.message : error);
  process.exit(1);
});
