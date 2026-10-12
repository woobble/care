'use client';

import type { FormHTMLAttributes, ReactNode } from 'react';
import { clearAllCareDrafts } from '@app/web/app/care/drafts';

type ServerAction = NonNullable<FormHTMLAttributes<HTMLFormElement>['action']>;

export function SignOutForm({ action, children }: { action: ServerAction; children: ReactNode }) {
  return (
    <form
      action={action}
      onSubmit={() => {
        for (const storageName of ['sessionStorage', 'localStorage'] as const) {
          try {
            clearAllCareDrafts(window[storageName]);
          } catch {
            // A failed local cleanup must not prevent the requested sign out.
          }
        }
      }}
    >
      {children}
    </form>
  );
}
