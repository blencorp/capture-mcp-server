import test from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError } from 'axios';
import { ApiClient } from './api-client.js';
import { highergovTools } from '../tools/highergov-tools.js';
import { tangoTools } from '../tools/tango-tools.js';

const KEY = 'sk-live-0123456789abcdef';

/** Make axios fail the way it does for an upstream error response. */
function failWith(status: number, data: unknown, message = `Request failed with status code ${status}`) {
  const original = { get: axios.get, post: axios.post };
  const reject = async () => {
    const error = new AxiosError(message);
    error.response = { status, data, statusText: '', headers: {}, config: {} as never };
    throw error;
  };
  (axios as any).get = reject;
  (axios as any).post = reject;
  return () => {
    (axios as any).get = original.get;
    (axios as any).post = original.post;
  };
}

test('an upstream error that echoes the provider key does not reach the tool result', async () => {
  const restore = failWith(400, { detail: `Invalid API key: ${KEY}`, echo: `?api_key=${KEY}&q=1` });
  try {
    const high = await highergovTools.callTool('search_highergov_contracts', { api_key: KEY, naics: '541511' });
    const tango = await tangoTools.callTool('search_tango_contracts', { api_key: KEY });
    for (const result of [high, tango]) {
      const text = JSON.stringify(result);
      assert.ok(!text.includes(KEY), text);
      assert.match(text, /REDACTED/);
    }
    const direct = await ApiClient.samGet('/x', { api_key: KEY });
    assert.ok(!JSON.stringify(direct).includes(KEY));
  } finally {
    restore();
  }
});

test('an api_key query value in an error is redacted even when it is not the key in use', async () => {
  const restore = failWith(500, `see https://example.gov/v1/x?q=1&api_key=other-secret-value&y=2`, 'boom api_key=another-one');
  try {
    const res = await ApiClient.usaspendingGet('/x');
    assert.ok(!res.error!.includes('other-secret-value'), res.error);
    assert.match(res.error!, /api_key=\[REDACTED\]&y=2/);
    assert.equal(ApiClient.redactSecrets('GET /a?api_key=abc123 failed'), 'GET /a?api_key=[REDACTED] failed');
  } finally {
    restore();
  }
});

test('URL-encoded forms of a provider key are redacted outside an api_key parameter', async () => {
  const key = 'synthetic/key+value= x';
  const encoded = [
    encodeURIComponent(key),
    encodeURI(key),
    new URLSearchParams({ k: key }).toString().slice(2),
    encodeURIComponent(key).toLowerCase(),
  ];
  const restore = failWith(400, {
    detail: `rejected ${encoded[0]}`,
    url: `https://example.gov/v1/x?token=${encoded[2]}&other=${encoded[3]}`,
    path: `/keys/${encoded[1]}`,
  });
  try {
    const res = await ApiClient.highergovGet('/x', {}, key);
    for (const text of [res.error!, ApiClient.redactSecrets(encoded.join(' '), [key])]) {
      for (const form of encoded) assert.ok(!text.includes(form), text);
      assert.match(text, /REDACTED/);
    }
  } finally {
    restore();
  }
});

test('an upstream error body is truncated', async () => {
  const restore = failWith(502, 'x'.repeat(5000));
  try {
    const res = await ApiClient.usaspendingGet('/x');
    assert.ok(res.error!.length < 600, String(res.error!.length));
    assert.match(res.error!, /^API Error 502: /);
  } finally {
    restore();
  }
});
