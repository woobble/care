'use client';

import { Button } from '@care/ui/components/button';

export function ConfirmSubmitButton({
  children,
  confirmation,
}: Readonly<{ children: React.ReactNode; confirmation: string }>) {
  return (
    <Button
      type="submit"
      variant="destructive"
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
