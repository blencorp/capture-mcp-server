import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A value to paste elsewhere (a connector URL) with a copy button. The value wraps instead of
 * being cut off, and "Copied" is announced to screen readers, then cleared.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="bg-muted/40 flex min-w-0 items-center gap-2 rounded-md border py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 text-sm break-all">{value}</code>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          // The clipboard is unavailable outside secure contexts; the value stays selectable.
          await navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  );
}
