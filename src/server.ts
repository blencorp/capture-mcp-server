#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { resolveRequestKeys } from './auth/request-keys.js';
import { createHttpApp, httpAuthFromEnv, listenHost } from './http-app.js';
import { buildMcpServer } from './mcp-server.js';

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
function runStdioMode(): void {
  logKeyStatus();
  serveStdio(() => buildMcpServer(resolveRequestKeys({ kind: 'operator', env: process.env })), {
    onerror: error => console.error('stdio_error:', error.message),
  });
}

async function runHttpMode(): Promise<void> {
  const auth = httpAuthFromEnv(process.env, HTTP_PORT);
  const host = listenHost(auth, process.env);
  const app = createHttpApp({ auth });

  const onListening = () => {
    if (auth.mode === 'oauth' && !auth.clientIpHeader) {
      console.error('WARNING: MCP_CLIENT_IP_HEADER is not set, so per-address limits count the connection peer; behind a proxy (Railway: x-real-ip) that is the proxy.');
    }
    console.error(`Capture MCP Server running in HTTP mode on ${host ?? '[::]'}:${HTTP_PORT} (auth: ${auth.mode})`);
    if (auth.mode === 'insecure') {
      console.error('WARNING: no authentication; serving this process\'s API keys on loopback only.');
    }
    logKeyStatus();
  };
  const server = host === undefined ? app.listen(HTTP_PORT, onListening) : app.listen(HTTP_PORT, host, onListening);
  server.on('error', error => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  if (TRANSPORT_MODE === 'http') {
    await runHttpMode();
  } else if (TRANSPORT_MODE === 'stdio') {
    runStdioMode();
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
