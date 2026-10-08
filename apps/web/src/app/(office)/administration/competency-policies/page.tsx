import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { components } from '@care/api-client';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../action-notice';
import { ConfirmSubmitButton } from '../confirm-submit-button';
import {
  activateCompetencyPolicyAction,
  createCompetencyPolicyDraftAction,
  deactivateCompetencyPolicyAction,
} from '../actions';

type SearchParams = Promise<{ error?: string; updated?: string }>;
type PolicyAdmin = components['schemas']['CompetencyPolicyAdminDto'];
type Operation = PolicyAdmin['operations'][number];
type PolicyVersion = Operation['versions'][number];

const policyStatusKeys = {
  draft: 'status.draft',
  active: 'status.active',
  inactive: 'status.inactive',
} as const;

function policyStatusKey(status: string) {
  return status in policyStatusKeys
    ? policyStatusKeys[status as keyof typeof policyStatusKeys]
    : 'status.unknown';
}

export default async function CompetencyPoliciesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const t = await getTranslations('CompetencyPolicies');
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const result = await get('/api/v1/competency-policies', { params: { header } });
  const policies = result.data;
  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration">{t('section')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-slate-700">{t('description')}</p>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {result.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('loadFailed')}
        </p>
      ) : null}
      {policies ? (
        <div className="grid gap-6">
          {policies.operations.map((operation) => (
            <PolicyOperationCard
              key={operation.operationKey}
              operation={operation}
              qualifications={policies.qualificationDefinitions}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

async function PolicyOperationCard({
  operation,
  qualifications,
  t,
}: Readonly<{
  operation: Operation;
  qualifications: PolicyAdmin['qualificationDefinitions'];
  t: Awaited<ReturnType<typeof getTranslations<'CompetencyPolicies'>>>;
}>) {
  const activeVersion = operation.versions.find((version) => version.status === 'active');
  const operationTitle =
    operation.operationKey === 'care_plan.activate' ? t('activateTitle') : t('evaluateTitle');
  return (
    <section className="grid gap-4 rounded-lg border bg-white p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{operationTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">{operation.operationKey}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-md bg-slate-100 px-3 py-2">
            {t('latestVersion', { version: operation.latestVersion })}
          </span>
          <span className="rounded-md bg-slate-100 px-3 py-2">
            {t('activeVersion', {
              version: operation.activeVersion ?? t('none'),
            })}
          </span>
        </div>
      </header>
      <form action={createCompetencyPolicyDraftAction} className="grid gap-4 border-t pt-4">
        <input type="hidden" name="operationKey" value={operation.operationKey} />
        <input type="hidden" name="expectedVersion" value={operation.latestVersion} />
        <h3 className="text-lg font-medium">{t('newDraft')}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`${operation.operationKey}-name`}>{t('name')}</Label>
            <Input
              id={`${operation.operationKey}-name`}
              name="name"
              required
              maxLength={160}
              defaultValue={activeVersion?.name ?? operationTitle}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${operation.operationKey}-description`}>{t('descriptionField')}</Label>
            <textarea
              id={`${operation.operationKey}-description`}
              name="description"
              maxLength={1000}
              defaultValue={activeVersion?.description ?? ''}
              className="min-h-10 rounded-md border bg-white px-3 py-2"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${operation.operationKey}-mode`}>{t('requirementMode')}</Label>
          <select
            id={`${operation.operationKey}-mode`}
            name="requirementMode"
            defaultValue={activeVersion?.requirementMode ?? 'ALL'}
            className="h-10 w-fit rounded-md border bg-white px-3"
          >
            <option value="ALL">{t('allRequirements')}</option>
            <option value="ANY">{t('anyRequirement')}</option>
          </select>
        </div>
        <fieldset className="grid gap-2">
          <legend className="font-medium">{t('qualifications')}</legend>
          {qualifications.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {qualifications.map((qualification) => (
                <label
                  key={qualification.id}
                  className="flex items-start gap-2 rounded-md border p-3"
                >
                  <input
                    type="checkbox"
                    name="qualificationDefinitionId"
                    value={qualification.id}
                    defaultChecked={activeVersion?.requirements.some(
                      (requirement) => requirement.qualificationDefinitionId === qualification.id,
                    )}
                    className="mt-1"
                  />
                  <span>
                    {qualification.name}
                    {qualification.code ? ` · ${qualification.code}` : ''}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t('noQualifications')}</p>
          )}
        </fieldset>
        <div>
          <Button type="submit" disabled={qualifications.length === 0}>
            {t('saveDraft')}
          </Button>
        </div>
      </form>

      {activeVersion ? (
        <form action={deactivateCompetencyPolicyAction} className="border-t pt-4">
          <input type="hidden" name="operationKey" value={operation.operationKey} />
          <ConfirmSubmitButton confirmation={t('deactivateConfirmation')}>
            {t('deactivate')}
          </ConfirmSubmitButton>
        </form>
      ) : null}

      <section aria-label={t('history')} className="grid gap-3 border-t pt-4">
        <h3 className="text-lg font-medium">{t('history')}</h3>
        {operation.versions.length ? (
          operation.versions.map((version) => (
            <PolicyVersionCard
              key={version.id}
              operationKey={operation.operationKey}
              version={version}
              latestVersion={operation.latestVersion}
              t={t}
            />
          ))
        ) : (
          <p className="text-sm text-slate-600">{t('noVersions')}</p>
        )}
      </section>
    </section>
  );
}

async function PolicyVersionCard({
  operationKey,
  version,
  latestVersion,
  t,
}: Readonly<{
  operationKey: Operation['operationKey'];
  version: PolicyVersion;
  latestVersion: number;
  t: Awaited<ReturnType<typeof getTranslations<'CompetencyPolicies'>>>;
}>) {
  const isLatestDraft = version.status === 'draft' && version.version === latestVersion;
  return (
    <article className="grid gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold">
            {version.name} · {t('version', { version: version.version })}
          </h4>
          {version.description ? (
            <p className="text-sm text-slate-600">{version.description}</p>
          ) : null}
        </div>
        <StatusBadge
          status={version.status === 'draft' ? 'pending' : version.status}
          label={t(policyStatusKey(version.status))}
        />
      </div>
      <p className="text-sm text-slate-600">
        {version.requirementMode === 'ALL' ? t('allRequirements') : t('anyRequirement')}
      </p>
      <ul className="grid gap-1 text-sm">
        {version.requirements.map((requirement) => (
          <li key={requirement.qualificationDefinitionId}>
            {requirement.name}
            {requirement.code ? ` · ${requirement.code}` : ''}
            {requirement.status === 'archived' ? ` · ${t('archived')}` : ''}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        {t('createdAt', { date: version.createdAt })}
        {version.activatedAt ? ` · ${t('activatedAt', { date: version.activatedAt })}` : ''}
        {version.deactivatedAt ? ` · ${t('deactivatedAt', { date: version.deactivatedAt })}` : ''}
      </p>
      {isLatestDraft ? (
        <form action={activateCompetencyPolicyAction}>
          <input type="hidden" name="operationKey" value={operationKey} />
          <input type="hidden" name="version" value={version.version} />
          <ConfirmSubmitButton confirmation={t('activateConfirmation')}>
            {t('activate')}
          </ConfirmSubmitButton>
        </form>
      ) : null}
    </article>
  );
}
