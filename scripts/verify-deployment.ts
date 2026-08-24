// Bounded deployment verifier for Railway and Lambda HTTP endpoints.
// It proves the deployed artifact identity plus both protocol eras without
// calling an upstream data provider. A placeholder SAM header is sufficient
// for tools/list and exercises the hosted header-passthrough route.

import { readFileSync } from 'node:fs';

const MODERN_VERSION = '2026-07-28';

type Options = {
  baseUrl: string;
  expectedVersion: string;
  attempts: number;
  delayMs: number;
  serverApiKey?: string;
};

function parseArgs(args: string[]): Options {
  const read = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const baseUrl = read('--base-url');
  if (!baseUrl) throw new Error('--base-url is required');

  const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
  const attempts = Number(read('--attempts') ?? 30);
  const delayMs = Number(read('--delay-ms') ?? 10_000);
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('--attempts must be a positive integer');
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('--delay-ms must be zero or greater');

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    expectedVersion: read('--expected-version') ?? packageVersion,
    attempts,
    delayMs,
    serverApiKey: read('--server-api-key') ?? process.env.CAPTURE_MCP_SERVER_API_KEY,
  };
}

async function fetchHealthy(options: Options): Promise<any> {
  let lastFailure = 'no response';
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await fetch(`${options.baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) return response.json();
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < options.attempts) {
      console.log(`Health attempt ${attempt}/${options.attempts} failed (${lastFailure}); retrying`);
      await new Promise(resolve => setTimeout(resolve, options.delayMs));
    }
  }
  throw new Error(`health check failed after ${options.attempts} attempt(s): ${lastFailure}`);
}

function requestHeaders(options: Options, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    // The probe never calls SAM. This only proves that per-request provider
    // selection and the documented header route reach the MCP handler.
    'X-Sam-Api-Key': 'capture-deployment-verifier',
    ...(options.serverApiKey ? { 'X-Api-Key': options.serverApiKey } : {}),
    ...extra,
  };
}

async function postJson(options: Options, body: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${options.baseUrl}/mcp`, {
    method: 'POST',
    headers: requestHeaders(options, extraHeaders),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`MCP probe returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`MCP probe returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (response.headers.has('mcp-session-id')) {
    throw new Error('stateless endpoint unexpectedly emitted Mcp-Session-Id');
  }
  return payload;
}

async function verify(options: Options): Promise<void> {
  const health = await fetchHealthy(options);
  if (health.status !== 'healthy') throw new Error(`health status is ${JSON.stringify(health.status)}`);
  if (health.version !== options.expectedVersion) {
    throw new Error(`deployed version ${JSON.stringify(health.version)} does not match ${options.expectedVersion}`);
  }
  if (health.protocolVersion !== MODERN_VERSION) {
    throw new Error(`deployed protocol ${JSON.stringify(health.protocolVersion)} does not match ${MODERN_VERSION}`);
  }

  const meta = {
    'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'capture-deployment-verifier', version: '1.0.0' },
  };
  const modern = await postJson(options, {
    jsonrpc: '2.0',
    id: 'modern-tools-list',
    method: 'tools/list',
    params: { _meta: meta },
  }, {
    'MCP-Protocol-Version': MODERN_VERSION,
    'Mcp-Method': 'tools/list',
  });
  const modernNames = new Set((modern.result?.tools ?? []).map((tool: any) => tool.name));
  if (modern.result?.resultType !== 'complete' || !modernNames.has('search_sam_entities')) {
    throw new Error(`modern tools/list did not return the expected complete SAM-enabled result: ${JSON.stringify(modern)}`);
  }

  const legacy = await postJson(options, {
    jsonrpc: '2.0',
    id: 'legacy-initialize',
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'capture-deployment-verifier-legacy', version: '1.0.0' },
    },
  });
  if (legacy.result?.protocolVersion !== '2025-06-18') {
    throw new Error(`legacy initialize did not negotiate 2025-06-18: ${JSON.stringify(legacy)}`);
  }

  const legacyTools = await postJson(options, {
    jsonrpc: '2.0',
    id: 'legacy-tools-list',
    method: 'tools/list',
    params: {},
  }, {
    'MCP-Protocol-Version': '2025-06-18',
  });
  const legacyNames = new Set((legacyTools.result?.tools ?? []).map((tool: any) => tool.name));
  if (!legacyNames.has('search_sam_entities')) {
    throw new Error(`legacy tools/list did not return the expected SAM-enabled result: ${JSON.stringify(legacyTools)}`);
  }

  console.log(JSON.stringify({
    verified: true,
    baseUrl: options.baseUrl,
    version: health.version,
    protocolVersion: health.protocolVersion,
    modernToolCount: modern.result.tools.length,
    legacyProtocolVersion: legacy.result.protocolVersion,
    legacyToolCount: legacyTools.result.tools.length,
    stateless: true,
  }, null, 2));
}

verify(parseArgs(process.argv.slice(2))).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
