import type { Locale } from '../../../i18n/config';

export function formatCents(cents: number | null, locale: Locale): string {
  if (cents === null) return '—';
  const sign = cents < 0 ? -1 : 1;
  const absolute = Math.abs(cents);
  const wholeEuros = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(sign * wholeEuros);
  return parts.map((part) => (part.type === 'fraction' ? fraction : part.value)).join('');
}

export function euroInput(cents: number | null): string {
  if (cents === null) return '';
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function lineAmountField(performedServiceId: string, fundingAllocationId: string | null) {
  return `lineAmount-${performedServiceId}-${fundingAllocationId ?? 'self'}`;
}
