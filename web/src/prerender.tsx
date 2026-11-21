import { renderToString } from 'react-dom/server';
import { Policy, policyTitle } from '@/pages/policy';
import { brand } from '@/brand';

// Build-time entry of web/prerender.ts: the pages that must read without JavaScript. The markup is
// what the client renders for the same URL (main.tsx hydrates it), so keep the two in step.
const pages = {
  '/privacy-policy': 'privacy',
  '/terms': 'terms',
} as const;

export function render(path: string) {
  const kind = pages[path as keyof typeof pages];
  return {
    html: renderToString(<Policy kind={kind} />),
    title: `${policyTitle(kind)} · ${brand.name}`,
  };
}
