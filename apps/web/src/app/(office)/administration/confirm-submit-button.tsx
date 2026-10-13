'use client';

import { Button, type ButtonProps } from '@care/ui/components/button';

export function ConfirmSubmitButton({
  children,
  confirmation,
  variant = 'destructive',
}: Readonly<{
  children: React.ReactNode;
  confirmation: string;
  variant?: ButtonProps['variant'];
}>) {
  return (
    <Button
      type="submit"
      variant={variant}
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
