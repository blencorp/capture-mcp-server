import { brand } from '@/brand';
import { useEffect, useState } from 'react';

/**
 * Whether the browser has a session: `undefined` while checking. Reads Better Auth's
 * get-session endpoint (null when signed out), so it works with every sign-in method.
 * Never fetches, and stays `undefined`, when the brand has no accounts.
 */
export function useSignedIn(): boolean | undefined {
  const [signedIn, setSignedIn] = useState<boolean>();
  useEffect(() => {
    if (brand.accounts === false) return;
    const controller = new AbortController();
    fetch('/api/auth/get-session', { credentials: 'same-origin', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((session: unknown) => setSignedIn(session !== null && typeof session === 'object'))
      .catch(() => {
        if (!controller.signal.aborted) setSignedIn(false);
      });
    return () => controller.abort();
  }, []);
  return signedIn;
}
