import { Textarea } from '@care/ui/components/textarea';
import { NativeSelect } from '@care/ui/components/native-select';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { saveDocumentTemplateAction, uploadDocumentLogoAction } from './actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';

const documentTypes = [
  'service_evidence',
  'service_agreement',
  'invoice',
  'invoice_correction',
  'benefit_overview',
  'claim_summary',
] as const;
type DocumentType = (typeof documentTypes)[number];
type Organization = { id: string; name: string };
type Template = {
  id: string | null;
  organizationId: string;
  documentType: DocumentType;
  logoAssetId: string | null;
  primaryColor: string;
  headerText: string | null;
  footerText: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactWebsite: string | null;
  defaultLocale: 'de' | 'en';
  contractTermsText: string | null;
  version: number;
};
type SearchParams = Promise<{
  organizationId?: string;
  type?: string;
  logoAssetId?: string;
  notice?: string;
  error?: string;
}>;

export default async function DocumentTemplatesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const organizationId = validUuid(query.organizationId);
  const organizationResult = organizationId
    ? await api.GET('/api/v1/organizations/{id}', {
        params: { path: { id: organizationId }, header },
      })
    : null;
  const selectedOrganization = organizationResult?.data as Organization | undefined;
  const organizationError = organizationResult?.error as { code?: string } | undefined;
  if (
    selectedOrganization &&
    !hasClientPermission(
      permissions,
      'documents.templates.manage',
      tenantId,
      selectedOrganization.id,
      null,
    )
  ) {
    notFound();
  }
  if (!selectedOrganization) {
    return (
      <div className="mx-auto grid max-w-5xl gap-6">
        <PageHeader
          eyebrow={t('Navigation.administration')}
          title={t('Documents.templates.title')}
          description={t('Documents.templates.description')}
        />
        <form method="get" className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2">
          <AsyncEntityCombobox
            name="organizationId"
            entity="organizations"
            label={t('Documents.templates.organization')}
          />
          <div className="grid gap-2">
            <Label htmlFor="template-type">{t('Documents.templates.documentType')}</Label>
            <NativeSelect
              id="template-type"
              name="type"
              defaultValue={
                documentTypes.includes(query.type as DocumentType) ? query.type : 'service_evidence'
              }
              selectClassName="h-10 rounded-md border bg-card px-3"
              className="w-full"
            >
              {documentTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`Documents.documentTypes.${type}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="secondary" className="w-fit sm:col-span-2">
            {t('Documents.templates.choose')}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">
          {t('Documents.templates.chooseOrganization')}
        </p>
      </div>
    );
  }
  const selectedType = documentTypes.includes(query.type as DocumentType)
    ? (query.type as DocumentType)
    : 'service_evidence';
  const templatesResult = await api.GET('/api/v1/document-templates', {
    params: { query: { organizationId: selectedOrganization.id }, header },
  });
  const templates = (templatesResult.data as { items?: Template[] } | undefined)?.items ?? [];
  const template = templates.find((item) => item.documentType === selectedType);
  if (!template) notFound();
  const logoAssetId = validUuid(query.logoAssetId) ?? template.logoAssetId ?? '';

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        eyebrow={t('Navigation.administration')}
        title={t('Documents.templates.title')}
        description={t('Documents.templates.description')}
      />

      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(query.error))}
        </p>
      ) : null}
      {organizationResult?.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(organizationError?.code ?? 'UNKNOWN_ERROR'))}
        </p>
      ) : null}
      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t(`Documents.templates.notices.${query.notice === 'saved' ? 'saved' : 'logoUploaded'}`)}
        </p>
      ) : null}

      <form method="get" className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2">
        <AsyncEntityCombobox
          name="organizationId"
          entity="organizations"
          label={t('Documents.templates.organization')}
          initialOption={{ id: selectedOrganization.id, label: selectedOrganization.name }}
        />
        <div className="grid gap-2">
          <Label htmlFor="template-type">{t('Documents.templates.documentType')}</Label>
          <NativeSelect
            id="template-type"
            name="type"
            defaultValue={selectedType}
            selectClassName="h-10 rounded-md border bg-card px-3"
            className="w-full"
          >
            {documentTypes.map((type) => (
              <option key={type} value={type}>
                {t(`Documents.documentTypes.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary" className="w-fit sm:col-span-2">
          {t('Documents.templates.choose')}
        </Button>
      </form>

      <section className="grid gap-4 rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">{t('Documents.templates.configuration')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('Documents.templates.version', { version: template.version })}
          </p>
        </div>

        <RHFActionForm
          action={uploadDocumentLogoAction}
          className="grid gap-3 border-b pb-4 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <input type="hidden" name="organizationId" value={selectedOrganization.id} />
          <input type="hidden" name="documentType" value={selectedType} />
          <div className="grid gap-2">
            <Label htmlFor="template-logo">{t('Documents.templates.logo')}</Label>
            <Input
              id="template-logo"
              name="file"
              type="file"
              accept="image/png,image/jpeg"
              required
            />
            <p className="text-sm text-muted-foreground">
              {t('Documents.templates.currentLogo', {
                id: logoAssetId || t('Documents.templates.noLogo'),
              })}
            </p>
          </div>
          <Button type="submit" variant="secondary">
            {t('Documents.templates.uploadLogo')}
          </Button>
        </RHFActionForm>

        <RHFActionForm action={saveDocumentTemplateAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="organizationId" value={selectedOrganization.id} />
          <input type="hidden" name="documentType" value={selectedType} />
          <input type="hidden" name="expectedVersion" value={template.version} />
          <input type="hidden" name="logoAssetId" value={logoAssetId} />
          <div className="grid gap-2">
            <Label htmlFor="template-color">{t('Documents.templates.primaryColor')}</Label>
            <Input
              id="template-color"
              name="primaryColor"
              type="color"
              defaultValue={template.primaryColor}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="template-language">{t('Documents.templates.defaultLanguage')}</Label>
            <NativeSelect
              id="template-language"
              name="defaultLocale"
              defaultValue={template.defaultLocale}
              selectClassName="h-10 rounded-md border bg-card px-3"
              className="w-full"
            >
              <option value="de">{t('Documents.languageOptions.german')}</option>
              <option value="en">{t('Documents.languageOptions.english')}</option>
            </NativeSelect>
          </div>
          <TextField
            id="template-header"
            name="headerText"
            label={t('Documents.templates.header')}
            defaultValue={template.headerText ?? ''}
            maxLength={500}
          />
          <TextField
            id="template-footer"
            name="footerText"
            label={t('Documents.templates.footer')}
            defaultValue={template.footerText ?? ''}
            maxLength={500}
          />
          <TextField
            id="template-email"
            name="contactEmail"
            label={t('Documents.templates.email')}
            defaultValue={template.contactEmail ?? ''}
            maxLength={254}
            type="email"
          />
          <TextField
            id="template-phone"
            name="contactPhone"
            label={t('Documents.templates.phone')}
            defaultValue={template.contactPhone ?? ''}
            maxLength={80}
          />
          <TextField
            id="template-website"
            name="contactWebsite"
            label={t('Documents.templates.website')}
            defaultValue={template.contactWebsite ?? ''}
            maxLength={254}
          />
          <label className="grid gap-2 md:col-span-2">
            <span className="text-sm font-medium">{t('Documents.templates.contractTerms')}</span>
            <Textarea
              name="contractTermsText"
              maxLength={8000}
              defaultValue={template.contractTermsText ?? ''}
              className="min-h-32 rounded-md border px-3 py-2"
            />
          </label>
          <Button type="submit" className="w-fit md:col-span-2">
            {t('Documents.templates.save')}
          </Button>
        </RHFActionForm>
      </section>

      <section
        aria-labelledby="template-preview-title"
        className="grid gap-3 rounded-lg border bg-card p-5"
      >
        <h2 id="template-preview-title" className="text-xl font-semibold">
          {t('Documents.templates.preview')}
        </h2>
        <div
          className="grid gap-3 rounded border p-6"
          style={{ borderColor: template.primaryColor }}
        >
          <p
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: template.primaryColor }}
          >
            {template.headerText || selectedOrganization.name}
          </p>
          <h3 className="text-2xl font-semibold">{t(`Documents.documentTypes.${selectedType}`)}</h3>
          <p className="text-sm text-muted-foreground">{selectedOrganization.name}</p>
          <div className="h-16 rounded bg-background" />
          <p className="border-t pt-3 text-sm text-muted-foreground">
            {template.footerText || t('Documents.templates.previewFooter')}
          </p>
        </div>
      </section>
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  defaultValue,
  maxLength,
  type = 'text',
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  maxLength: number;
  type?: string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} defaultValue={defaultValue} maxLength={maxLength} />
    </div>
  );
}

function validUuid(value: string | undefined): string | null {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
