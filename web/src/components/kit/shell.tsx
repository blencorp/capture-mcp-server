import { useState, type ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Page } from '@/components/kit/page';

/** A task page (sign-in, connect, consent, account, policies): one centered card. */
export function Shell({
  title,
  description,
  action,
  children,
  wide = false,
  busy = false,
}: {
  title: string;
  description?: ReactNode;
  /** Shown at the top right of the card, such as the sign-out button. */
  action?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
  /** The content is still loading. */
  busy?: boolean;
}) {
  return (
    <Page title={title}>
      <div className="flex justify-center px-4 py-10 sm:py-16">
        <Card className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'} aria-busy={busy || undefined}>
          <CardHeader>
            <CardTitle asChild className="text-xl leading-tight wrap-anywhere">
              <h1>{title}</h1>
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
            {action && <CardAction>{action}</CardAction>}
          </CardHeader>
          {children && <CardContent className="grid gap-6">{children}</CardContent>}
        </Card>
      </div>
    </Page>
  );
}

export function Loading() {
  return (
    <Shell title="Loading…" busy>
      <p role="status" className="text-muted-foreground text-sm">
        Loading…
      </p>
    </Shell>
  );
}

/** "Signed in as …" for a card's description. */
export function SignedInAs({ email }: { email: string }) {
  return (
    <>
      Signed in as <strong className="text-foreground wrap-anywhere">{email}</strong>
    </>
  );
}

/**
 * Sign-out button for a card's top right. Inside a connection, `then` is the sign-in page
 * carrying the signed query, so another account can pick the connection back up.
 */
export function SignOut({ then }: { then: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      // A plain request, not authClient.signOut(): the auth client attaches the page's signed
      // query, which expires and would then block signing out. Leave only after success, or
      // the person would stay signed in.
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.ok) return window.location.assign(then);
    } catch {
      // Network failure: fall through and let the person retry.
    }
    setBusy(false);
    setFailed(true);
  }
  return (
    <div className="grid justify-items-end gap-1">
      {/* aria-disabled keeps the button focusable while busy, so focus is not lost to the page. */}
      <Button variant="outline" size="sm" aria-disabled={busy} onClick={() => !busy && void signOut()}>
        <LogOut />
        Sign out
      </Button>
      {failed && (
        <span role="alert" className="text-destructive max-w-32 text-right text-xs">
          Could not sign out. Try again.
        </span>
      )}
    </div>
  );
}
