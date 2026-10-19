'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@care/ui/components/button';

import { revokeCalendarSubscriptionAction, rotateCalendarSubscriptionAction } from './actions';

type Props = Readonly<{
  status: 'active' | 'inactive' | 'unavailable';
}>;

export function CalendarSubscriptionManager({ status: initialStatus }: Props) {
  const t = useTranslations('Caregiver');
  const [status, setStatus] = useState(initialStatus);
  const [links, setLinks] = useState<{ httpsUrl: string; webcalUrl: string } | null>(null);
  const [notice, setNotice] = useState<'copied' | 'copyFailed' | null>(null);
  const [pending, startTransition] = useTransition();

  const rotate = () => {
    setNotice(null);
    startTransition(async () => {
      const result = await rotateCalendarSubscriptionAction();
      if (!result.ok || !result.active) {
        setNotice('copyFailed');
        return;
      }
      setStatus('active');
      setLinks({ httpsUrl: result.httpsUrl, webcalUrl: result.webcalUrl });
    });
  };

  const revoke = () => {
    setNotice(null);
    startTransition(async () => {
      const result = await revokeCalendarSubscriptionAction();
      if (!result.ok || result.active) {
        setNotice('copyFailed');
        return;
      }
      setStatus('inactive');
      setLinks(null);
    });
  };

  const copyLink = () => {
    if (!links) return;
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(links.httpsUrl);
        setNotice('copied');
      } catch {
        setNotice('copyFailed');
      }
    });
  };

  return (
    <section
      aria-labelledby="calendar-subscription-title"
      className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="grid gap-1">
        <h2 id="calendar-subscription-title" className="text-base font-semibold">
          {t('calendarSubscriptionTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {status === 'active'
            ? t('calendarSubscriptionActive')
            : status === 'unavailable'
              ? t('calendarSubscriptionUnavailable')
              : t('calendarSubscriptionDescription')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={rotate} disabled={pending || status === 'unavailable'}>
          {pending
            ? t('calendarSubscriptionWorking')
            : status === 'active'
              ? t('calendarSubscriptionRegenerate')
              : t('calendarSubscriptionCreate')}
        </Button>
        {status === 'active' ? (
          <Button type="button" variant="outline" onClick={revoke} disabled={pending}>
            {t('calendarSubscriptionRevoke')}
          </Button>
        ) : null}
      </div>

      {links ? (
        <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <label htmlFor="calendar-subscription-url" className="text-sm font-medium">
            {t('calendarSubscriptionHttpsLabel')}
          </label>
          <input
            id="calendar-subscription-url"
            className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
            value={links.httpsUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={copyLink} disabled={pending}>
              {t('calendarSubscriptionCopy')}
            </Button>
            <a
              className="min-h-11 content-center text-sm font-medium text-primary underline underline-offset-4"
              href={links.webcalUrl}
            >
              {t('calendarSubscriptionOpenApp')}
            </a>
          </div>
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice === 'copied'
                ? t('calendarSubscriptionCopied')
                : t('calendarSubscriptionActionFailed')}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('calendarSubscriptionLinkShownOnce')}</p>
        </div>
      ) : null}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">{t('calendarSubscriptionSetupTitle')}</h3>
        <ul className="grid gap-1 pl-5 text-sm text-muted-foreground [list-style:disc]">
          <li>{t('calendarSubscriptionSetupIos')}</li>
          <li>{t('calendarSubscriptionSetupAndroid')}</li>
          <li>{t('calendarSubscriptionSetupOutlook')}</li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">{t('calendarSubscriptionPrivacyWarning')}</p>
      <p className="text-xs text-muted-foreground">{t('calendarSubscriptionRefreshNote')}</p>
    </section>
  );
}
