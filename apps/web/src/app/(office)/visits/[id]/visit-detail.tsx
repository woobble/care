import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import { amendDocumentationAction } from '@app/web/app/(office)/documentation/actions';
import {
  assignVisitAction,
  cancelSubstitutionAction,
  changeVisitStatusAction,
  confirmSubstitutionAction,
  correctVisitExecutionTimesAction,
  proposeSubstitutionAction,
  unassignVisitAction,
  updateVisitAction,
} from '@app/web/app/(office)/planning/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { auditActionKey } from '@app/web/i18n/audit';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  formatDateTime as formatLocaleDateTime,
  formatTime as formatLocaleTime,
} from '@app/web/i18n/format';
import {
  documentationEntryTypeKey,
  documentationRequirementKey,
  documentationSeverityKey,
  executionReasonKey,
  executionServiceStatusKey,
  executionStatusKey,
  quantityUnitKey,
  visitStatusKey,
} from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { safePlanningReturnTo } from '@app/web/lib/planning-return-to';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import { Textarea } from '@care/ui/components/textarea';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  returnTo?: string;
  employeeId?: string;
  conflictStart?: string;
  conflictEnd?: string;
  conflictTimezone?: string;
}>;

export type VisitDetailPageProps = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}>;

export default async function VisitDetailContent({ params, searchParams }: VisitDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const returnTo = safePlanningReturnTo(query.returnTo) ?? '/planning';
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const tenantId = header['X-Tenant-Id'];
  const get = api.GET;
  const visitResult = await get('/api/v1/visits/{id}', { params: { path: { id }, header } });
  if (visitResult.error?.code === 'VISIT_NOT_FOUND') notFound();
  const visit = visitResult.data;
  if (!visit) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive"
      >
        {t('Visits.loadFailed')}
      </p>
    );
  }
  const permissions = await getPermissionGrants(api);
  const conflictEmployeeResult =
    query.employeeId && hasPermission(permissions, 'employee.read')
      ? await get('/api/v1/employees/{id}', {
          params: { path: { id: query.employeeId }, header },
        })
      : null;
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
  const [candidateResult, worklistResult] = canAssign
    ? await Promise.all([
        get('/api/v1/visits/{id}/substitute-candidates', {
          params: { path: { id: visit.id }, header },
        }),
        get('/api/v1/scheduling/worklist', {
          params: {
            query: {
              from: visit.plannedStart,
              until: visit.plannedEnd,
              page: 1,
              pageSize: 100,
            },
            header,
          },
        }),
      ])
    : [null, null];
  const conflictEmployee = conflictEmployeeResult?.data as
    | components['schemas']['EmployeeDetailResponseDto']
    | undefined;
  const substituteCandidates = candidateResult?.data ?? [];
  const proposedSubstitutions =
    worklistResult?.data?.items.find((item) => item.visit.id === visit.id)?.proposedSubstitutions ??
    [];
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
    <div className="mx-auto grid w-full max-w-4xl min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        eyebrow={<Link href={returnTo}>{t('Visits.planning')}</Link>}
        title={visit.clientDisplayName}
        meta={
          <p className="text-sm break-words text-muted-foreground">
            {visit.facilityName} · {visit.organizationName}
          </p>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href={returnTo}>{t('Visits.backToPlanning')}</Link>
          </Button>
        }
      />

      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
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
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {query.updated === 'substitution_proposed'
            ? t('Visits.substitutionProposed')
            : query.updated === 'substitution_confirmed'
              ? t('Visits.substitutionConfirmed')
              : query.updated === 'substitution_cancelled'
                ? t('Visits.substitutionCancelled')
                : t('Visits.saved')}
        </p>
      ) : null}

      <section
        aria-labelledby="visit-title"
        className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
      >
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
          {visit.serviceAgreementId &&
          hasClientPermission(
            permissions,
            'client.read',
            tenantId,
            visit.organizationId,
            visit.facilityId,
          ) &&
          hasClientPermission(
            permissions,
            'service_agreement.read',
            tenantId,
            visit.organizationId,
            visit.facilityId,
          ) ? (
            <Detail
              label={t('Visits.serviceAgreement')}
              value={
                <Link
                  className="text-primary underline"
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
          <ul className="mt-2 grid min-w-0 gap-2">
            {visit.services.map((service) => (
              <li key={service.id} className="min-w-0 rounded-md bg-background p-3 break-words">
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
            <p className="mt-1 break-words whitespace-pre-wrap text-muted-foreground">
              {visit.note}
            </p>
          </div>
        ) : null}
      </section>

      {canReadExecution ? (
        <section
          aria-labelledby="execution-title"
          className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
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
            <p role="alert" className="text-sm text-destructive">
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
                        className="grid gap-1 rounded-md bg-background p-3"
                      >
                        <span className="font-medium">
                          {service.serviceName}
                          {service.unplanned ? ` · ${t('Visits.unplanned')}` : ''}
                        </span>
                        <span className="text-sm text-muted-foreground">
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
                          <span className="text-sm text-muted-foreground">
                            {t('Visits.reason')}: {t(executionReasonKey(service.reasonCode))}
                          </span>
                        ) : null}
                        {service.performedByEmployeeName ? (
                          <span className="text-sm text-muted-foreground">
                            {t('Visits.capturedBy')} {service.performedByEmployeeName}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">{t('Visits.noServiceOutcomes')}</p>
                )}
              </div>
              {canCorrectExecution &&
              executionDetail.execution.id &&
              executionDetail.execution.actualStart ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer font-semibold">
                    {t('Visits.correctTimes')}
                  </summary>
                  <RHFActionForm
                    action={correctVisitExecutionTimesAction}
                    className="mt-4 grid gap-4"
                  >
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
                      <Textarea
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
                  </RHFActionForm>
                </details>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {canReadDocumentation ? (
        <section
          aria-labelledby="documentation-title"
          className="grid min-w-0 gap-4 rounded-lg border bg-card p-5"
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
            <p role="alert" className="text-sm text-destructive">
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
                <p className="text-warning-foreground">{t('Visits.noDocumentation')}</p>
              )}
              {!documentationDetail.completeness.isComplete ? (
                <ul className="grid gap-1 rounded-md bg-warning-muted p-3 text-sm text-warning-foreground">
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
                        className="grid gap-1 rounded-md bg-background p-3"
                      >
                        <span className="font-medium">
                          {service.serviceName} ·{' '}
                          {service.evidence
                            ? t('Visits.evidencePresent')
                            : t('Visits.evidenceMissing')}
                        </span>
                        {service.evidence?.documentedByEmployeeName ? (
                          <span className="text-sm text-muted-foreground">
                            {t('Visits.capturedBy')} {service.evidence.documentedByEmployeeName}
                          </span>
                        ) : null}
                        {service.evidence?.note ? (
                          <p className="text-sm whitespace-pre-wrap">{service.evidence.note}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">{t('Visits.noServiceResults')}</p>
                )}
              </div>
              <div>
                <h3 className="font-semibold">{t('Visits.entries')}</h3>
                {documentationDetail.entries.length ? (
                  <ul className="mt-2 grid gap-2">
                    {documentationDetail.entries.map((entry) => (
                      <li key={entry.id} className="rounded-md bg-background p-3">
                        <p className="text-sm font-semibold">
                          {t(documentationEntryTypeKey(entry.type))}
                          {entry.severity
                            ? ` · ${t(documentationSeverityKey(entry.severity))}`
                            : ''}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{entry.content}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {entry.authorEmployeeName ?? t('Visits.employee')} ·{' '}
                          {dateTime(entry.createdAt, visit.timezone)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">{t('Visits.noEntries')}</p>
                )}
              </div>
              {documentationDetail.amendments.length ? (
                <div>
                  <h3 className="font-semibold">{t('Visits.amendments')}</h3>
                  <ul className="mt-2 grid gap-2">
                    {documentationDetail.amendments.map((amendment) => (
                      <li key={amendment.id} className="rounded-md bg-background p-3">
                        <p className="font-medium">{amendment.reason}</p>
                        <p className="mt-1 whitespace-pre-wrap">{amendment.correction}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
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
                  <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
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
                  <RHFActionForm action={amendDocumentationAction} className="mt-4 grid gap-3">
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
                      <Textarea
                        name="correction"
                        required
                        maxLength={4000}
                        className="min-h-24 rounded-md border px-3 py-2"
                      />
                    </label>
                    <Button type="submit" className="min-h-11 w-fit">
                      {t('Visits.saveAmendment')}
                    </Button>
                  </RHFActionForm>
                </details>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {canUpdate ? (
        <section
          aria-labelledby="reschedule-title"
          className="grid gap-3 rounded-lg border bg-card p-5"
        >
          <h2 id="reschedule-title" className="text-xl font-semibold">
            {t('Visits.reschedule')}
          </h2>
          <form action={updateVisitAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="visitId" value={visit.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field
              id="visit-detail-date"
              label={t('Visits.date')}
              name="localDate"
              type="date"
              defaultValue={localStart.date}
              required
            />
            <Field
              id="visit-detail-start-time"
              label={t('Visits.start')}
              name="localStartTime"
              type="time"
              defaultValue={localStart.time}
              required
            />
            <Field
              id="visit-detail-end-time"
              label={t('Visits.end')}
              name="localEndTime"
              type="time"
              defaultValue={localEnd.time}
              required
            />
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="visit-detail-note">{t('Visits.planningNote')}</Label>
              <Textarea
                id="visit-detail-note"
                name="note"
                defaultValue={visit.note ?? ''}
                maxLength={2000}
                className="min-h-20 w-full min-w-0 rounded-md border px-3 py-2"
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
        className="grid min-w-0 gap-3 rounded-lg border bg-card p-5"
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
          <p className="text-muted-foreground">{t('Visits.noAssignees')}</p>
        )}
        {canAssign ? (
          <RHFActionForm
            action={assignVisitAction}
            className="grid min-w-0 gap-3 sm:flex sm:flex-wrap sm:items-end"
          >
            <input type="hidden" name="visitId" value={visit.id} />
            <AsyncEntityCombobox
              name="employeeId"
              entity="employees"
              label={t('Visits.assignEmployee')}
              placeholder={t('Visits.selectEmployee')}
              organizationId={visit.organizationId}
              facilityId={visit.facilityId ?? undefined}
              required
            />
            <Button type="submit">{t('Visits.assign')}</Button>
          </RHFActionForm>
        ) : null}
        {proposedSubstitutions.length ? (
          <div className="grid gap-3 rounded-md border border-warning/40 bg-warning-muted p-3">
            <h3 className="font-semibold">{t('Visits.substitutionPending')}</h3>
            {proposedSubstitutions.map((substitution) => {
              const candidate = substituteCandidates.find(
                (item) => item.employeeId === substitution.substituteEmployeeId,
              );
              return (
                <div
                  key={substitution.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="text-sm">
                    {t('Visits.substitutionProposedFor', {
                      employee: candidate?.displayName ?? t('Resources.unavailableEmployee'),
                    })}
                    {' · '}
                    {substitution.reason}
                  </p>
                  {canAssign ? (
                    <div className="flex gap-2">
                      <form action={confirmSubstitutionAction}>
                        <input type="hidden" name="visitId" value={visit.id} />
                        <input type="hidden" name="substitutionId" value={substitution.id} />
                        <Button type="submit" size="sm">
                          {t('Visits.confirmSubstitution')}
                        </Button>
                      </form>
                      <form action={cancelSubstitutionAction}>
                        <input type="hidden" name="visitId" value={visit.id} />
                        <input type="hidden" name="substitutionId" value={substitution.id} />
                        <Button type="submit" size="sm" variant="secondary">
                          {t('Visits.cancelSubstitution')}
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {canAssign && visit.assignments.length && !proposedSubstitutions.length ? (
          <div className="grid gap-3 rounded-md border-t pt-4">
            <h3 className="font-semibold">{t('Visits.proposeSubstitute')}</h3>
            {substituteCandidates.length ? (
              visit.assignments.map((assignment) => (
                <RHFActionForm
                  key={assignment.id}
                  action={proposeSubstitutionAction}
                  className="grid min-w-0 gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end"
                >
                  <input type="hidden" name="visitId" value={visit.id} />
                  <input type="hidden" name="originalAssignmentId" value={assignment.id} />
                  <p className="text-sm md:pb-2">
                    {t('Visits.substitutingFor', { employee: assignment.employeeDisplayName })}
                  </p>
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`substitute-${assignment.id}`}>
                      {t('Visits.substituteEmployee')}
                    </Label>
                    <NativeSelect
                      id={`substitute-${assignment.id}`}
                      name="substituteEmployeeId"
                      required
                      selectClassName="h-10 w-full min-w-0 max-w-full rounded-md border bg-card px-3"
                      className="w-full"
                    >
                      <option value="">{t('Visits.selectSubstitute')}</option>
                      {substituteCandidates.map((candidate) => (
                        <option key={candidate.employeeId} value={candidate.employeeId}>
                          {candidate.displayName}
                          {candidate.preferred ? ` · ${t('Visits.preferredCandidate')}` : ''}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`substitution-reason-${assignment.id}`}>
                      {t('Visits.substitutionReason')}
                    </Label>
                    <Input
                      id={`substitution-reason-${assignment.id}`}
                      name="reason"
                      maxLength={500}
                      required
                    />
                  </div>
                  <Button type="submit">{t('Visits.proposeSubstitute')}</Button>
                </RHFActionForm>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t('Visits.noSubstituteCandidates')}</p>
            )}
          </div>
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

      <section aria-labelledby="history-title" className="grid gap-3 rounded-lg border bg-card p-5">
        <h2 id="history-title" className="text-xl font-semibold">
          {t('Visits.history')}
        </h2>
        {visit.history.length ? (
          <ol className="grid gap-2">
            {visit.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
                <span>{t(auditActionKey(entry.action))}</span>
                <span className="text-sm text-muted-foreground">
                  {t('Visits.editedBy', { actor: t('Resources.unavailableUser') })}
                </span>
                <time dateTime={entry.timestamp}>{dateTime(entry.timestamp, visit.timezone)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">{t('Visits.noChanges')}</p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  id = name,
  type,
  defaultValue,
  required,
}: {
  id?: string;
  label: string;
  name: string;
  type: string;
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
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
