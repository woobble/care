import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { statusLabelKey } from '../../../../i18n/status';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../action-notice';
import { ConfirmSubmitButton } from '../confirm-submit-button';
import {
  archiveQualificationAction,
  archiveSkillAction,
  createQualificationAction,
  createSkillAction,
  updateQualificationAction,
  updateSkillAction,
} from '../../employees/actions';

type SearchParams = Promise<{ error?: string; updated?: string }>;
type Definition = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: 'active' | 'archived';
};
type FormAction = (formData: FormData) => Promise<void>;

export default async function QualificationsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [qualificationsResult, skillsResult] = await Promise.all([
    get('/api/v1/qualifications', { params: { header } }),
    get('/api/v1/skills', { params: { header } }),
  ]);
  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration">{t('Organizations.section')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('Qualifications.title')}</h1>
        <p className="text-slate-700">{t('Qualifications.description')}</p>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {qualificationsResult.error || skillsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Qualifications.loadFailed')}
        </p>
      ) : null}
      <section aria-labelledby="qualifications-title" className="grid gap-4">
        <h2 id="qualifications-title" className="text-xl font-semibold">
          {t('Qualifications.qualificationsTitle')}
        </h2>
        <form
          action={createQualificationAction}
          className="grid gap-4 rounded-lg border bg-white p-5 md:grid-cols-3"
        >
          <h3 className="text-lg font-medium md:col-span-3">
            {t('Qualifications.createQualification')}
          </h3>
          <Field
            id="qualification-name"
            name="name"
            label={t('Common.fields.name')}
            required
            maxLength={160}
          />
          <Field
            id="qualification-code"
            name="code"
            label={t('Common.fields.code')}
            maxLength={40}
          />
          <Field
            id="qualification-description"
            name="description"
            label={t('Common.fields.description')}
            maxLength={1000}
          />
          <div className="md:col-span-3">
            <Button type="submit">{t('Qualifications.createQualification')}</Button>
          </div>
        </form>
        {qualificationsResult.data?.length ? (
          <div className="grid gap-3">
            {qualificationsResult.data.map((definition) => (
              <DefinitionCard
                key={definition.id}
                definition={definition}
                updateAction={updateQualificationAction}
                archiveAction={archiveQualificationAction}
                noun="qualification"
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            {t('Qualifications.noQualifications')}
          </p>
        )}
      </section>
      <section aria-labelledby="skills-title" className="grid gap-4">
        <h2 id="skills-title" className="text-xl font-semibold">
          {t('Qualifications.skillsTitle')}
        </h2>
        <form
          action={createSkillAction}
          className="grid gap-4 rounded-lg border bg-white p-5 md:grid-cols-3"
        >
          <h3 className="text-lg font-medium md:col-span-3">{t('Qualifications.createSkill')}</h3>
          <Field
            id="skill-name"
            name="name"
            label={t('Common.fields.name')}
            required
            maxLength={160}
          />
          <Field id="skill-code" name="code" label={t('Common.fields.code')} maxLength={40} />
          <Field
            id="skill-description"
            name="description"
            label={t('Common.fields.description')}
            maxLength={1000}
          />
          <div className="md:col-span-3">
            <Button type="submit">{t('Qualifications.createSkill')}</Button>
          </div>
        </form>
        {skillsResult.data?.length ? (
          <div className="grid gap-3">
            {skillsResult.data.map((definition) => (
              <DefinitionCard
                key={definition.id}
                definition={definition}
                updateAction={updateSkillAction}
                archiveAction={archiveSkillAction}
                noun="skill"
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            {t('Qualifications.noSkills')}
          </p>
        )}
      </section>
    </div>
  );
}

async function DefinitionCard({
  definition,
  updateAction,
  archiveAction,
  noun,
}: Readonly<{
  definition: Definition;
  updateAction: FormAction;
  archiveAction: FormAction;
  noun: 'qualification' | 'skill';
}>) {
  const t = await getTranslations();
  const typeLabel =
    noun === 'qualification'
      ? t('Qualifications.types.qualification')
      : t('Qualifications.types.skill');
  const archiveConfirmation =
    noun === 'qualification'
      ? t('Qualifications.archiveQualificationConfirmation')
      : t('Qualifications.archiveSkillConfirmation');
  return (
    <article className="grid gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {definition.name}
            {definition.code ? ` · ${definition.code}` : ''}
          </h3>
          {definition.description ? (
            <p className="text-sm text-slate-600">{definition.description}</p>
          ) : null}
        </div>
        <StatusBadge status={definition.status} label={t(statusLabelKey(definition.status))} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <form action={updateAction} className="grid gap-3 md:col-span-3 md:grid-cols-3">
          <input type="hidden" name="id" value={definition.id} />
          <Field
            id={`${noun}-name-${definition.id}`}
            name="name"
            label={t('Common.fields.name')}
            defaultValue={definition.name}
            required
            maxLength={160}
          />
          <Field
            id={`${noun}-code-${definition.id}`}
            name="code"
            label={t('Common.fields.code')}
            defaultValue={definition.code ?? ''}
            maxLength={40}
          />
          <Field
            id={`${noun}-description-${definition.id}`}
            name="description"
            label={t('Common.fields.description')}
            defaultValue={definition.description ?? ''}
            maxLength={1000}
          />
          <div className="md:col-span-3">
            <Button type="submit" variant="secondary" disabled={definition.status === 'archived'}>
              {t('Qualifications.save')}
            </Button>
          </div>
        </form>
        {definition.status === 'active' ? (
          <form action={archiveAction}>
            <input type="hidden" name="id" value={definition.id} />
            <ConfirmSubmitButton confirmation={archiveConfirmation}>
              {t('Qualifications.archive')} {typeLabel}
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function Field({
  id,
  name,
  label,
  defaultValue = '',
  required = false,
  maxLength,
}: Readonly<{
  id: string;
  name: string;
  label: string;
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
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
      />
    </div>
  );
}
