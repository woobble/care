'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@care/ui/components/button';

export function CaregiverRetryButton({
  label,
  pendingLabel,
}: Readonly<{ label: string; pendingLabel: string }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw
        className={pending ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
        aria-hidden="true"
      />
      {pending ? pendingLabel : label}
    </Button>
  );
}
