import { getTranslations } from 'next-intl/server';

import { BillingNavigationLinks } from './billing-nav-links';

import type { CurrentPermissionGrant } from '@app/web/lib/api';
import { hasPermission } from '@app/web/lib/api';

export async function BillingNavigation({
  permissions,
}: Readonly<{ permissions: readonly CurrentPermissionGrant[] }>) {
  const t = await getTranslations('Billing');
  const links = [
    { href: '/billing', label: t('overview'), permission: 'billing.read' as const },
    {
      href: '/billing',
      hash: '#worklist',
      label: t('billableServices'),
      permission: 'billing.read' as const,
    },
    { href: '/billing/invoices', label: t('invoices'), permission: 'billing.read' as const },
    {
      href: '/billing/receivables',
      label: t('receivables'),
      permission: 'billing.payments.read' as const,
    },
    {
      href: '/billing/payments',
      label: t('payments'),
      permission: 'billing.payments.read' as const,
    },
    {
      href: '/billing/claims',
      label: t('claims'),
      permission: 'claims.read' as const,
    },
    {
      href: '/billing/claims/settings',
      label: t('claimsSettings'),
      permission: 'claims.settings.manage' as const,
    },
    {
      href: '/billing/settings',
      label: t('settings'),
      permission: 'billing.settings.manage' as const,
    },
  ];
  return (
    <nav
      aria-label={t('navigation')}
      className="flex max-w-full min-w-0 flex-wrap gap-1 border-b border-border pb-3 text-sm"
    >
      <BillingNavigationLinks
        links={links
          .filter((link) => hasPermission(permissions, link.permission))
          .map((link) => ({ href: `${link.href}${link.hash ?? ''}`, label: link.label }))}
      />
    </nav>
  );
}
