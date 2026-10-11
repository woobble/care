import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { taskStatusTranslation } from '@app/web/app/(office)/operations/ui';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Params = Promise<{ id: string }>;

export default async function RecurringTaskDetailsPage({ params }: Readonly<{ params: Params }>) {
  const [t, locale] = await Promise.all([getTranslations('Operations'), getLocale()]);
  const { id } = await params;
  if (!uuidPattern.test(id))
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('recurrenceNotFound')}
      </p>
    );
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'operations.read'))
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  const [definitionResult, occurrencesResult] = await Promise.all([
    api.GET('/api/v1/operations/recurring-tasks/{id}', { params: { path: { id }, header } }),
    api.GET('/api/v1/operations/recurring-tasks/{id}/occurrences', {
      params: { path: { id }, header },
    }),
  ]);
  const definition = definitionResult.data;
  const occurrences = occurrencesResult.data ?? [];
  if (!definition)
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('recurrenceNotFound')}
      </p>
    );
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('recurringTasks')}
          </p>
          <h1 className="text-3xl font-semibold">{definition.title}</h1>
          <p className="text-slate-700">
            {t('nextOccurrence')}:{' '}
            {definition.nextOccurrenceAt
              ? formatDateTime(
                  definition.nextOccurrenceAt,
                  locale as 'en' | 'de',
                  definition.timezone,
                )
              : t('noDueDate')}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/operations/recurring-tasks">{t('recurringTasks')}</Link>
        </Button>
      </header>
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">{t('generatedTasks')}</h2>
        {occurrences.length ? (
          <ul className="grid gap-3">
            {occurrences.map((occurrence) => (
              <li
                key={occurrence.taskId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4"
              >
                <span className="grid gap-1">
                  <strong>{occurrence.title}</strong>
                  <span className="text-sm text-slate-600">
                    {formatDateTime(occurrence.dueAt, locale as 'en' | 'de', definition.timezone)} ·{' '}
                    {t(taskStatusTranslation(occurrence.status))}
                  </span>
                </span>
                <Link
                  className="text-sm font-medium text-blue-800 underline"
                  href={`/operations/tasks/${occurrence.taskId}`}
                >
                  {t('openTask')}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-white p-5">{t('noGeneratedTasks')}</p>
        )}
      </section>
    </div>
  );
}
