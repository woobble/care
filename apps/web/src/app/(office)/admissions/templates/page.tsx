import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { updateAdmissionTemplateAction } from '@app/web/app/(office)/admissions/actions';

type TemplateItem = {
  code: string;
  category: string;
  label: string;
  source: 'automatic' | 'manual' | 'document';
  mandatory: boolean;
  requirementType: 'policy' | 'external';
};
type Template = {
  id: string;
  organizationId: string;
  facilityId: string | null;
  name: string;
  currentVersion: number;
  items: TemplateItem[];
};

export default async function AdmissionTemplatesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ error?: string }>;
}>) {
  const [t, translate] = await Promise.all([getTranslations('Onboarding'), getTranslations()]);
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'onboarding.templates.manage')) {
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  }
  const result = await api.GET('/api/v1/onboarding/templates', { params: { header } });
  const templates = (result.data ?? []) as unknown as Template[];

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/admissions">{t('title')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('manageTemplates')}</h1>
        <p className="text-slate-700">{t('templateHelp')}</p>
      </header>
      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      {result.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}
      {templates.length ? (
        templates.map((template) => (
          <RHFActionForm
            key={template.id}
            action={updateAdmissionTemplateAction}
            className="grid gap-4 rounded-lg border bg-white p-5"
          >
            <input type="hidden" name="templateId" value={template.id} />
            <input type="hidden" name="expectedVersion" value={template.currentVersion} />
            <header className="flex flex-wrap items-end justify-between gap-3">
              <label className="grid gap-1 text-sm font-medium">
                {t('templateName')}
                <input
                  className="h-10 rounded-md border px-3 font-normal"
                  name="name"
                  defaultValue={template.name}
                  maxLength={120}
                  required
                />
              </label>
              <p className="text-sm text-slate-600">
                {t('templateScope')}: {template.organizationId}
                {template.facilityId ? ` · ${template.facilityId}` : ''} · {t('templateVersion')}{' '}
                {template.currentVersion}
              </p>
            </header>
            <div className="grid gap-3">
              {template.items.map((item) => (
                <fieldset
                  key={item.code}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-3"
                >
                  <legend className="px-1 text-sm font-semibold">{item.code}</legend>
                  <Field
                    name="code"
                    label={t('templateCode')}
                    value={item.code}
                    readOnly={item.source === 'automatic'}
                    required
                  />
                  <Field
                    name="category"
                    label={t('templateCategory')}
                    value={item.category}
                    maxLength={80}
                    required
                  />
                  <Field
                    name="label"
                    label={t('templateLabel')}
                    value={item.label}
                    maxLength={160}
                    required
                  />
                  {item.source === 'automatic' ? (
                    <>
                      <input type="hidden" name="source" value="automatic" />
                      <input type="hidden" name="mandatory" value={String(item.mandatory)} />
                      <div className="grid gap-1 text-sm">
                        <span className="font-medium">{t('source')}</span>
                        <span>{t('automatic')}</span>
                      </div>
                      <div className="grid gap-1 text-sm">
                        <span className="font-medium">{t('mandatory')}</span>
                        <span>{item.mandatory ? t('yes') : t('no')}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <SelectField name="source" label={t('source')} value={item.source}>
                        <option value="manual">{t('manual')}</option>
                        <option value="document">{t('document')}</option>
                      </SelectField>
                      <SelectField
                        name="mandatory"
                        label={t('mandatory')}
                        value={String(item.mandatory)}
                      >
                        <option value="true">{t('yes')}</option>
                        <option value="false">{t('no')}</option>
                      </SelectField>
                    </>
                  )}
                  <SelectField
                    name="requirementType"
                    label={t('requirementType')}
                    value={item.requirementType}
                  >
                    <option value="policy">{t('requirementPolicy')}</option>
                    <option value="external">{t('requirementExternal')}</option>
                  </SelectField>
                </fieldset>
              ))}
              <fieldset className="grid gap-3 rounded-md border border-dashed p-3 md:grid-cols-3">
                <legend className="px-1 text-sm font-semibold">{t('addTemplateItem')}</legend>
                <Field name="code" label={t('templateCode')} value="" maxLength={64} />
                <Field name="category" label={t('templateCategory')} value="" maxLength={80} />
                <Field name="label" label={t('templateLabel')} value="" maxLength={160} />
                <SelectField name="source" label={t('source')} value="manual">
                  <option value="manual">{t('manual')}</option>
                  <option value="document">{t('document')}</option>
                </SelectField>
                <SelectField name="mandatory" label={t('mandatory')} value="false">
                  <option value="true">{t('yes')}</option>
                  <option value="false">{t('no')}</option>
                </SelectField>
                <SelectField name="requirementType" label={t('requirementType')} value="policy">
                  <option value="policy">{t('requirementPolicy')}</option>
                  <option value="external">{t('requirementExternal')}</option>
                </SelectField>
              </fieldset>
            </div>
            <Button type="submit" className="justify-self-start">
              {t('saveTemplate')}
            </Button>
          </RHFActionForm>
        ))
      ) : (
        <p className="rounded-lg border bg-white p-5 text-slate-700">{t('noTemplates')}</p>
      )}
      <Button asChild variant="secondary" className="justify-self-start">
        <Link href="/admissions">{t('backToWorklist')}</Link>
      </Button>
    </div>
  );
}

function Field({
  name,
  label,
  value,
  maxLength,
  readOnly = false,
  required = false,
}: {
  name: string;
  label: string;
  value: string;
  maxLength?: number;
  readOnly?: boolean;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-md border px-3 font-normal"
        name={name}
        defaultValue={value}
        maxLength={maxLength}
        readOnly={readOnly}
        required={required}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 rounded-md border bg-white px-3 font-normal"
        name={name}
        defaultValue={value}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
