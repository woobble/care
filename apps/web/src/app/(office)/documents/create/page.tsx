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
  type CurrentPermissionGrant,
} from '@app/web/lib/api';
import { Button } from '@care/ui/components/button';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';

type CreationType =
  | 'service_evidence'
  | 'service_agreement'
  | 'invoice'
  | 'invoice_correction'
  | 'benefit_overview'
  | 'claim_summary';
type Permission = CurrentPermissionGrant['permission'];

const types: Array<{
  value: CreationType;
  permission: Permission;
  needsDocumentsGenerate: boolean;
}> = [
  { value: 'service_evidence', permission: 'service_evidence.read', needsDocumentsGenerate: true },
  {
    value: 'service_agreement',
    permission: 'service_agreement.read',
    needsDocumentsGenerate: true,
  },
  { value: 'benefit_overview', permission: 'benefits.read', needsDocumentsGenerate: true },
  { value: 'invoice', permission: 'billing.read', needsDocumentsGenerate: false },
  { value: 'invoice_correction', permission: 'billing.read', needsDocumentsGenerate: false },
  { value: 'claim_summary', permission: 'claims.read', needsDocumentsGenerate: false },
];

export default async function CreateDocumentPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ documentType?: string; clientId?: string }> }>) {
  const [query, t, common] = await Promise.all([
    searchParams,
    getTranslations('Documents'),
    getTranslations(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const grants = await getPermissionGrants(api);
  const availableTypes = types.filter(
    (type) =>
      hasPermission(grants, type.permission) &&
      ((type.value !== 'service_agreement' && type.value !== 'benefit_overview') ||
        hasPermission(grants, 'client.read')) &&
      (!type.needsDocumentsGenerate || hasPermission(grants, 'documents.generate')),
  );
  if (!availableTypes.length) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('workspace.noAccess')}
      </p>
    );
  }

  const selectedType = availableTypes.find((type) => type.value === query.documentType)?.value;
  const clientId = validUuid(query.clientId) ? query.clientId : undefined;
  const clientResult = clientId
    ? await api.GET('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } })
    : null;
  const client = clientResult?.data;
  let error: 'selectClient' | 'noAccess' | undefined;

  if (selectedType && clientId && client) {
    const requiredPermission = typePermission(selectedType);
    const allowed = hasClientPermission(
      grants,
      requiredPermission,
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    );
    const canGenerateDocuments =
      !types.find((type) => type.value === selectedType)?.needsDocumentsGenerate ||
      hasClientPermission(
        grants,
        'documents.generate',
        header['X-Tenant-Id'],
        client.organizationId,
        client.primaryFacilityId,
      );
    if (!allowed || !canGenerateDocuments) {
      error = 'noAccess';
    } else {
      switch (selectedType) {
        case 'service_evidence': {
          const name = `${client.preferredName || client.firstName} ${client.lastName}`;
          redirect(`/service-evidence?clientQuery=${encodeURIComponent(name)}`);
        }
        case 'service_agreement':
          redirect(`/clients/${client.id}/service-agreements`);
        case 'benefit_overview':
          redirect(`/clients/${client.id}/benefits`);
        case 'invoice':
        case 'invoice_correction':
          redirect(`/billing/invoices?clientId=${client.id}`);
        case 'claim_summary':
          redirect(`/billing/claims?clientId=${client.id}`);
      }
    }
  } else if (selectedType === 'service_agreement' || selectedType === 'benefit_overview') {
    error = 'selectClient';
  } else if (selectedType && !clientId) {
    if (selectedType === 'service_evidence') redirect('/service-evidence');
    if (selectedType === 'invoice' || selectedType === 'invoice_correction') {
      redirect('/billing/invoices');
    }
    if (selectedType === 'claim_summary') redirect('/billing/claims');
  } else if (clientId && !client) {
    error = 'noAccess';
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <PageHeader
        eyebrow={<Link href="/documents">{t('title')}</Link>}
        title={t('creation.title')}
        description={t('creation.description')}
        actions={
          <Button asChild variant="secondary">
            <Link href="/documents">{t('detail.back')}</Link>
          </Button>
        }
      />
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(`creation.${error}`)}
        </p>
      ) : null}
      <section className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5">
        <form method="get" className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="document-type">{t('creation.documentType')}</Label>
            <NativeSelect
              id="document-type"
              name="documentType"
              required
              defaultValue={selectedType ?? ''}
              selectClassName="h-10 rounded-md border bg-card px-3"
              className="w-full"
            >
              <option value="">{t('creation.chooseDocumentType')}</option>
              {availableTypes.map(({ value }) => (
                <option key={value} value={value}>
                  {t(`documentTypes.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {hasPermission(grants, 'client.read') ? (
            <AsyncEntityCombobox
              name="clientId"
              entity="clients"
              label={t('workspace.client')}
              placeholder={t('creation.searchClient')}
              minQueryLength={2}
              {...(selectedType === 'service_agreement' || selectedType === 'benefit_overview'
                ? { required: true }
                : {})}
              {...(client
                ? {
                    initialOption: {
                      id: client.id,
                      label: `${client.preferredName || client.firstName} ${client.lastName}`,
                    },
                  }
                : {})}
            />
          ) : null}
          <div className="flex flex-wrap items-end gap-2 md:col-span-2">
            <Button type="submit">{t('creation.continue')}</Button>
            <Button asChild variant="secondary">
              <Link href="/documents">{common('Common.actions.cancel')}</Link>
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="document-sources-title" className="grid gap-3">
        <h2 id="document-sources-title" className="text-lg font-semibold">
          {t('creation.sourcesTitle')}
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {availableTypes.map(({ value }) => (
            <li key={value} className="grid content-start gap-2 rounded-lg border bg-card p-4">
              <h3 className="font-semibold">{t(`documentTypes.${value}`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`creation.types.${value}`)}</p>
              <p className="text-sm">{t('creation.templateNote')}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function typePermission(type: CreationType) {
  switch (type) {
    case 'service_evidence':
      return 'service_evidence.read';
    case 'service_agreement':
      return 'service_agreement.read';
    case 'benefit_overview':
      return 'benefits.read';
    case 'invoice':
    case 'invoice_correction':
      return 'billing.read';
    case 'claim_summary':
      return 'claims.read';
  }
}

function validUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}
