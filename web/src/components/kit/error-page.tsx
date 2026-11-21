import { Notice } from '@/components/kit/notice';
import { Shell } from '@/components/kit/shell';

/** Messages for the error codes the sign-in and OAuth flows redirect here with. */
const MESSAGES = new Map<string, string>(Object.entries({
  access_denied: 'Sign-in was cancelled.',
  state_mismatch: 'The sign-in link expired or was opened in another browser. Start again.',
  please_restart_the_process: 'The sign-in link expired. Start again.',
  invalid_request: 'The request was not valid. Start again from your AI assistant.',
  invalid_client: 'Your AI assistant is not registered with this server. Reconnect it.',
  unable_to_create_user: 'Your account could not be created. Try again later.',
  internal_server_error: 'Something went wrong on our side. Try again later.',
}));

/** A fixed message for an error code from the URL (never the code's own text). */
export function errorMessage(code: string): string {
  // A Map, so a code like `__proto__` or `constructor` can never reach an inherited property.
  return MESSAGES.get(code.toLowerCase()) ?? 'Something went wrong. Start again.';
}

/** Where Better Auth and the portal send people when sign-in or a connection fails. */
export function ErrorPage() {
  const message = errorMessage(new URLSearchParams(window.location.search).get('error') ?? '');
  return (
    <Shell title="Something went wrong">
      <Notice>{message}</Notice>
      <p className="text-muted-foreground text-sm">
        <a href="/" className="underline underline-offset-4">
          Back to the home page
        </a>
        {' · '}
        <a href="/account" className="underline underline-offset-4">
          Your account
        </a>
      </p>
    </Shell>
  );
}

/** Any path the portal does not know. The server answers it with status 404. */
export function NotFound() {
  return (
    <Shell title="Page not found">
      <p className="text-sm">There is no page at this address.</p>
      <p className="text-muted-foreground text-sm">
        <a href="/" className="underline underline-offset-4">
          Back to the home page
        </a>
      </p>
    </Shell>
  );
}
