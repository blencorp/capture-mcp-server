import type * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A labeled input with optional help text and an error. The error is tied to the input
 * (aria-invalid, aria-describedby) so it is read with the field, not only shown near it.
 */
export function Field({
  id,
  label,
  help,
  error,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
}) {
  const describedBy = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...props} />
      {error && (
        // role=alert: the error appears after a submit, away from where focus is, so announce it.
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
      {help && (
        <p id={`${id}-help`} className="text-muted-foreground text-xs">
          {help}
        </p>
      )}
    </div>
  );
}

/**
 * A link to another site, opened in a new tab so a half-filled form here is kept (people leave
 * to fetch an API key and come back). The new tab is announced.
 */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
