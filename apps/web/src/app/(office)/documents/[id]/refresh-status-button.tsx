'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@care/ui/components/button';

export function RefreshStatusButton({ label }: Readonly<{ label: string }>) {
  const router = useRouter();
  return (
    <Button type="button" variant="secondary" onClick={() => router.refresh()}>
      {label}
    </Button>
  );
}
