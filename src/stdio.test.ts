import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODERN_VERSION = '2026-07-28';

async function runStdio(messages: unknown[]): Promise<any[]> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, MCP_TRANSPORT: 'stdio', DEBUG: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });

  const completion = new Promise<any[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`stdio server did not exit after input closed; stderr=${stderr}`));
    }, 5_000);

    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`stdio server exited ${code}; stderr=${stderr}`));
        return;
      }
      try {
        resolve(stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reject(new Error(`stdio server emitted invalid JSON lines (${detail}): ${stdout}`));
      }
    });
  });

  for (const message of messages) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  child.stdin.end();
  return completion;
}

test('stdio serves a modern claim-bearing tools/list without initialization', async () => {
  const responses = await runStdio([{
    jsonrpc: '2.0',
    id: 'modern-list',
    method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'capture-stdio-test', version: '1.0.0' },
      },
    },
  }]);

  const response = responses.find(candidate => candidate.id === 'modern-list');
  assert.equal(response?.result?.resultType, 'complete');
  assert.ok(response.result.tools.some((tool: any) => tool.name === 'lookup_reference_code'));
});

test('stdio pins and serves a legacy initialized connection', async () => {
  const responses = await runStdio([
    {
      jsonrpc: '2.0',
      id: 'legacy-initialize',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'capture-stdio-legacy-test', version: '1.0.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 'legacy-list', method: 'tools/list', params: {} },
  ]);

  const initialized = responses.find(candidate => candidate.id === 'legacy-initialize');
  assert.equal(initialized?.result?.protocolVersion, '2025-06-18');
  const listed = responses.find(candidate => candidate.id === 'legacy-list');
  assert.ok(listed?.result?.tools.some((tool: any) => tool.name === 'lookup_reference_code'));
});
