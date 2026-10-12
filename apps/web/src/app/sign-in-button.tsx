'use client';

import { useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { useTranslations } from 'next-intl';
import { ArrowRight, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from '@care/ui';

const authClient = createAuthClient({ basePath: '/api/auth' });

export function SignInButton() {
  const t = useTranslations('Auth');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn(): Promise<void> {
    setPending(true);
    setFailed(false);
    try {
      const result = await authClient.signIn.social({ provider: 'authentik', callbackURL: '/' });
      if (result.error) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Button
        type="button"
        onClick={signIn}
        disabled={pending}
        aria-busy={pending}
        className="w-full justify-between rounded-xl px-5"
      >
        <span>{pending ? t('redirecting') : t('signInWithAuthentik')}</span>
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRight className="size-4" aria-hidden="true" />
        )}
      </Button>
      {failed ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t('signInFailed')}</span>
        </p>
      ) : null}
    </div>
  );
}
