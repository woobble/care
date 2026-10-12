'use client';

import type { FormHTMLAttributes } from 'react';
import { LogOut } from 'lucide-react';
import { DropdownMenuItem } from '@care/ui';
import { SignOutForm } from '@app/web/components/sign-out-form';

type ServerAction = NonNullable<FormHTMLAttributes<HTMLFormElement>['action']>;

export function SignOutMenuItem({
  action,
  label,
}: Readonly<{ action: ServerAction; label: string }>) {
  return (
    <SignOutForm action={action}>
      <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
        <button type="submit" className="w-full">
          <LogOut className="size-4" aria-hidden="true" />
          {label}
        </button>
      </DropdownMenuItem>
    </SignOutForm>
  );
}
