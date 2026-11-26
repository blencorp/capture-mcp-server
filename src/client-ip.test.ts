import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { bucketKey, clientIp } from './client-ip.js';

const req = (remoteAddress: string | undefined, headers: Record<string, string | string[]> = {}) =>
  ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;

test('without a trusted header the address is the TCP peer, and forwarding headers are ignored', () => {
  assert.equal(clientIp(req('203.0.113.7', { 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '198.51.100.2' })), '203.0.113.7');
  assert.equal(clientIp(req(undefined)), 'unknown');
});

test('with a trusted header the address is its last entry, falling back to the peer when it is absent', () => {
  assert.equal(clientIp(req('100.64.0.9', { 'x-real-ip': '198.51.100.1' }), 'x-real-ip'), '198.51.100.1');
  assert.equal(clientIp(req('100.64.0.9', { 'x-forwarded-for': '1.1.1.1, 198.51.100.1' }), 'X-Forwarded-For'), '198.51.100.1');
  assert.equal(clientIp(req('100.64.0.9', {}), 'x-real-ip'), '100.64.0.9');
  assert.equal(clientIp(req('100.64.0.9', { 'x-real-ip': '  ' }), 'x-real-ip'), '100.64.0.9');
});

test('IPv4-mapped IPv6 addresses are the IPv4 client, in any spelling', () => {
  for (const spelling of ['::ffff:203.0.113.7', '::FFFF:203.0.113.7', '::ffff:cb00:7107', '0:0:0:0:0:ffff:cb00:7107']) {
    assert.equal(clientIp(req(spelling)), '203.0.113.7', spelling);
  }
  assert.equal(bucketKey('::ffff:203.0.113.7'), '203.0.113.7');
});

test('IPv6 addresses are counted per /64, IPv4 per address', () => {
  assert.equal(bucketKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), bucketKey('2001:db8:1:2::1'));
  assert.equal(bucketKey('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.notEqual(bucketKey('2001:db8:1:2::1'), bucketKey('2001:db8:1:3::1'));
  assert.equal(bucketKey('2001:DB8:1:2:0:0:0:1'), bucketKey('2001:db8:1:2::1'), 'spelling does not matter');
  assert.equal(bucketKey('203.0.113.7'), '203.0.113.7');
  assert.notEqual(bucketKey('203.0.113.7'), bucketKey('203.0.113.8'));
});

test('a zone id or an invalid address cannot mint extra buckets or crash', () => {
  assert.equal(bucketKey('fe80::1%eth0'), bucketKey('fe80::1%eth1'));
  assert.equal(bucketKey('not-an-ip'), 'not-an-ip');
  assert.equal(bucketKey(':::'), ':::');
});
