import test from 'node:test';
import assert from 'node:assert/strict';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/server';
import {
  InMemoryOAuthStateStore,
  createOAuthStateStoreFromEnv,
} from './oauth-state-store.js';

const CLIENT: OAuthClientInformationFull = {
  client_id: 'state-store-client',
  client_id_issued_at: 1,
  client_name: 'State Store Test',
  redirect_uris: ['https://example.com/callback'],
  token_endpoint_auth_method: 'none',
};

test('in-memory OAuth state expires and atomically consumes transient records', async () => {
  let now = 1_000;
  const store = new InMemoryOAuthStateStore([], () => now);
  await store.putClient(CLIENT);
  assert.equal((await store.getClient(CLIENT.client_id))?.client_name, CLIENT.client_name);

  const pending = {
    client: CLIENT,
    params: { redirectUri: CLIENT.redirect_uris[0], codeChallenge: 'challenge' },
    expiresAtMs: now + 100,
  };
  await store.putPendingAuthorization('pending', pending, 100);
  assert.deepEqual(await store.takePendingAuthorization('pending'), pending);
  assert.equal(await store.takePendingAuthorization('pending'), undefined);

  await store.putPendingAuthorization('expired', pending, 100);
  now += 101;
  assert.equal(await store.takePendingAuthorization('expired'), undefined);
});

test('production OAuth refuses process-local state when Redis is not configured', async () => {
  await assert.rejects(
    () => createOAuthStateStoreFromEnv({ NODE_ENV: 'production' }),
    /OAUTH_REDIS_URL.*required for production OAuth/,
  );
});

test('non-production OAuth may use isolated in-memory state for local development', async () => {
  const store = await createOAuthStateStoreFromEnv({ NODE_ENV: 'test' });
  assert.ok(store instanceof InMemoryOAuthStateStore);
});
