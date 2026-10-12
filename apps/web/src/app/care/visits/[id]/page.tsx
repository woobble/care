import Link from 'next/link';
import { notFound } from 'next/navigation';
import { v7 as uuidv7 } from 'uuid';
import type { components } from '@care/api-client';
import { Button, Input, Label } from '@care/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatNumber } from '@app/web/i18n/format';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { formatVisitDateTime, formatVisitTime } from '@app/web/lib/care-date';
import type { Locale } from '@app/web/i18n/config';
import { CareForm } from '@app/web/app/care/care-form';
import {
  addDocumentationEntryAction,
  completeVisitAction,
  createDocumentationAction,
  finalizeDocumentationAction,
  recordPerformedServiceAction,
  recordServiceEvidenceAction,
  startVisitAction,
  updateDocumentationEntryAction,
} from '@app/web/app/care/actions';

type SearchParams = Promise<{ error?: string; notice?: string }>;

export default async function CareVisitPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const { data, error } = await get('/api/v1/visits/{visitId}/execution', {
    params: { path: { visitId: id }, header },
  });
  if (error?.code === 'VISIT_EXECUTION_NOT_FOUND') notFound();
  if (!data) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        {t('VisitExecution.loadFailed')} {error?.code ? t(errorMessageKey(error.code)) : null}
      </p>
    );
  }

  const { visit, execution, services } = data;
  const [documentationResult, availableResult] = await Promise.all([
    get('/api/v1/visits/{visitId}/documentation', {
      params: { path: { visitId: id }, header },
    }),
    execution.status === 'in_progress'
      ? get('/api/v1/visits/{visitId}/execution/available-services', {
          params: { path: { visitId: id }, header },
        })
      : Promise.resolve(null),
  ]);
  const evidencePackageResult =
    documentationResult.data?.documentation?.status === 'finalized'
      ? await get('/api/v1/visits/{visitId}/evidence-package', {
          params: { path: { visitId: id }, header },
        })
      : null;
  const evidenceStatusUnavailable = Boolean(
    evidencePackageResult &&
    ((!evidencePackageResult.data &&
      evidencePackageResult.error?.code !== 'EVIDENCE_PACKAGE_NOT_FOUND') ||
      (evidencePackageResult.error &&
        evidencePackageResult.error.code !== 'EVIDENCE_PACKAGE_NOT_FOUND')),
  );
  const availableServices = availableResult?.data ?? [];
  const availableServicesUnavailable = Boolean(
    availableResult && (availableResult.error || !availableResult.data),
  );
  const unresolved = services.some((service) => service.status === 'not_recorded');
  const startAllowed = execution.status === 'not_started' && visit.status !== 'cancelled';

  return (
    <div className="mx-auto grid grid-cols-1 max-w-3xl gap-5 min-w-0">
      <header className="grid gap-3 min-w-0">
        <Link className="w-fit text-sm font-semibold text-blue-800 underline" href="/care/today">
          {t('VisitExecution.backToToday')}
        </Link>
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            {t('VisitExecution.section')}
          </p>
          <h1 className="mt-1 text-3xl font-semibold wrap-anywhere">{visit.clientDisplayName}</h1>
        </div>
        <p className="text-slate-700">
          {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}–
          {formatVisitTime(visit.plannedEnd, visit.timezone, locale)}
        </p>
        {visit.address ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="break-words text-slate-700">{visit.address}</p>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(visit.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 content-center font-semibold text-blue-800 underline"
            >
              {t('Caregiver.openNavigation')}
            </a>
          </div>
        ) : null}
        {visit.note ? (
          <section className="grid gap-1 rounded-md border bg-white p-3">
            <h2 className="font-semibold">{t('VisitExecution.visitNote')}</h2>
            <p className="whitespace-pre-wrap text-slate-700 wrap-anywhere">{visit.note}</p>
          </section>
        ) : null}
        {visit.schedulingPreferences &&
        (visit.schedulingPreferences.preferredWeekdays.length > 0 ||
          visit.schedulingPreferences.preferredTimeWindows.length > 0) ? (
          <section className="grid gap-1 rounded-md border bg-white p-3">
            <h2 className="font-semibold">{t('VisitExecution.clientSchedulingPreferences')}</h2>
            {visit.schedulingPreferences.preferredWeekdays.length ? (
              <p className="text-sm text-slate-700">
                {t('VisitExecution.preferredWeekdays')}:{' '}
                {visit.schedulingPreferences.preferredWeekdays
                  .map((weekday) => weekdayName(weekday, locale))
                  .join(', ')}
              </p>
            ) : null}
            {visit.schedulingPreferences.preferredTimeWindows.length ? (
              <p className="text-sm text-slate-700">
                {t('VisitExecution.preferredTimeWindows')}:{' '}
                {visit.schedulingPreferences.preferredTimeWindows
                  .map((window) => `${window.startsAt}–${window.endsAt}`)
                  .join(', ')}
              </p>
            ) : null}
          </section>
        ) : null}
      </header>

      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('VisitExecution.changeFailed')} {t(errorMessageKey(query.error))}
          {query.error === 'VISIT_EXECUTION_VERSION_CONFLICT'
            ? ` ${t('VisitExecution.retryAfterConflict')}`
            : ''}
        </p>
      ) : null}
      {query.notice ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t(noticeKey(query.notice))}
        </p>
      ) : null}

      <p className="rounded-md border bg-white p-3 text-sm text-slate-600">
        {t('Caregiver.drafts.disclosure')}
      </p>

      <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{t('VisitExecution.execution')}</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
            {t(executionStatusKey(execution.status))}
          </span>
        </div>
        {execution.actualStart ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Time
              label={t('VisitExecution.arrival')}
              value={execution.actualStart}
              timezone={visit.timezone}
              locale={locale}
            />
            {execution.actualEnd ? (
              <Time
                label={t('VisitExecution.departure')}
                value={execution.actualEnd}
                timezone={visit.timezone}
                locale={locale}
              />
            ) : null}
          </dl>
        ) : (
          <p className="text-slate-600">{t('VisitExecution.arrivalCaptured')}</p>
        )}
        {startAllowed ? (
          <CareForm action={startVisitAction} notice={query.notice}>
            <input type="hidden" name="visitId" value={visit.id} />
            <Button type="submit" className="min-h-12 w-full text-base sm:w-fit">
              {t('VisitExecution.start')}
            </Button>
          </CareForm>
        ) : null}
        {visit.status === 'cancelled' ? (
          <p className="rounded-md bg-slate-100 p-3 text-slate-700">
            {t('VisitExecution.cancelled')}
          </p>
        ) : null}
        {execution.startedByEmployeeName ? (
          <p className="text-sm text-slate-600">
            {t('VisitExecution.startedBy', { employee: execution.startedByEmployeeName })}
          </p>
        ) : null}
        {execution.completedByEmployeeName ? (
          <p className="text-sm text-slate-600">
            {t('VisitExecution.completedBy', { employee: execution.completedByEmployeeName })}
          </p>
        ) : null}
      </section>

      <CompletionChecklist
        executionStatus={execution.status}
        serviceStatuses={services.map((service) => service.status)}
        documentation={documentationResult.data}
        documentationUnavailable={Boolean(documentationResult.error || !documentationResult.data)}
      />

      <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">{t('VisitExecution.plannedServices')}</h2>
        {services.filter((service) => !service.unplanned).length ? (
          <ul className="grid gap-4">
            {services
              .filter((service) => !service.unplanned)
              .map((service) => (
                <li key={service.visitServiceId}>
                  <ServiceCard
                    visitId={visit.id}
                    version={execution.version}
                    service={service}
                    performedServiceId={service.id ?? uuidv7()}
                    editable={execution.status === 'in_progress'}
                    locale={locale}
                    notice={query.notice}
                  />
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-slate-600">{t('VisitExecution.noPlannedServices')}</p>
        )}
        {services.some((service) => service.unplanned) ? (
          <div className="grid gap-3 border-t pt-4">
            <h3 className="font-semibold">{t('VisitExecution.additionalServices')}</h3>
            {services
              .filter((service) => service.unplanned)
              .map((service) => (
                <ServiceCard
                  key={service.id}
                  visitId={visit.id}
                  version={execution.version}
                  service={service}
                  performedServiceId={service.id ?? uuidv7()}
                  editable={execution.status === 'in_progress'}
                  locale={locale}
                  notice={query.notice}
                />
              ))}
          </div>
        ) : null}
      </section>

      {execution.status === 'in_progress' ? (
        <>
          <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
            <h2 className="text-xl font-semibold">{t('VisitExecution.unplannedService')}</h2>
            {availableServicesUnavailable ? (
              <p role="status" className="text-amber-900">
                {t('VisitExecution.availableServicesUnavailable')}
              </p>
            ) : availableServices.length ? (
              <CareForm
                action={recordPerformedServiceAction}
                className="grid gap-4"
                notice={query.notice}
                successNotices={['service-saved']}
                draft={{
                  visitId: visit.id,
                  formId: 'unplanned-service',
                  revision: `execution:${execution.version}`,
                  fields: ['serviceDefinitionId', 'status', 'actualQuantity', 'reasonCode'],
                }}
              >
                <input type="hidden" name="visitId" value={visit.id} />
                <input type="hidden" name="performedServiceId" value={uuidv7()} />
                <input type="hidden" name="expectedVersion" value={execution.version} />
                <div className="grid gap-2">
                  <Label htmlFor="serviceDefinitionId">{t('VisitExecution.service')}</Label>
                  <select
                    id="serviceDefinitionId"
                    name="serviceDefinitionId"
                    required
                    className="min-h-12 w-full min-w-0 rounded-md border bg-white px-3"
                  >
                    <option value="">{t('VisitExecution.selectService')}</option>
                    {availableServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.code} · {service.name} ({t(unitKey(service.unit))})
                      </option>
                    ))}
                  </select>
                </div>
                <DecisionFields
                  status=""
                  actualQuantity=""
                  reasonCode={null}
                  unit="unknown"
                  prefix="unplanned"
                />
                <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
                  {t('VisitExecution.recordService')}
                </Button>
              </CareForm>
            ) : (
              <p className="text-slate-600">{t('VisitExecution.noMoreServices')}</p>
            )}
          </section>

          <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
            <h2 className="text-xl font-semibold">{t('VisitExecution.completeVisit')}</h2>
            {unresolved ? (
              <p className="text-slate-600">{t('VisitExecution.completeVisitHint')}</p>
            ) : null}
            <CareForm action={completeVisitAction} notice={query.notice}>
              <input type="hidden" name="visitId" value={visit.id} />
              <input type="hidden" name="expectedVersion" value={execution.version} />
              <Button
                type="submit"
                disabled={unresolved}
                className="min-h-12 w-full text-base sm:w-fit"
              >
                {t('VisitExecution.completeVisit')}
              </Button>
            </CareForm>
          </section>
        </>
      ) : null}

      <DocumentationSection
        detail={documentationResult.data}
        {...(documentationResult.error?.code ? { errorCode: documentationResult.error.code } : {})}
        evidenceStatus={evidencePackageResult?.data?.status ?? null}
        evidenceStatusUnavailable={evidenceStatusUnavailable}
        visitId={visit.id}
        executionStatus={execution.status}
        locale={locale}
        notice={query.notice}
      />
    </div>
  );
}

