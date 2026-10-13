import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { EmptyState, PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { statusLabelKey } from '@app/web/i18n/status';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import { searchStructurePage } from '@app/web/lib/structure-search';
import type { components } from '@care/api-client';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { createOrganizationAction } from '@app/web/app/(office)/administration/actions';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  q?: string;
  page?: string;
  pageSize?: string;
}>;

export default async function OrganizationsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const t = await getTranslations();
  const page = positivePage(query.page);
  const requestedPageSize = Number(query.pageSize ?? '20');
  const pageSize = [10, 20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20;
  const search = query.q?.trim().slice(0, 120) ?? '';
  const organizationsResult = await searchStructurePage<
    components['schemas']['OrganizationResponseDto']
  >('organizations', { page, pageSize, ...(search ? { q: search } : {}) });
  if (!organizationsResult.failed)
    redirectToValidPage(
      '/administration/organizations',
      query,
      page,
      pageSize,
      organizationsResult.total,
    );

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href="/administration">{t('Organizations.section')}</Link>}
        title={t('Organizations.title')}
        description={t('Organizations.description')}
      />
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationsResult.failed ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
        >
          {t('Organizations.loadFailed')}
        </p>
      ) : null}

      <section
        aria-labelledby="organization-create-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <div>
          <h2 id="organization-create-title" className="text-xl font-semibold">
            {t('Organizations.createTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Organizations.createDescription')}</p>
        </div>
        <RHFActionForm action={createOrganizationAction} className="grid gap-4 md:grid-cols-2">
          <Field
            id="organization-name"
            name="name"
            label={t('Common.fields.name')}
            required
            maxLength={160}
          />
          <Field
            id="organization-legal-name"
            name="legalName"
            label={t('Common.fields.legalName')}
            maxLength={200}
          />
          <Field
            id="organization-code"
            name="code"
            label={t('Common.fields.code')}
            maxLength={40}
          />
          <Field
            id="organization-email"
            name="email"
            label={t('Common.fields.email')}
            type="email"
            maxLength={320}
          />
          <Field
            id="organization-phone"
            name="phone"
            label={t('Common.fields.phone')}
            type="tel"
            maxLength={40}
          />
          <Field
            id="organization-address"
            name="address"
            label={t('Common.fields.address')}
            maxLength={500}
          />
          <Field
            id="organization-timezone"
            name="timezone"
            label={t('Common.fields.timezone')}
            defaultValue="Europe/Berlin"
            required
            maxLength={100}
          />
          <p className="text-sm text-muted-foreground md:col-span-2">
            {t('Organizations.timezoneHint')}
          </p>
          <div className="md:col-span-2">
            <Button type="submit">{t('Organizations.createTitle')}</Button>
          </div>
        </RHFActionForm>
      </section>

      <section aria-labelledby="organization-list-title" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="organization-list-title" className="text-xl font-semibold">
            {t('Organizations.listTitle')}
          </h2>
          <div className="flex gap-3 text-sm">
            <Link className="text-primary underline" href="/administration/facilities">
              {t('Organizations.facilitiesLink')}
            </Link>
            <Link className="text-primary underline" href="/administration/teams">
              {t('Organizations.teamsLink')}
            </Link>
          </div>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="pageSize" value={pageSize} />
          <label className="grid min-w-56 gap-1 text-sm">
            <span>{t('Organizations.listTitle')}</span>
            <Input type="search" name="q" maxLength={120} defaultValue={search} />
          </label>
          <Button type="submit" variant="secondary">
            {t('Common.actions.apply')}
          </Button>
        </form>
        {!organizationsResult.failed && organizationsResult.items.length ? (
          organizationsResult.items.map((organization) => {
            return (
              <article key={organization.id} className="rounded-lg border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <h3 className="font-semibold">
                      <Link
                        className="text-primary underline-offset-4 hover:underline"
                        href={`/administration/organizations/${organization.id}`}
                      >
                        {organization.name}
                      </Link>
                    </h3>
                    {organization.legalName ? (
                      <p className="text-sm text-muted-foreground">{organization.legalName}</p>
                    ) : null}
                  </div>
                  <StatusBadge
                    status={organization.status}
                    label={t(statusLabelKey(organization.status))}
                  />
                </div>
              </article>
            );
          })
        ) : organizationsResult.failed ? null : (
          <EmptyState title={t('Organizations.empty')} />
        )}
        {!organizationsResult.failed ? (
          <DataPagination
            pathname="/administration/organizations"
            page={organizationsResult.page}
            pageSize={organizationsResult.pageSize}
            totalItems={organizationsResult.total}
            filters={{ q: search }}
          />
        ) : null}
      </section>
    </div>
  );
}

function positivePage(value?: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 100_000) : 1;
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue = '',
  required = false,
  maxLength,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength: number;
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
      />
    </div>
  );
}
