import type { IncomingMessage } from 'node:http';
import { isIP, isIPv4, isIPv6 } from 'node:net';

// Client-address helpers, ported from uspto-mcp-server (src/server/ipRateLimiter.ts).

/**
 * The caller's address. Without `trustedHeader` it is the TCP peer. Behind a reverse proxy
 * the peer is the proxy (on Railway, a different internal 100.64.x.x address per
 * connection), so name the header the proxy sets to the client address and that header is
 * used instead. Only name a header the proxy always overwrites: a client could otherwise
 * forge it. Railway overwrites `x-real-ip` (verified 2026-10-13; it also rebuilds
 * X-Forwarded-For as "<client>, <edge>", so that header's rightmost entry is NOT the client).
 * For a list-valued header the rightmost entry, the one the nearest proxy added, is used.
 */
export function clientIp(req: IncomingMessage, trustedHeader?: string): string {
  const peer = normalize(req.socket.remoteAddress ?? 'unknown');
  if (!trustedHeader) return peer;
  const value = req.headers[trustedHeader.toLowerCase()];
  const entries = (Array.isArray(value) ? value.join(',') : value ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const candidate = entries[entries.length - 1];
  // A value that is not an address (a misnamed header, a proxy that passes junk through) would mint
  // an unbounded bucket key per request: count the peer instead.
  return candidate && isIP(candidate) ? normalize(candidate) : peer;
}

/** The 8 groups of an IPv6 address (a dotted IPv4 tail counts as two), or undefined if it is not one. */
function ipv6Groups(ip: string): number[] | undefined {
  if (!isIPv6(ip)) return undefined;
  // Linear string scans, not regexes: the input is client-controlled and unbounded (zone ids).
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  const cut = ip.lastIndexOf(':') + 1;
  const last = ip.slice(cut);
  if (last.includes('.')) {
    if (!isIPv4(last)) return undefined;
    const [a, b, c, d] = last.split('.').map(Number) as [number, number, number, number];
    ip = `${ip.slice(0, cut)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = ip.split('::');
  const first = head ? head.split(':') : [];
  const rest = tail === undefined ? [] : tail ? tail.split(':') : [];
  const missing = 8 - first.length - rest.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return undefined;
  const groups = [...first, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...rest].map(g => parseInt(g, 16));
  return groups.length === 8 && groups.every(g => g >= 0 && g <= 0xffff) ? groups : undefined;
}

/** An IPv4-mapped address (::ffff:0:0/96, in any spelling) is the IPv4 client; anything else is returned as is. */
function normalize(ip: string): string {
  const g = ipv6Groups(ip);
  if (g && g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff)
    return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  return ip;
}

/**
 * The bucket an address is counted in. An IPv6 customer controls a whole /64 (usually far more),
 * so counting single addresses would let one host mint endless fresh buckets. IPv4 (and
 * IPv4-mapped IPv6) is counted per address.
 */
export function bucketKey(ip: string): string {
  ip = normalize(ip);
  const g = ipv6Groups(ip);
  if (!g) return ip;
  return `${g.slice(0, 4).map(x => x.toString(16)).join(':')}::/64`;
}
