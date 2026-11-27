#!/usr/bin/env node
// Runs a built server the way a desktop assistant does (stdio, a minimal environment, no API keys)
// and checks it answers: initialize, tools/list, then a real call of the static reference tool.
//
//   node scripts/stdio-smoke.mjs <cwd> <command> [args...]
//   node scripts/stdio-smoke.mjs /tmp/bundle node dist/server.js      # an unpacked .mcpb
//   node scripts/stdio-smoke.mjs /tmp/pkg node_modules/.bin/capture-mcp-server   # the npm package
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [cwd, command, ...args] = process.argv.slice(2);
if (!cwd || !command) {
  console.error('usage: stdio-smoke.mjs <cwd> <command> [args...]');
  process.exit(2);
}

const child = spawn(command, args, {
  cwd: resolve(cwd),
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { PATH: `${resolve(process.execPath, '..')}:/usr/bin:/bin`, HOME: process.env.HOME ?? '/tmp' },
});
const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
const fail = reason => {
  console.error(`stdio smoke: ${reason}`);
  child.kill();
  process.exit(1);
};
const timer = setTimeout(() => fail('timed out'), 30_000);
child.on('error', error => fail(`could not start: ${error.message}`));
child.on('exit', code => fail(`server exited early (${code})`));

let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk;
  for (let newline; (newline = buffer.indexOf('\n')) >= 0; ) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    const message = JSON.parse(line);
    if (message.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    } else if (message.id === 2) {
      // With no keys: the static reference tool and the USAspending tools.
      const names = (message.result?.tools ?? []).map(tool => tool.name);
      if (!names.includes('lookup_reference_code')) fail(`tools/list lacks lookup_reference_code: ${line.slice(0, 300)}`);
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lookup_reference_code', arguments: { domain: 'set_aside', code: '8AN' } } });
    } else if (message.id === 3) {
      clearTimeout(timer);
      const text = JSON.stringify(message.result ?? {});
      if (message.result?.isError || !text.includes('Sole Source')) fail(`unexpected result ${text.slice(0, 500)}`);
      console.log('stdio smoke: initialize, tools/list and lookup_reference_code answered');
      child.removeAllListeners('exit');
      child.kill();
      process.exit(0);
    }
  }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-smoke', version: '1' } } });
