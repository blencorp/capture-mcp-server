import Markdown, { defaultUrlTransform } from 'react-markdown';
import { Shell } from '@/components/kit/shell';
import { brand } from '@/brand';
import privacy from '../../../legal/privacy-policy.md?raw';
import terms from '../../../legal/terms.md?raw';

export const policyTitle = (kind: 'privacy' | 'terms') => (kind === 'privacy' ? 'Privacy policy' : 'Terms of service');

export function Policy({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <Shell wide title={policyTitle(kind)}>
      {/* The page title is the h1; the document's own h1 repeats it. */}
      <article className="policy text-sm"><Markdown components={{ h1: () => null }} urlTransform={(url) => {
        if (url === './privacy-policy.md') return '/privacy-policy';
        if (url === '../LICENSE' || url === '../SECURITY.md')
          return `${brand.repoUrl}/blob/main/${url.slice(3)}`;
        return defaultUrlTransform(url);
      }}>{kind === 'privacy' ? privacy : terms}</Markdown></article>
    </Shell>
  );
}
