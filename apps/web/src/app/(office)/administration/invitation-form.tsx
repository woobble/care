'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  inviteUserAction,
  type InviteUserActionState,
} from '@app/web/app/(office)/administration/actions';
import { errorMessageKey } from '@app/web/i18n/errors';
import { Button } from '@care/ui/components/button';
import { Label } from '@care/ui/components/label';

const initialState: InviteUserActionState = { status: 'idle', successCount: 0 };

export function InvitationForm({
  labels,
}: Readonly<{
  labels: {
    email: string;
    createInvitation: string;
    creatingInvitation: string;
    invitationCreated: string;
  };
}>) {
  const [state, formAction, pending] = useActionState(inviteUserAction, initialState);
  const [email, setEmail] = useState({ value: '', successCount: 0 });
  const t = useTranslations();
  const emailValue =
    state.status === 'success' && email.successCount < state.successCount ? '' : email.value;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="grid min-w-0 flex-1 gap-2 sm:max-w-md">
        <Label htmlFor="invite-email">{labels.email}</Label>
        <input
          id="invite-email"
          className="h-10 rounded-md border bg-background px-3"
          type="email"
          name="email"
          autoComplete="email"
          maxLength={254}
          required
          value={emailValue}
          onChange={(event) => {
            setEmail({ value: event.currentTarget.value, successCount: state.successCount });
          }}
          aria-invalid={state.status === 'error'}
          aria-describedby={state.status === 'error' ? 'invite-error' : undefined}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? labels.creatingInvitation : labels.createInvitation}
      </Button>
      {state.status === 'success' ? (
        <p role="status" className="w-full text-sm text-success-foreground">
          {labels.invitationCreated}
        </p>
      ) : state.status === 'error' ? (
        <p id="invite-error" role="alert" className="w-full text-sm text-destructive">
          {t(errorMessageKey(state.code))}
        </p>
      ) : null}
    </form>
  );
}
