import { BookOpen, GitBranch, LogIn, UserRound } from 'lucide-react';
import { brand } from '@/brand';
import { useSignedIn } from '@/components/kit/use-signed-in';

const navLink =
  'text-muted-foreground hover:text-foreground inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm font-medium';

/** Product name and the site navigation: docs, source, and the account. */
export function SiteHeader() {
  const signedIn = useSignedIn();
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <a href="/" className="text-foreground min-h-10 content-center text-base font-semibold tracking-tight">
          {brand.name}
        </a>
        <nav aria-label="Site">
          <ul className="flex flex-wrap items-center gap-1">
            <li>
              <a href={brand.docsUrl} className={navLink}>
                <BookOpen className="size-4" />
                Docs
              </a>
            </li>
            {brand.repoUrl && (
              <li>
                <a href={brand.repoUrl} className={navLink}>
                  <GitBranch className="size-4" />
                  GitHub
                </a>
              </li>
            )}
            <li>
              {signedIn ? (
                <a href="/account" className={navLink}>
                  <UserRound className="size-4" />
                  Account
                </a>
              ) : (
                <a href="/sign-in?next=%2Faccount" className={navLink}>
                  <LogIn className="size-4" />
                  Sign in
                </a>
              )}
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
