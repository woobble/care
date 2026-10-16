'use client';

import { useState } from 'react';

import { Button, type ButtonProps } from '@care/ui/components/button';

export function ConfirmSubmitButton({
  children,
  confirmation,
  variant = 'destructive',
  disabled = false,
}: Readonly<{
  children: React.ReactNode;
  confirmation: string;
  variant?: ButtonProps['variant'];
  disabled?: boolean;
}>) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={disabled || submitting}
      aria-busy={submitting}
      onClick={(event) => {
        if (!window.confirm(confirmation)) {
          event.preventDefault();
          return;
        }
        window.setTimeout(() => setSubmitting(true), 0);
      }}
    >
      {children}
    </Button>
  );
}
