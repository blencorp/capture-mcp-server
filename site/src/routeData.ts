import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { markdownPath } from './lib/pages.mjs';
import { withBase } from './lib/paths';

// Tells assistants and other tools where the Markdown copy of each page is.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const path = markdownPath(route.entry.id);
  if (path) {
    route.head.push({ tag: 'link', attrs: { rel: 'alternate', type: 'text/markdown', href: withBase(path) } });
  }
});