async function ServiceCard({
  visitId,
  version,
  service,
  performedServiceId,
  editable,
  locale,
  notice,
}: {
  visitId: string;
  version: number;
  service: components['schemas']['PerformedServiceResponseDto'];
  performedServiceId: string;
  editable: boolean;
  locale: Locale;
  notice?: string | undefined;
}) {
  const t = await getTranslations();
  return (
    <section className="grid gap-3 rounded-md border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{service.serviceName}</h3>
          <p className="text-sm text-slate-600">
            {service.serviceCode} · {t('VisitExecution.planned')}{' '}
            {service.plannedQuantity == null
              ? '–'
              : formatNumber(Number(service.plannedQuantity), locale)}{' '}
            {t(unitKey(service.unit))}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">
          {t(serviceStatusKey(service.status))}
        </span>
      </div>
      {service.status !== 'not_recorded' ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-600">{t('VisitExecution.actual')}</dt>
            <dd className="font-medium">
              {service.actualQuantity == null
                ? '–'
                : formatNumber(Number(service.actualQuantity), locale)}{' '}
              {t(unitKey(service.unit))}
            </dd>
          </div>
          {service.reasonCode ? (
            <div>
              <dt className="text-slate-600">{t('VisitExecution.reason')}</dt>
              <dd className="font-medium">{t(reasonKey(service.reasonCode))}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {editable ? (
        <CareForm
          action={recordPerformedServiceAction}
          className="grid gap-4 border-t pt-3"
          notice={notice}
          successNotices={['service-saved']}
          draft={{
            visitId,
            formId: service.visitServiceId
              ? `service:${service.visitServiceId}`
              : `service:${performedServiceId}`,
            revision: `execution:${version}`,
            fields: ['status', 'actualQuantity', 'reasonCode'],
          }}
        >
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="performedServiceId" value={performedServiceId} />
          <input type="hidden" name="expectedVersion" value={version} />
          {service.visitServiceId ? (
            <input type="hidden" name="visitServiceId" value={service.visitServiceId} />
          ) : null}
          <DecisionFields
            status={service.status === 'not_recorded' ? '' : service.status}
            actualQuantity={service.status === 'not_recorded' ? '' : (service.actualQuantity ?? '')}
            reasonCode={service.reasonCode ?? null}
            unit={service.unit}
            prefix={service.visitServiceId ?? performedServiceId}
          />
          <Button type="submit" variant="secondary" className="min-h-12 w-full sm:w-fit">
            {t('VisitExecution.saveOutcome')}
          </Button>
        </CareForm>
      ) : null}
    </section>
  );
}

async function DecisionFields({
  status,
  actualQuantity,
  reasonCode,
  unit,
  prefix,
}: {
  status: '' | 'performed' | 'partially_performed' | 'not_performed';
  actualQuantity: string;
  reasonCode: string | null;
  unit: string;
  prefix: string;
}) {
  const t = await getTranslations();
  const quantityId = 'quantity-' + prefix;
  const reasonId = 'reason-' + prefix;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={'status-' + prefix}>{t('VisitExecution.outcome')}</Label>
          <select
            id={'status-' + prefix}
            name="status"
            required
            defaultValue={status}
            className="min-h-12 w-full min-w-0 rounded-md border bg-white px-3"
          >
            <option value="">{t('VisitExecution.selectOutcome')}</option>
            <option value="performed">{t('VisitExecution.performed')}</option>
            <option value="partially_performed">{t('VisitExecution.partiallyPerformed')}</option>
            <option value="not_performed">{t('VisitExecution.notPerformed')}</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={quantityId}>
            {t('VisitExecution.actualQuantity', { unit: t(unitKey(unit)) })}
          </Label>
          <Input
            id={quantityId}
            name="actualQuantity"
            type="number"
            min="0"
            step="0.001"
            inputMode="decimal"
            defaultValue={actualQuantity}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={reasonId}>{t('VisitExecution.reasonRequired')}</Label>
        <select
          id={reasonId}
          name="reasonCode"
          defaultValue={reasonCode ?? ''}
          className="min-h-12 w-full min-w-0 rounded-md border bg-white px-3"
        >
          <option value="">{t('VisitExecution.noReason')}</option>
          <option value="client_declined">{t('VisitExecution.reasons.clientDeclined')}</option>
          <option value="client_not_present">{t('VisitExecution.reasons.clientNotPresent')}</option>
          <option value="service_not_required">
            {t('VisitExecution.reasons.serviceNotRequired')}
          </option>
          <option value="time_constraint">{t('VisitExecution.reasons.timeConstraint')}</option>
          <option value="provider_decision">{t('VisitExecution.reasons.providerDecision')}</option>
          <option value="other">{t('VisitExecution.reasons.other')}</option>
        </select>
      </div>
    </>
  );
}

async function DocumentationSection({
  detail,
  errorCode,
  evidenceStatus,
  evidenceStatusUnavailable,
  visitId,
  executionStatus: visitExecutionStatus,
  locale,
  notice,
}: {
  detail: components['schemas']['CareDocumentationDetailDto'] | undefined;
  errorCode?: string;
  evidenceStatus: 'ready' | 'acknowledged' | 'declined' | 'revoked' | 'outdated' | null;
  evidenceStatusUnavailable: boolean;
  visitId: string;
  executionStatus: 'not_started' | 'in_progress' | 'completed';
  locale: Locale;
  notice?: string | undefined;
}) {
  const t = await getTranslations();
  if (errorCode || !detail) {
    return (
      <section className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">{t('CareDocumentation.visit.title')}</h2>
        <p role="alert" className="text-red-800">
          {t('CareDocumentation.visit.unavailable')}
        </p>
      </section>
    );
  }

  const document = detail.documentation;
  const editable = document?.status === 'draft';
  const finalized = document?.status === 'finalized';
  const serviceNames = new Map(
    detail.services.map((service) => [service.performedServiceId, service.serviceName]),
  );

  return (
    <section className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('CareDocumentation.visit.title')}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {finalized
              ? t('CareDocumentation.visit.finalizedAt', {
                  date: document.finalizedAt
                    ? formatVisitDateTime(document.finalizedAt, detail.visit.timezone, locale)
                    : '',
                })
              : editable
                ? t('CareDocumentation.visit.draftBy', {
                    employee: document.createdByEmployeeName ?? t('Common.fields.employee'),
                  })
                : t('CareDocumentation.visit.notCreated')}
          </p>
        </div>
        {finalized ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-900">
            {t('CareDocumentation.visit.finalized')}
          </span>
        ) : null}
      </header>

      {finalized ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3">
          <span className="text-sm font-medium">
            {t('CareDocumentation.visit.acknowledgement')}{' '}
            {evidenceStatusUnavailable
              ? t('ServiceEvidence.care.loadFailed')
              : evidenceStatus === 'acknowledged'
                ? t('CareDocumentation.visit.acknowledged')
                : evidenceStatus === 'declined'
                  ? t('CareDocumentation.visit.declined')
                  : evidenceStatus === 'outdated'
                    ? t('CareDocumentation.visit.newAcknowledgementRequired')
                    : evidenceStatus === 'revoked'
                      ? t('CareDocumentation.visit.revoked')
                      : t('CareDocumentation.visit.pending')}
          </span>
          <Link
            href={`/care/visits/${visitId}/evidence`}
            className="min-h-10 rounded-md border border-slate-400 px-3 py-2 text-sm font-semibold text-blue-900 underline"
          >
            {t('CareDocumentation.visit.reviewEvidence')}
          </Link>
        </div>
      ) : null}

      {!document ? (
        visitExecutionStatus === 'not_started' ? (
          <p className="rounded-md bg-slate-50 p-3 text-slate-700">
            {t('CareDocumentation.visit.startBeforeDocumentation')}
          </p>
        ) : (
          <CareForm action={createDocumentationAction} notice={notice}>
            <input type="hidden" name="visitId" value={visitId} />
            <Button type="submit" className="min-h-12 w-full sm:w-fit">
              {t('CareDocumentation.visit.startDocumentation')}
            </Button>
          </CareForm>
        )
      ) : (
        <>
          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-lg font-semibold">{t('CareDocumentation.visit.services')}</h3>
            {detail.services.length ? (
              <ul className="grid gap-3">
                {detail.services.map((service) => (
                  <li key={service.performedServiceId} className="grid gap-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-medium">{service.serviceName}</h4>
                        <p className="text-sm text-slate-600">
                          {t(serviceStatusKey(service.status))} · {service.actualQuantity ?? '–'}{' '}
                          {t(unitKey(service.unit))}
                        </p>
                      </div>
                      <span
                        className={
                          service.evidence
                            ? 'text-sm text-green-800'
                            : 'text-sm font-medium text-amber-900'
                        }
                      >
                        {service.evidence
                          ? t('CareDocumentation.visit.evidenceRecorded')
                          : t('CareDocumentation.visit.evidenceMissing')}
                      </span>
                    </div>
                    {service.evidence?.note ? (
                      <p className="whitespace-pre-wrap text-sm">{service.evidence.note}</p>
                    ) : null}
                    {service.evidence?.documentedByEmployeeName ? (
                      <p className="text-xs text-slate-500">
                        {t('CareDocumentation.visit.documentedBy', {
                          employee: service.evidence.documentedByEmployeeName,
                        })}
                      </p>
                    ) : null}
                    {editable ? (
                      <CareForm
                        action={recordServiceEvidenceAction}
                        className="grid gap-2 border-t pt-3"
                        notice={notice}
                        successNotices={['evidence-saved']}
                        draft={{
                          visitId,
                          formId: `service-evidence:${service.performedServiceId}`,
                          revision: `documentation:${document.id}:${document.version}`,
                          fields: ['note'],
                        }}
                      >
                        <input type="hidden" name="visitId" value={visitId} />
                        <input type="hidden" name="documentationId" value={document.id} />
                        <input
                          type="hidden"
                          name="performedServiceId"
                          value={service.performedServiceId}
                        />
                        <input type="hidden" name="expectedVersion" value={document.version} />
                        <Label htmlFor={`evidence-${service.performedServiceId}`}>
                          {t('CareDocumentation.visit.evidenceLabel')}
                        </Label>
                        <textarea
                          id={`evidence-${service.performedServiceId}`}
                          name="note"
                          defaultValue={service.evidence?.note ?? ''}
                          maxLength={1000}
                          className="min-h-20 rounded-md border px-3 py-2"
                          placeholder={t('CareDocumentation.visit.evidencePlaceholder')}
                        />
                        <Button
                          type="submit"
                          variant="secondary"
                          className="min-h-11 w-full sm:w-fit"
                        >
                          {t('CareDocumentation.visit.saveEvidence')}
                        </Button>
                      </CareForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-600">{t('CareDocumentation.visit.noServices')}</p>
            )}
          </section>

          {(['care_note', 'observation', 'deviation', 'incident'] as const).map((type) => {
            const entries = detail.entries.filter((entry) => entry.type === type);
            const title = t(entryTypeKey(type));
            return (
              <section key={type} className="grid gap-3 border-t pt-4">
                <h3 className="text-lg font-semibold">{title}</h3>
                {entries.length ? (
                  <ul className="grid gap-3">
                    {entries.map((entry) => (
                      <li key={entry.id} className="rounded-md border p-3">
                        <p className="whitespace-pre-wrap">{entry.content}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {entry.authorEmployeeName ?? t('Common.fields.employee')} ·{' '}
                          {formatVisitDateTime(entry.createdAt, detail.visit.timezone, locale)}
                          {entry.severity ? ` · ${t(severityKey(entry.severity))}` : ''}
                        </p>
                        {editable ? (
                          <CareForm
                            action={updateDocumentationEntryAction}
                            className="mt-3 grid gap-2 border-t pt-3"
                            notice={notice}
                            successNotices={['entry-saved']}
                            draft={{
                              visitId,
                              formId: `entry-update:${entry.id}`,
                              revision: `documentation:${document.id}:${document.version}`,
                              fields: ['content'],
                            }}
                          >
                            <input type="hidden" name="visitId" value={visitId} />
                            <input type="hidden" name="documentationId" value={document.id} />
                            <input type="hidden" name="entryId" value={entry.id} />
                            <input type="hidden" name="expectedVersion" value={document.version} />
                            <Label htmlFor={`entry-${entry.id}`}>
                              {t('CareDocumentation.visit.editEntry')}
                            </Label>
                            <textarea
                              id={`entry-${entry.id}`}
                              name="content"
                              defaultValue={entry.content}
                              required
                              maxLength={4000}
                              className="min-h-20 rounded-md border px-3 py-2"
                            />
                            <Button
                              type="submit"
                              variant="secondary"
                              className="min-h-11 w-full sm:w-fit"
                            >
                              {t('CareDocumentation.visit.saveAmendment')}
                            </Button>
                          </CareForm>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600">{t('CareDocumentation.visit.noEntries')}</p>
                )}
                {editable ? (
                  <EntryComposer
                    visitId={visitId}
                    documentationId={document.id}
                    version={document.version}
                    type={type}
                    notice={notice}
                  />
                ) : null}
              </section>
            );
          })}

          {editable ? (
            <section className="grid gap-3 border-t pt-4">
              <h3 className="text-lg font-semibold">
                {t('CareDocumentation.visit.finalizeTitle')}
              </h3>
              {detail.completeness.isComplete ? (
                visitExecutionStatus === 'completed' ? (
                  <CareForm action={finalizeDocumentationAction} notice={notice}>
                    <input type="hidden" name="visitId" value={visitId} />
                    <input type="hidden" name="documentationId" value={document.id} />
                    <input type="hidden" name="expectedVersion" value={document.version} />
                    <Button type="submit" className="min-h-12 w-full sm:w-fit">
                      {t('CareDocumentation.visit.finalize')}
                    </Button>
                  </CareForm>
                ) : (
                  <p className="text-slate-600">
                    {t('CareDocumentation.visit.finalizeAfterCompletion')}
                  </p>
                )
              ) : (
                <ul className="grid gap-2 text-sm text-amber-950">
                  {detail.completeness.missing.map((missing, index) => (
                    <li key={`${missing.code}-${missing.performedServiceId ?? index}`}>
                      {missing.performedServiceId
                        ? `${serviceNames.get(missing.performedServiceId) ?? t('VisitExecution.service')}: `
                        : ''}
                      {t(missingRequirementKey(missing.code))}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {finalized && detail.amendments.length ? (
            <section className="grid gap-3 border-t pt-4">
              <h3 className="text-lg font-semibold">{t('CareDocumentation.visit.amendments')}</h3>
              {detail.amendments.map((amendment) => (
                <article key={amendment.id} className="rounded-md bg-slate-50 p-3">
                  <p className="text-sm font-semibold">{amendment.reason}</p>
                  <p className="mt-1 whitespace-pre-wrap">{amendment.correction}</p>
                </article>
              ))}
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

async function EntryComposer({
  visitId,
  documentationId,
  version,
  type,
  notice,
}: {
  visitId: string;
  documentationId: string;
  version: number;
  type: 'care_note' | 'observation' | 'deviation' | 'incident';
  notice?: string | undefined;
}) {
  const t = await getTranslations();
  return (
    <CareForm
      action={addDocumentationEntryAction}
      className="grid gap-3 rounded-md bg-slate-50 p-3"
      notice={notice}
      successNotices={['entry-saved']}
      draft={{
        visitId,
        formId: `entry-new:${type}`,
        revision: `documentation:${documentationId}:${version}`,
        fields: ['content', 'severity'],
      }}
    >
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="documentationId" value={documentationId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="type" value={type} />
      <Label htmlFor={`new-${type}`}>{t('CareDocumentation.visit.newEntry')}</Label>
      <textarea
        id={`new-${type}`}
        name="content"
        required
        maxLength={4000}
        className="min-h-20 rounded-md border bg-white px-3 py-2"
      />
      {type === 'incident' ? (
        <div className="grid gap-2">
          <Label htmlFor="incident-severity">{t('CareDocumentation.visit.severity')}</Label>
          <select
            id="incident-severity"
            name="severity"
            required
            className="min-h-11 rounded-md border bg-white px-3"
          >
            <option value="">{t('CareDocumentation.visit.selectOption')}</option>
            <option value="low">{t('CareDocumentation.visit.severityLow')}</option>
            <option value="moderate">{t('CareDocumentation.visit.severityModerate')}</option>
            <option value="high">{t('CareDocumentation.visit.severityHigh')}</option>
            <option value="critical">{t('CareDocumentation.visit.severityCritical')}</option>
          </select>
        </div>
      ) : null}
      <Button type="submit" variant="secondary" className="min-h-11 w-full sm:w-fit">
        {t('Common.actions.save')}
      </Button>
    </CareForm>
  );
}

async function CompletionChecklist({
  executionStatus,
  serviceStatuses,
  documentation,
  documentationUnavailable,
}: {
  executionStatus: 'not_started' | 'in_progress' | 'completed';
  serviceStatuses: string[];
  documentation: components['schemas']['CareDocumentationDetailDto'] | undefined;
  documentationUnavailable: boolean;
}) {
  const t = await getTranslations();
  const completedServices = serviceStatuses.filter((status) => status !== 'not_recorded').length;
  const servicesComplete = completedServices === serviceStatuses.length;
  const document = documentation?.documentation;
  const documentationFinalized = document?.status === 'finalized';
  const documentationComplete = documentation?.completeness.isComplete ?? false;
  const documentationState = documentationUnavailable
    ? 'warning'
    : documentationFinalized
      ? 'complete'
      : documentationComplete
        ? 'pending'
        : document
          ? 'warning'
          : 'pending';

  return (
    <section
      aria-labelledby="completion-checklist-title"
      className="grid gap-3 rounded-lg border bg-white p-4 sm:p-5"
    >
      <h2 id="completion-checklist-title" className="text-xl font-semibold">
        {t('VisitExecution.readiness.title')}
      </h2>
      <ul className="grid gap-2 text-sm">
        <ChecklistItem
          label={t('VisitExecution.readiness.started')}
          state={executionStatus === 'not_started' ? 'pending' : 'complete'}
          value={t(
            executionStatus === 'not_started'
              ? 'VisitExecution.readiness.pending'
              : 'VisitExecution.readiness.complete',
          )}
        />
        <ChecklistItem
          label={t('VisitExecution.readiness.services')}
          state={servicesComplete ? 'complete' : 'warning'}
          value={t('VisitExecution.readiness.serviceCount', {
            completed: completedServices,
            total: serviceStatuses.length,
          })}
        />
        <ChecklistItem
          label={t('VisitExecution.readiness.endTime')}
          state={executionStatus === 'completed' ? 'complete' : 'pending'}
          value={t(
            executionStatus === 'completed'
              ? 'VisitExecution.readiness.complete'
              : 'VisitExecution.readiness.pending',
          )}
        />
        <ChecklistItem
          label={t('VisitExecution.readiness.documentation')}
          state={documentationState}
          value={t(
            documentationUnavailable
              ? 'CareDocumentation.visit.unavailable'
              : documentationFinalized
                ? 'VisitExecution.readiness.complete'
                : documentationComplete
                  ? 'VisitExecution.readiness.documentationReady'
                  : document
                    ? 'VisitExecution.readiness.documentationIncomplete'
                    : 'VisitExecution.readiness.documentationMissing',
          )}
        />
      </ul>
      <p className="text-xs text-slate-600">{t('VisitExecution.readiness.source')}</p>
    </section>
  );
}

function ChecklistItem({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: 'complete' | 'pending' | 'warning';
}) {
  const className =
    state === 'complete'
      ? 'text-green-900'
      : state === 'warning'
        ? 'text-amber-950'
        : 'text-slate-600';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
      <span>{label}</span>
      <span className={`font-medium ${className}`}>{value}</span>
    </li>
  );
}

function Time({
  label,
  value,
  timezone,
  locale,
}: {
  label: string;
  value: string;
  timezone: string;
  locale: Locale;
}) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium">{formatVisitDateTime(value, timezone, locale)}</dd>
    </div>
  );
}

function unitKey(
  unit: string,
):
  | 'Common.units.occurrence'
  | 'Common.units.minute'
  | 'Common.units.hour'
  | 'Common.units.day'
  | 'Common.units.unknown' {
  const keys = {
    occurrence: 'Common.units.occurrence',
    minute: 'Common.units.minute',
    hour: 'Common.units.hour',
    day: 'Common.units.day',
  } as const;
  return unit in keys ? keys[unit as keyof typeof keys] : 'Common.units.unknown';
}

function weekdayName(isoWeekday: number, locale: Locale): string {
  const date = new Date(Date.UTC(2024, 0, isoWeekday));
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(date);
}

function serviceStatusKey(
  status: string,
):
  | 'VisitExecution.serviceStatus.notRecorded'
  | 'VisitExecution.serviceStatus.performed'
  | 'VisitExecution.serviceStatus.partiallyPerformed'
  | 'VisitExecution.serviceStatus.notPerformed'
  | 'VisitExecution.serviceStatus.unknown' {
  const keys = {
    not_recorded: 'VisitExecution.serviceStatus.notRecorded',
    performed: 'VisitExecution.serviceStatus.performed',
    partially_performed: 'VisitExecution.serviceStatus.partiallyPerformed',
    not_performed: 'VisitExecution.serviceStatus.notPerformed',
  } as const;
  return status in keys
    ? keys[status as keyof typeof keys]
    : 'VisitExecution.serviceStatus.unknown';
}

function executionStatusKey(
  status: string,
):
  | 'VisitExecution.executionStatus.notStarted'
  | 'VisitExecution.executionStatus.inProgress'
  | 'VisitExecution.executionStatus.completed'
  | 'VisitExecution.executionStatus.unknown' {
  const keys = {
    not_started: 'VisitExecution.executionStatus.notStarted',
    in_progress: 'VisitExecution.executionStatus.inProgress',
    completed: 'VisitExecution.executionStatus.completed',
  } as const;
  return status in keys
    ? keys[status as keyof typeof keys]
    : 'VisitExecution.executionStatus.unknown';
}

function reasonKey(
  reason: string,
):
  | 'VisitExecution.reasons.clientDeclined'
  | 'VisitExecution.reasons.clientNotPresent'
  | 'VisitExecution.reasons.serviceNotRequired'
  | 'VisitExecution.reasons.timeConstraint'
  | 'VisitExecution.reasons.providerDecision'
  | 'VisitExecution.reasons.other' {
  const keys = {
    client_declined: 'VisitExecution.reasons.clientDeclined',
    client_not_present: 'VisitExecution.reasons.clientNotPresent',
    service_not_required: 'VisitExecution.reasons.serviceNotRequired',
    time_constraint: 'VisitExecution.reasons.timeConstraint',
    provider_decision: 'VisitExecution.reasons.providerDecision',
    other: 'VisitExecution.reasons.other',
  } as const;
  return reason in keys ? keys[reason as keyof typeof keys] : 'VisitExecution.reasons.other';
}

function entryTypeKey(
  type: 'care_note' | 'observation' | 'deviation' | 'incident',
):
  | 'CareDocumentation.visit.entryTypes.careNote'
  | 'CareDocumentation.visit.entryTypes.observation'
  | 'CareDocumentation.visit.entryTypes.deviation'
  | 'CareDocumentation.visit.entryTypes.incident' {
  const keys = {
    care_note: 'CareDocumentation.visit.entryTypes.careNote',
    observation: 'CareDocumentation.visit.entryTypes.observation',
    deviation: 'CareDocumentation.visit.entryTypes.deviation',
    incident: 'CareDocumentation.visit.entryTypes.incident',
  } as const;
  return keys[type];
}

function severityKey(
  value: string,
):
  | 'CareDocumentation.visit.severityValues.low'
  | 'CareDocumentation.visit.severityValues.moderate'
  | 'CareDocumentation.visit.severityValues.high'
  | 'CareDocumentation.visit.severityValues.critical' {
  const keys = {
    low: 'CareDocumentation.visit.severityValues.low',
    moderate: 'CareDocumentation.visit.severityValues.moderate',
    high: 'CareDocumentation.visit.severityValues.high',
    critical: 'CareDocumentation.visit.severityValues.critical',
  } as const;
  return value in keys
    ? keys[value as keyof typeof keys]
    : 'CareDocumentation.visit.severityValues.critical';
}

function missingRequirementKey(
  code: string,
):
  | 'CareDocumentation.visit.missing.documentation'
  | 'CareDocumentation.visit.missing.execution'
  | 'CareDocumentation.visit.missing.serviceEvidence'
  | 'CareDocumentation.visit.missing.reason'
  | 'CareDocumentation.visit.missing.explanation'
  | 'CareDocumentation.visit.missing.unknown' {
  const keys = {
    DOCUMENTATION_REQUIRED: 'CareDocumentation.visit.missing.documentation',
    VISIT_EXECUTION_REQUIRED: 'CareDocumentation.visit.missing.execution',
    SERVICE_EVIDENCE_REQUIRED: 'CareDocumentation.visit.missing.serviceEvidence',
    NOT_PERFORMED_REASON_REQUIRED: 'CareDocumentation.visit.missing.reason',
    PARTIAL_SERVICE_EXPLANATION_REQUIRED: 'CareDocumentation.visit.missing.explanation',
  } as const;
  return code in keys ? keys[code as keyof typeof keys] : 'CareDocumentation.visit.missing.unknown';
}

function noticeKey(
  notice: string,
):
  | 'VisitExecution.notices.started'
  | 'VisitExecution.notices.serviceSaved'
  | 'VisitExecution.notices.noteSaved'
  | 'VisitExecution.notices.completed'
  | 'VisitExecution.notices.unknown' {
  const keys = {
    started: 'VisitExecution.notices.started',
    'service-saved': 'VisitExecution.notices.serviceSaved',
    'note-saved': 'VisitExecution.notices.noteSaved',
    completed: 'VisitExecution.notices.completed',
  } as const;
  return notice in keys ? keys[notice as keyof typeof keys] : 'VisitExecution.notices.unknown';
}
