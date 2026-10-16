import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { PageHeader } from '@app/web/components/page-patterns';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { Button } from '@care/ui/components/button';

export default async function NewCommunicationPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ clientId?: string; continue?: string }> }>) {
  const [query, t, common] = await Promise.all([
    searchParams,
    getTranslations('Communications'),
    getTranslations(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const grants = await getPermissionGrants(api);
  if (!hasPermission(grants, 'communications.create') || !hasPermission(grants, 'client.read')) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }

  const clientId = validUuid(query.clientId) ? query.clientId : undefined;
  const missingClient = query.continue === '1' && !clientId;
  if (clientId) {
    const result = await api.GET('/api/v1/clients/{id}', {
      params: { path: { id: clientId }, header },
    });
    const client = result.data;
    if (
      client &&
      hasClientPermission(
        grants,
        'communications.create',
        header['X-Tenant-Id'],
        client.organizationId,
        client.primaryFacilityId,
      )
    ) {
      redirect(`/clients/${client.id}/communications#new-interaction`);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader
        eyebrow={<Link href="/communications">{t('globalTitle')}</Link>}
        title={t('createFromWorklist')}
        description={t('chooseClientDescription')}
      />
      <form method="get" className="grid gap-4 rounded-lg border bg-card p-5">
        <input type="hidden" name="continue" value="1" />
        <AsyncEntityCombobox
          name="clientId"
          entity="clients"
          label={common('Common.fields.client')}
          placeholder={t('selectClient')}
          required
          minQueryLength={2}
        />
        {missingClient ? (
          <p role="alert" className="text-sm text-destructive">
            {t('selectClientRequired')}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t('continueToRecord')}</Button>
          <Button asChild variant="secondary">
            <Link href="/communications">{common('Common.actions.cancel')}</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

function validUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}
