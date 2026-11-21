import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the Docker image puts the built documentation site (site/, built with base `/docs`). */
export const DOCS_PATH = '/docs';

const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

/**
 * The docs share an origin with the portal's session cookies, so they get their own policy: inline
 * scripts run only if their hash is listed (computed once from the built pages), and search
 * (Pagefind) may compile WebAssembly. Inline styles stay allowed; they cannot run code.
 */
export function docsPolicy(root: string): string {
  const hashes = new Set<string>();
  for (const file of htmlFiles(root)) {
    for (const [, body = ''] of readFileSync(file, 'utf8').matchAll(INLINE_SCRIPT)) {
      if (body.trim()) hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    }
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${[...hashes].sort().join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Serves the built documentation site, or returns undefined when it is not there (a checkout
 * or a local build without `pnpm --dir site build`). Hashed assets under _astro/ are immutable;
 * pages are cached briefly so a deploy shows up within minutes.
 */
export function docsHandler(root: string): express.Handler | undefined {
  if (!existsSync(join(root, 'index.html'))) return undefined;
  const policy = docsPolicy(root);
  const files = express.static(root, {
    index: 'index.html',
    dotfiles: 'ignore',
    fallthrough: true,
    setHeaders: (res, path) => {
      res.setHeader('Content-Security-Policy', policy);
      res.setHeader(
        'Cache-Control',
        path.includes(`${join('/', '_astro')}/`) ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      );
    },
  });
  const notFound = readFileSync(join(root, existsSync(join(root, '404.html')) ? '404.html' : 'index.html'), 'utf8');
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    files(req, res, (error?: unknown) => {
      // A read failure (5xx) is not a missing page; only 404s and rejected paths fall through.
      if (error) {
        // serve-static set the file's headers (Content-Length, caching) before the read failed; the
        // error response must not carry them (a 500 cached as the page). Earlier middleware's security
        // headers stay.
        for (const name of ['content-length', 'content-type', 'last-modified', 'etag', 'accept-ranges', 'content-range'])
          res.removeHeader(name);
        res.setHeader('Cache-Control', 'no-store');
        return next(error);
      }
      res.status(404).set({ 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' }).type('html').send(notFound);
    });
  };
}
