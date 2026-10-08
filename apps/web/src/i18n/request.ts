import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { localeCookieName, resolveLocale } from './config';
import en from '../../messages/en.json';
import de from '../../messages/de.json';

const messages = { en, de };

export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get(localeCookieName)?.value);
  return {
    locale,
    messages: messages[locale],
    formats: {
      dateTime: {
        shortDate: { dateStyle: 'medium', timeZone: 'UTC' },
        longDate: { dateStyle: 'full', timeZone: 'UTC' },
        dateTime: { dateStyle: 'medium', timeStyle: 'short' },
        time: { timeStyle: 'short' },
      },
      number: {
        decimal: { maximumFractionDigits: 2 },
        percent: { style: 'percent', maximumFractionDigits: 1 },
        currency: { style: 'currency', currency: 'EUR' },
      },
    },
  };
});
