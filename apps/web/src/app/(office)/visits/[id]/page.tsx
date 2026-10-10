import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import { auditActionKey } from '../../../../i18n/audit';
import { errorMessageKey } from '../../../../i18n/errors';
import {
  formatDateTime as formatLocaleDateTime,
  formatTime as formatLocaleTime,
} from '../../../../i18n/format';
import {
  documentationEntryTypeKey,
  documentationRequirementKey,
  documentationSeverityKey,
  executionReasonKey,
  executionServiceStatusKey,
  executionStatusKey,
  quantityUnitKey,
  visitStatusKey,
} from '../../../../i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../../lib/api';
import { ConfirmSubmitButton } from '../../administration/confirm-submit-button';
import { amendDocumentationAction } from '../../documentation/actions';
import {
  assignVisitAction,
  changeVisitStatusAction,
  correctVisitExecutionTimesAction,
  unassignVisitAction,
  updateVisitAction,
} from '../../planning/actions';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  employeeId?: string;
  conflictStart?: string;
  conflictEnd?: string;
  conflictTimezone?: string;
}>;

export default async function VisitDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const visitResult = await get('/api/v1/visits/{id}', { params: { path: { id }, header } });
  if (visitResult.error?.code === 'VISIT_NOT_FOUND') notFound();
  const visit = visitResult.data;
  if (!visit) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        {t('Visits.loadFailed')}
      </p>
    );
  }
  const employeesResult = await get('/api/v1/employees', {
    params: {
      query: {
        status: 'active',
        organizationId: visit.organizationId,
        facilityId: visit.facilityId,
        page: 1,
        pageSize: 100,
      },
      header,
    },
  });
  const permissions = await getPermissionGrants(api);
  const canReadExecution = hasPermission(permissions, 'visit_execution.read');
  const canCorrectExecution = hasPermission(permissions, 'visit_execution.correct');
  const canReadDocumentation = hasPermission(permissions, 'care_documentation.read');
  const canAmendDocumentation = hasPermission(permissions, 'care_documentation.amend');
  const executionResult = canReadExecution
    ? await get('/api/v1/visits/{visitId}/execution', {
        params: { path: { visitId: visit.id }, header },
      })
    : null;
  const executionDetail = executionResult?.data;
  const documentationResult = canReadDocumentation
    ? await get('/api/v1/visits/{visitId}/documentation', {
        params: { path: { visitId: visit.id }, header },
      })
    : null;
  const documentationDetail = documentationResult?.data;
  const canUpdate = hasPermission(permissions, 'schedule.update') && visit.status !== 'cancelled';
  const canAssign = hasPermission(permissions, 'schedule.assign') && visit.status !== 'cancelled';
  const canConfirm = hasPermission(permissions, 'schedule.confirm') && visit.status !== 'cancelled';
  const canCancel = hasPermission(permissions, 'schedule.cancel') && visit.status !== 'cancelled';
  const employees = employeesResult.data?.items ?? [];
  const conflictEmployee = employees.find((employee) => employee.id === query.employeeId);
  const conflictInterval = readConflictInterval(
    query.conflictStart,
    query.conflictEnd,
    query.conflictTimezone,
  );
  const localStart = localDateTime(visit.plannedStart, visit.timezone);
  const localEnd = localDateTime(visit.plannedEnd, visit.timezone);
  const dateTime = (value: string, timeZone: string) =>
    formatLocaleDateTime(value, locale, timeZone) ?? '–';
  const time = (value: string, timeZone: string) => formatLocaleTime(value, locale, timeZone);
  const quantity = (value: string | number, unit: string) =>
    t(quantityUnitKey(unit), { count: Number(value) });

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/planning">{t('Visits.planning')}</Link>
          </p>
          <h1 className="text-3xl font-semibold">{visit.clientDisplayName}</h1>
          <p className="text-slate-600">
            {visit.facilityName} · {visit.organizationName}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/planning">{t('Visits.backToPlanning')}</Link>
        </Button>
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {query.error === 'VISIT_EMPLOYEE_CONFLICT' && conflictInterval
            ? t('Visits.employeeConflict', {
                employee: conflictEmployee
                  ? `${conflictEmployee.preferredName || conflictEmployee.firstName} ${conflictEmployee.lastName}`
                  : t('Visits.unknownEmployee'),
                start: dateTime(conflictInterval.start, conflictInterval.timezone),
                end: time(conflictInterval.end, conflictInterval.timezone),
              })
            : t(errorMessageKey(query.error))}
        </p>
      ) : null}
      {query.updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t('Visits.saved')}
        </p>
      ) : null}

      <section aria-labelledby="visit-title" className="grid gap-4 rounded-lg border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="visit-title" className="text-xl font-semibold">
            {t('Visits.visit')}
          </h2>
          <Status label={t(visitStatusKey(visit.status))} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail
            label={t('Visits.time')}
            value={`${dateTime(visit.plannedStart, visit.timezone)}–${time(visit.plannedEnd, visit.timezone)}`}
          />
          <Detail label={t('Visits.timezone')} value={visit.timezone} />
          <Detail
            label={t('Visits.origin')}
            value={
              visit.origin === 'agreement_generated'
                ? t('Visits.agreementGenerated')
                : t('Visits.manuallyPlanned')
            }
          />
          <Detail
            label={t('Visits.manuallyAdjusted')}
            value={visit.manuallyAdjusted ? t('Visits.yes') : t('Visits.no')}
          />
          {visit.serviceAgreementId ? (
            <Detail
              label={t('Visits.serviceAgreement')}
              value={
                <Link
                  className="text-blue-800 underline"
                  href={`/clients/${visit.clientId}/service-agreements#agreement-${visit.serviceAgreementId}`}
                >
                  {t('Visits.openAgreement')}
                </Link>
              }
            />
          ) : null}
        </dl>
        <div>
          <h3 className="font-semibold">{t('Visits.plannedServices')}</h3>
          <ul className="mt-2 grid gap-2">
            {visit.services.map((service) => (
              <li key={service.id} className="rounded-md bg-slate-50 p-3">
                {service.serviceCode} · {service.serviceName} ·{' '}
                {quantity(service.plannedQuantity, service.unit)}
                {service.plannedDurationMinutes
                  ? ` · ${quantity(service.plannedDurationMinutes, 'minute')}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
        {visit.note ? (
          <div>
            <h3 className="font-semibold">{t('Visits.planningNote')}</h3>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{visit.note}</p>
          </div>
        ) : null}
      </section>

      {canReadExecution ? (
        <section
          aria-labelledby="execution-title"
          className="grid gap-4 rounded-lg border bg-white p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="execution-title" className="text-xl font-semibold">
              {t('Visits.executionTitle')}
            </h2>
            {executionDetail ? (
              <span className="rounded-full border px-3 py-1 text-sm">
                {t(executionStatusKey(executionDetail.execution.status))}
              </span>
            ) : null}
          </div>
          {executionResult?.error ? (
            <p role="alert" className="text-sm text-red-800">
              {t('Visits.executionLoadFailed')} {t(errorMessageKey(executionResult.error.code))}
            </p>
          ) : null}
          {executionDetail ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail
                  label={t('Visits.actualArrival')}
                  value={
                    executionDetail.execution.actualStart
                      ? dateTime(executionDetail.execution.actualStart, visit.timezone)
                      : t('Visits.notRecorded')
                  }
                />
                <Detail
                  label={t('Visits.actualDeparture')}
                  value={
                    executionDetail.execution.actualEnd
                      ? dateTime(executionDetail.execution.actualEnd, visit.timezone)
                      : t('Visits.notRecorded')
                  }
                />
                <Detail
                  label={t('Visits.startedBy')}
                  value={executionDetail.execution.startedByEmployeeName ?? '–'}
                />
                <Detail
                  label={t('Visits.completedBy')}
                  value={executionDetail.execution.completedByEmployeeName ?? '–'}
                />
              </dl>
              <div>
                <h3 className="font-semibold">{t('Visits.recordedServices')}</h3>
                {executionDetail.services.length ? (
                  <ul className="mt-2 grid gap-2">
                    {executionDetail.services.map((service, index) => (
                      <li
                        key={
                          service.id ??
                          service.visitServiceId ??
                          service.serviceDefinitionId + index
                        }
                        className="grid gap-1 rounded-md bg-slate-50 p-3"
                      >
                        <span className="font-medium">
                          {service.serviceName}
                          {service.unplanned ? ` · ${t('Visits.unplanned')}` : ''}
                        </span>
                        <span className="text-sm text-slate-700">
                          {t(executionServiceStatusKey(service.status))} · {t('Visits.planned')}{' '}
                          {service.plannedQuantity == null
                            ? '–'
                            : quantity(service.plannedQuantity, service.unit)}{' '}
                          · {t('Visits.actual')}{' '}
                          {service.actualQuantity == null
                            ? '–'
                            : quantity(service.actualQuantity, service.unit)}
                        </span>
                        {service.reasonCode ? (
                          <span className="text-sm text-slate-700">
                            {t('Visits.reason')}: {t(executionReasonKey(service.reasonCode))}
                          </span>
                        ) : null}
                        {service.performedByEmployeeName ? (
                          <span className="text-sm text-slate-600">
                            {t('Visits.capturedBy')} {service.performedByEmployeeName}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-slate-600">{t('Visits.noServiceOutcomes')}</p>
                )}
              </div>
              {canCorrectExecution &&
              executionDetail.execution.id &&
              executionDetail.execution.actualStart ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer font-semibold">
                    {t('Visits.correctTimes')}
                  </summary>
                  <form action={correctVisitExecutionTimesAction} className="mt-4 grid gap-4">
                    <input type="hidden" name="visitId" value={visit.id} />
                    <input type="hidden" name="clientId" value={visit.clientId} />
                    <input type="hidden" name="executionId" value={executionDetail.execution.id} />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={executionDetail.execution.version}
                    />
                    <input type="hidden" name="timezone" value={visit.timezone} />
                    <Field
                      label={t('Visits.actualArrival')}
                      name="actualStart"
                      type="datetime-local"
                      defaultValue={
                        localDateTime(executionDetail.execution.actualStart, visit.timezone).date +
                        'T' +
                        localDateTime(executionDetail.execution.actualStart, visit.timezone).time
                      }
                      required
                    />
                    {executionDetail.execution.status === 'completed' ? (
                      <Field
                        label={t('Visits.actualDeparture')}
                        name="actualEnd"
                        type="datetime-local"
                        defaultValue={
                          executionDetail.execution.actualEnd
                            ? localDateTime(executionDetail.execution.actualEnd, visit.timezone)
                                .date +
                              'T' +
                              localDateTime(executionDetail.execution.actualEnd, visit.timezone)
                                .time
                            : ''
                        }
                        required
                      />
                    ) : null}
                    <div className="grid gap-2">
                      <Label htmlFor="execution-correction-reason">
                        {t('Visits.correctionReason')}
                      </Label>
                      <textarea
                        id="execution-correction-reason"
                        name="reason"
                        required
                        maxLength={1000}
                        className="min-h-20 rounded-md border px-3 py-2"
                      />
                    </div>
                    <Button type="submit" className="min-h-11 w-fit">
                      {t('Visits.correctTimesAction')}
                    </Button>
                  </form>
                </details>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {canReadDocumentation ? (
        <section
          aria-labelledby="documentation-title"
          className="grid gap-4 rounded-lg border bg-white p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="documentation-title" className="text-xl font-semibold">
              {t('Visits.documentation')}
            </h2>
            {documentationDetail?.documentation ? (
              <span className="rounded-full border px-3 py-1 text-sm">
                {documentationDetail.documentation.status === 'finalized'
                  ? t('Visits.documentationStatus.finalized')
                  : t('Visits.documentationStatus.draft')}
              </span>
            ) : null}
          </div>
          {documentationResult?.error ? (
            <p role="alert" className="text-sm text-red-800">
              {t('Visits.documentationLoadFailed')}{' '}
              {t(errorMessageKey(documentationResult.error.code))}
            </p>
          ) : null}
          {documentationDetail ? (
            <>
              {documentationDetail.documentation ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Detail
                    label={t('Visits.createdBy')}
                    value={documentationDetail.documentation.createdByEmployeeName ?? '–'}
                  />
                  <Detail
                    label={t('Visits.finalizedBy')}
                    value={documentationDetail.documentation.finalizedByEmployeeName ?? '–'}
                  />
                  <Detail
                    label={t('Visits.finalizedOn')}
                    value={
                      documentationDetail.documentation.finalizedAt
                        ? dateTime(documentationDetail.documentation.finalizedAt, visit.timezone)
                        : t('Visits.notFinalized')
                    }
                  />
                  <Detail
                    label={t('Visits.completeness')}
                    value={
                      documentationDetail.completeness.isComplete
                        ? t('Visits.complete')
                        : t('Visits.incomplete')
                    }
                  />
                </dl>
              ) : (
                <p className="text-amber-900">{t('Visits.noDocumentation')}</p>
              )}
              {!documentationDetail.completeness.isComplete ? (
                <ul className="grid gap-1 rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                  {documentationDetail.completeness.missing.map((missing, index) => (
                    <li key={`${missing.code}-${missing.performedServiceId ?? index}`}>
                      {t(documentationRequirementKey(missing.code))}
                      {missing.performedServiceId
                        ? ` (${documentationDetail.services.find((service) => service.performedServiceId === missing.performedServiceId)?.serviceName ?? t('Visits.service')})`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div>
                <h3 className="font-semibold">{t('Visits.serviceEvidence')}</h3>
                {documentationDetail.services.length ? (
                  <ul className="mt-2 grid gap-2">
                    {documentationDetail.services.map((service) => (
                      <li
                        key={service.performedServiceId}
                        className="grid gap-1 rounded-md bg-slate-50 p-3"
                      >
                        <span className="font-medium">
                          {service.serviceName} ·{' '}
                          {service.evidence
                            ? t('Visits.evidencePresent')
                            : t('Visits.evidenceMissing')}
                        </span>
                        {service.evidence?.documentedByEmployeeName ? (
                          <span className="text-sm text-slate-600">
                            {t('Visits.capturedBy')} {service.evidence.documentedByEmployeeName}
                          </span>
                        ) : null}
                        {service.evidence?.note ? (
                          <p className="whitespace-pre-wrap text-sm">{service.evidence.note}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-slate-600">{t('Visits.noServiceResults')}</p>
                )}
              </div>
              <div>
                <h3 className="font-semibold">{t('Visits.entries')}</h3>
                {documentationDetail.entries.length ? (
                  <ul className="mt-2 grid gap-2">
                    {documentationDetail.entries.map((entry) => (
                      <li key={entry.id} className="rounded-md bg-slate-50 p-3">
                        <p className="text-sm font-semibold">
                          {t(documentationEntryTypeKey(entry.type))}
                          {entry.severity
                            ? ` · ${t(documentationSeverityKey(entry.severity))}`
                            : ''}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{entry.content}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {entry.authorEmployeeName ?? t('Visits.employee')} ·{' '}
                          {dateTime(entry.createdAt, visit.timezone)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-slate-600">{t('Visits.noEntries')}</p>
                )}
              </div>
              {documentationDetail.amendments.length ? (
                <div>
                  <h3 className="font-semibold">{t('Visits.amendments')}</h3>
                  <ul className="mt-2 grid gap-2">
                    {documentationDetail.amendments.map((amendment) => (
                      <li key={amendment.id} className="rounded-md bg-slate-50 p-3">
                        <p className="font-medium">{amendment.reason}</p>
                        <p className="mt-1 whitespace-pre-wrap">{amendment.correction}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {dateTime(amendment.createdAt, visit.timezone)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {documentationDetail.history.length ? (
                <div>
                  <h3 className="font-semibold">{t('Visits.history')}</h3>
                  <ul className="mt-2 grid gap-1 text-sm text-slate-600">
                    {documentationDetail.history.map((entry) => (
                      <li key={entry.id}>
                        {t(auditActionKey(entry.action))} ·{' '}
                        {dateTime(entry.occurredAt, visit.timezone)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {canAmendDocumentation &&
              documentationDetail.documentation?.status === 'finalized' ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer font-semibold">
                    {t('Visits.amendDocumentation')}
                  </summary>
                  <form action={amendDocumentationAction} className="mt-4 grid gap-3">
                    <input type="hidden" name="visitId" value={visit.id} />
                    <input
                      type="hidden"
                      name="documentationId"
                      value={documentationDetail.documentation.id}
                    />
                    <label className="grid gap-1 text-sm">
                      <span>{t('Visits.reason')}</span>
                      <input
                        name="reason"
                        required
                        maxLength={500}
                        className="min-h-11 rounded-md border px-3"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>{t('Visits.correction')}</span>
                      <textarea
                        name="correction"
                        required
                        maxLength={4000}
                        className="min-h-24 rounded-md border px-3 py-2"
                      />
                    </label>
                    <Button type="submit" className="min-h-11 w-fit">
                      {t('Visits.saveAmendment')}
                    </Button>
                  </form>
                </details>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {canUpdate ? (
        <section
          aria-labelledby="reschedule-title"
          className="grid gap-3 rounded-lg border bg-white p-5"
        >
          <h2 id="reschedule-title" className="text-xl font-semibold">
            {t('Visits.reschedule')}
          </h2>
          <form action={updateVisitAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="visitId" value={visit.id} />
            <Field
              label={t('Visits.date')}
              name="localDate"
              type="date"
              defaultValue={localStart.date}
              required
            />
            <Field
              label={t('Visits.start')}
              name="localStartTime"
              type="time"
              defaultValue={localStart.time}
              required
            />
            <Field
              label={t('Visits.end')}
              name="localEndTime"
              type="time"
              defaultValue={localEnd.time}
              required
            />
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="visit-note">{t('Visits.planningNote')}</Label>
              <textarea
                id="visit-note"
                name="note"
                defaultValue={visit.note ?? ''}
                maxLength={2000}
                className="min-h-20 rounded-md border px-3 py-2"
              />
            </div>
            <Button type="submit" className="w-fit">
              {t('Visits.save')}
            </Button>
          </form>
        </section>
      ) : null}

      <section
        aria-labelledby="assignments-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="assignments-title" className="text-xl font-semibold">
          {t('Visits.employees')}
        </h2>
        {visit.assignments.length ? (
          <ul className="grid gap-2">
            {visit.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <span>
                  {assignment.employeeDisplayName}
                  {assignment.role ? ` · ${assignment.role}` : ''}
                </span>
                {canAssign ? (
                  <form action={unassignVisitAction}>
                    <input type="hidden" name="visitId" value={visit.id} />
                    <input type="hidden" name="assignmentId" value={assignment.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      {t('Visits.unassign')}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">{t('Visits.noAssignees')}</p>
        )}
        {canAssign ? (
          employees.length ? (
            <form action={assignVisitAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="visitId" value={visit.id} />
              <div className="grid gap-2">
                <Label htmlFor="employeeId">{t('Visits.assignEmployee')}</Label>
                <select
                  id="employeeId"
                  name="employeeId"
                  required
                  className="h-10 rounded-md border bg-white px-3"
                >
                  <option value="">{t('Visits.selectEmployee')}</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.preferredName || employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">{t('Visits.assign')}</Button>
            </form>
          ) : (
            <p className="text-sm text-slate-600">{t('Visits.noActiveEmployees')}</p>
          )
        ) : null}
      </section>

      {canConfirm || canCancel ? (
        <section aria-label={t('Visits.statusActions')} className="flex flex-wrap gap-2">
          {canConfirm && visit.status === 'planned' ? (
            <StatusAction visitId={visit.id} operation="confirm" label={t('Visits.confirm')} />
          ) : null}
          {canConfirm && visit.status === 'confirmed' ? (
            <StatusAction visitId={visit.id} operation="unconfirm" label={t('Visits.unconfirm')} />
          ) : null}
          {canCancel ? (
            <form action={changeVisitStatusAction}>
              <input type="hidden" name="visitId" value={visit.id} />
              <input type="hidden" name="operation" value="cancel" />
              <ConfirmSubmitButton confirmation={t('Visits.cancelConfirmation')}>
                {t('Visits.cancelVisit')}
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby="history-title"
        className="grid gap-3 rounded-lg border bg-white p-5"
      >
        <h2 id="history-title" className="text-xl font-semibold">
          {t('Visits.history')}
        </h2>
        {visit.history.length ? (
          <ol className="grid gap-2">
            {visit.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
                <span>{t(auditActionKey(entry.action))}</span>
                <span className="text-sm text-slate-600">
                  {t('Visits.editedBy', { actor: entry.actorId })}
                </span>
                <time dateTime={entry.timestamp}>{dateTime(entry.timestamp, visit.timezone)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-slate-600">{t('Visits.noChanges')}</p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type: string;
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Status({ label }: { label: string }) {
  return <span className="rounded-full border px-3 py-1 text-sm">{label}</span>;
}

function StatusAction({
  visitId,
  operation,
  label,
}: {
  visitId: string;
  operation: 'confirm' | 'unconfirm';
  label: string;
}) {
  return (
    <form action={changeVisitStatusAction}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="operation" value={operation} />
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

function localDateTime(value: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (key: string) => parts.find((entry) => entry.type === key)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

function readConflictInterval(
  start: string | undefined,
  end: string | undefined,
  timeZone: string | undefined,
): { start: string; end: string; timezone: string } | null {
  if (!start || !end || !timeZone) return null;
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(startTime));
    return { start, end, timezone: timeZone };
  } catch {
    return null;
  }
}
