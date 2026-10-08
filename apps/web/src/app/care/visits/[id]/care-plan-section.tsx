import { getTranslations } from 'next-intl/server';
import type { components } from '@care/api-client';
import { formatDate } from '../../../../i18n/format';
import type { Locale } from '../../../../i18n/config';

const statusKeys = {
  draft: 'statuses.draft',
  active: 'statuses.active',
  under_review: 'statuses.underReview',
  ended: 'statuses.ended',
} as const;

const measureCategoryKeys = {
  personal_care: 'options.measureCategory.personalCare',
  assistance: 'options.measureCategory.assistance',
  encouragement: 'options.measureCategory.encouragement',
  monitoring: 'options.measureCategory.monitoring',
  positioning: 'options.measureCategory.positioning',
  communication: 'options.measureCategory.communication',
  other: 'options.measureCategory.other',
} as const;

type CarePlanView = components['schemas']['VisitCarePlanDto'];

export async function CarePlanSection({
  plan,
  loadFailed,
  locale,
}: {
  plan: CarePlanView | null;
  loadFailed: boolean;
  locale: Locale;
}) {
  const t = await getTranslations('CarePlanning');

  return (
    <section
      aria-labelledby="care-plan-title"
      className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5"
    >
      <header>
        <h2 id="care-plan-title" className="text-xl font-semibold">
          {t('caregiver.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t('caregiver.description')}</p>
      </header>

      {loadFailed ? (
        <p role="alert" className="text-red-800">
          {t('caregiver.loadFailed')}
        </p>
      ) : !plan ? (
        <p className="rounded-md bg-slate-50 p-3 text-slate-700">{t('caregiver.noPlan')}</p>
      ) : (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium">{t('caregiver.status')}</dt>
              <dd>{t(statusKeys[plan.status])}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('caregiver.validFrom')}</dt>
              <dd>{formatDate(plan.validFrom, locale)}</dd>
            </div>
            {plan.validUntil ? (
              <div>
                <dt className="font-medium">{t('caregiver.validUntil')}</dt>
                <dd>{formatDate(plan.validUntil, locale)}</dd>
              </div>
            ) : null}
          </dl>

          <section aria-labelledby="care-plan-measures-title" className="grid gap-3">
            <h3 id="care-plan-measures-title" className="text-lg font-semibold">
              {t('caregiver.measures')}
            </h3>
            {plan.measures.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {plan.measures.map((measure) => (
                  <li key={measure.id} className="grid gap-1 rounded-md border p-3">
                    <p className="font-semibold">{measure.title}</p>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">
                      {measure.instruction}
                    </p>
                    <p className="text-sm text-slate-600">
                      {t('caregiver.category')}: {t(measureCategoryKeys[measure.category])}
                    </p>
                    {measure.frequencyText ? (
                      <p className="text-sm text-slate-600">
                        {t('caregiver.frequency')}: {measure.frequencyText}
                      </p>
                    ) : null}
                    {measure.responsibleRole ? (
                      <p className="text-sm text-slate-600">
                        {t('caregiver.responsibleRole')}: {measure.responsibleRole}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md bg-slate-50 p-3 text-slate-700">
                {t('caregiver.noMeasures')}
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
