'use client';

import { useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { useTranslations } from 'next-intl';
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
      <Button type="button" onClick={signIn} disabled={pending}>
        {pending ? t('redirecting') : t('signInWithAuthentik')}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-red-800">
          {t('signInFailed')}
        </p>
      ) : null}
    </div>
  );
}
