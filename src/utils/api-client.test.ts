import test from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError } from 'axios';
import { ApiClient } from './api-client.js';
import { withRequestSignal } from './request-signal.js';
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

test('a request signal reaches axios, and a cancelled call reports it without caching anything', async () => {
  const original = { get: axios.get, post: axios.post, sleep: (ApiClient as any).sleep };
  (ApiClient as any).sleep = async () => true; // the pacing queue is not what is under test
  const signals: Array<AbortSignal | undefined> = [];
  const controller = new AbortController();
  let cancel = false;
  const respond = async (_url: string, ...rest: unknown[]) => {
    const config = rest[rest.length - 1] as { signal?: AbortSignal };
    signals.push(config.signal);
    if (cancel) throw new axios.CanceledError('canceled');
    return { data: { results: [{ opp_key: 'abc', title: 'T' }] } };
  };
  (axios as any).get = respond;
  (axios as any).post = respond;
  try {
    await withRequestSignal(controller.signal, async () => {
      await ApiClient.samGet('/x', { api_key: KEY });
      await ApiClient.usaspendingPost('/x', {});
      await ApiClient.usaspendingGet('/x');
      await ApiClient.tangoGet('/x', {}, KEY);
      await ApiClient.tangoPost('/x', {}, KEY);
      await ApiClient.highergovGet('/x', {}, KEY);
    });
    assert.equal(signals.length, 6);
    assert.ok(signals.every(signal => signal === signals[0] && signal !== undefined), 'every client passes the one request signal');
    await ApiClient.samGet('/x', { api_key: KEY });
    assert.equal(signals.at(-1), undefined, 'no signal outside a request');

    // A cancelled lookup is an error result and is not remembered: the next one reaches the source.
    cancel = true;
    const cancelled = await withRequestSignal(controller.signal, () => highergovTools.callTool('get_highergov_opportunity', { api_key: KEY, id: 'cancel-case' }));
    assert.ok(JSON.stringify(cancelled).includes('Request cancelled'), JSON.stringify(cancelled));
    assert.ok(cancelled.error, JSON.stringify(cancelled));
    cancel = false;
    const retried = await highergovTools.callTool('get_highergov_opportunity', { api_key: KEY, id: 'cancel-case' });
    assert.equal(retried.error, undefined, JSON.stringify(retried));
  } finally {
    (axios as any).get = original.get;
    (axios as any).post = original.post;
    (ApiClient as any).sleep = original.sleep;
  }
});

test('cancelled calls in the pacing queue are released at once and cost the live calls nothing', async () => {
  const client = ApiClient as any;
  const saved = { now: Date.now, sleep: client.sleep, last: client.lastCallTimestamp.usaspending, queue: client.rateLimitQueues.usaspending };
  let clock = 1_000;
  Date.now = () => clock;
  client.lastCallTimestamp.usaspending = clock; // a call has just been sent
  client.rateLimitQueues.usaspending = Promise.resolve();
  const sleeps: Array<{ ms: number; release(): void }> = [];
  client.sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<boolean>(resolve => {
      sleeps.push({ ms, release: () => { clock += ms; resolve(true); } });
      signal?.addEventListener('abort', () => resolve(false), { once: true });
    });
  const admit = (signal?: AbortSignal): Promise<boolean> => client.enforceRateLimit('usaspending', signal);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    const first = admit();
    const [b, c] = [new AbortController(), new AbortController()];
    const cancelledB = admit(b.signal);
    const cancelledC = admit(c.signal);
    const live = admit();
    await flush();
    assert.equal(sleeps.length, 1, 'only the head of the queue sleeps');

    b.abort();
    c.abort();
    // Released while `first` is still waiting for its turn.
    assert.deepEqual(await Promise.all([cancelledB, cancelledC]), [false, false]);

    sleeps[0]!.release();
    assert.equal(await first, true);
    assert.equal(client.lastCallTimestamp.usaspending, 4_600);
    await flush();
    // The cancelled entries were skipped without sleeping or moving the timestamp, so the live call
    // waits one full interval after `first`, not three.
    assert.deepEqual(sleeps.map(sleep => sleep.ms), [3_600, 3_600]);
    sleeps[1]!.release();
    assert.equal(await live, true);
    assert.equal(client.lastCallTimestamp.usaspending, 8_200);

    // Cancelled while sleeping at the head: woken at once, and the timestamp stays.
    const sleeper = new AbortController();
    const asleep = admit(sleeper.signal);
    await flush();
    sleeper.abort();
    assert.equal(await asleep, false);
    assert.equal(client.lastCallTimestamp.usaspending, 8_200);
  } finally {
    Date.now = saved.now;
    client.sleep = saved.sleep;
    client.lastCallTimestamp.usaspending = saved.last;
    client.rateLimitQueues.usaspending = saved.queue;
  }
});

test('a call cancelled before it is sent answers Request cancelled without reaching axios', async () => {
  const original = axios.post;
  let sent = 0;
  (axios as any).post = async () => {
    sent += 1;
    return { data: {} };
  };
  try {
    const controller = new AbortController();
    controller.abort();
    const result = await withRequestSignal(controller.signal, () => ApiClient.usaspendingPost('/x', {}));
    assert.deepEqual(result, { data: null, success: false, error: 'Request cancelled' });
    assert.equal(sent, 0);
  } finally {
    (axios as any).post = original;
  }
});
