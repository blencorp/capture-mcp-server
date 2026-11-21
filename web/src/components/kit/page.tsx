import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/kit/site-footer';
import { SiteHeader } from '@/components/kit/site-header';
import { useDocumentTitle } from '@/components/kit/use-document-title';

/** Every page: a skip link, the site header, one `main` landmark, and the footer. Sets the tab title. */
export function Page({ title, children }: { title?: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="bg-background text-foreground sr-only z-50 rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
