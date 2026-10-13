import { Textarea } from '@care/ui/components/textarea';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasTenantPermission,
} from '@app/web/lib/api';
import { createServiceAction } from '@app/web/app/(office)/services/actions';

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
      <PageHeader
        eyebrow={<Link href="/services">{t('Services.catalogTitle')}</Link>}
        title={t('Services.create')}
        description={t('Services.form.newDescription')}
      />
      {params.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('Services.form.saveFailed')}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('Errors.generic')}
        </p>
      ) : null}
      <RHFActionForm
        action={createServiceAction}
        className="grid gap-5 rounded-lg border bg-card p-5 shadow-sm"
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
            <Textarea
              id="description"
              name="description"
              className="min-h-24 rounded-md border px-3 py-2"
              maxLength={2000}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('Services.form.availabilityAfterCreate')}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!categories?.length}>
            {t('Services.create')}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/services">{t('Common.actions.cancel')}</Link>
          </Button>
        </div>
      </RHFActionForm>
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
      <NativeSelect
        id={id}
        name={name}
        selectClassName="h-10 rounded-md border bg-card px-3"
        required={required}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
