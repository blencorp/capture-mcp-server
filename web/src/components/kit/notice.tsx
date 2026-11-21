import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * An error or a confirmation. Errors are announced at once (role=alert); confirmations politely
 * (role=status), so they do not interrupt what a screen reader is saying.
 */
export function Notice({ kind = 'error', children }: { kind?: 'error' | 'success'; children: ReactNode }) {
  return (
    <Alert variant={kind === 'error' ? 'destructive' : 'default'} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'error' ? <CircleAlert /> : <CircleCheck />}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
