import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasTenantPermission,
} from '../../../../lib/api';
import { createServiceAction } from '../actions';

export default async function NewServicePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const t = await getTranslations();
  const params = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasTenantPermission(permissions, 'service.create', header['X-Tenant-Id'])) {
    redirect('/services?error=INSUFFICIENT_PERMISSION');
  }
  const get = api.GET;
  const { data: categories, error } = await get('/api/v1/service-categories', {
    params: { query: { includeArchived: false }, header },
  });

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/services">{t('Services.catalogTitle')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('Services.create')}</h1>
        <p className="text-slate-700">{t('Services.form.newDescription')}</p>
      </header>
      {params.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Services.form.saveFailed')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Errors.generic')}
        </p>
      ) : null}
      <form
        action={createServiceAction}
        className="grid gap-5 rounded-lg border bg-white p-5 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="code" name="code" label={t('Services.form.code')} required maxLength={64} />
          <Field id="name" name="name" label={t('Services.form.name')} required maxLength={160} />
          <SelectField
            id="categoryId"
            name="categoryId"
            label={t('Services.form.category')}
            required
          >
            <option value="">{t('Services.form.selectCategory')}</option>
            {(categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField id="unit" name="unit" label={t('Services.form.unit')} required>
            <option value="occurrence">{t('Common.units.occurrence')}</option>
            <option value="minute">{t('Common.units.minute')}</option>
            <option value="hour">{t('Common.units.hour')}</option>
            <option value="day">{t('Common.units.day')}</option>
          </SelectField>
          <SelectField
            id="benefitCategory"
            name="benefitCategory"
            label={t('Services.form.benefitCategory')}
            required
          >
            <option value="other">{t('Services.benefitCategory.other')}</option>
            <option value="recognized_support">
              {t('Services.benefitCategory.recognizedSupport')}
            </option>
            <option value="clinical_nursing">
              {t('Services.benefitCategory.clinicalNursing')}
            </option>
          </SelectField>
          <Field
            id="defaultDurationMinutes"
            name="defaultDurationMinutes"
            label={t('Services.form.defaultDuration')}
            type="number"
            min={1}
            max={1440}
          />
          <Field
            id="validFrom"
            name="validFrom"
            label={t('Services.form.validFrom')}
            type="date"
            defaultValue={today()}
            required
          />
          <Field
            id="validUntil"
            name="validUntil"
            label={t('Services.form.validUntilOptional')}
            type="date"
          />
          <label className="grid gap-2 md:col-span-2">
            <Label htmlFor="description">{t('Services.form.descriptionOptional')}</Label>
            <textarea
              id="description"
              name="description"
              className="min-h-24 rounded-md border px-3 py-2"
              maxLength={2000}
            />
          </label>
        </div>
        <p className="text-sm text-slate-600">{t('Services.form.availabilityAfterCreate')}</p>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!categories?.length}>
            {t('Services.create')}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/services">{t('Common.actions.cancel')}</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  maxLength,
  required = false,
  min,
  max,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
  required?: boolean;
  min?: number;
  max?: number;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        min={min}
        max={max}
      />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  required = false,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        className="h-10 rounded-md border bg-white px-3"
        required={required}
      >
        {children}
      </select>
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
