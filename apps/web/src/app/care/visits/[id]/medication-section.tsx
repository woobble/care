import type { components } from '@care/api-client';
import { Button, Input, Label } from '@care/ui';
import { getTranslations } from 'next-intl/server';
import { errorMessageKey } from '../../../../i18n/errors';
import { formatVisitDateTime } from '../../../../lib/care-date';
import type { Locale } from '../../../../i18n/config';
import { recordMedicationOccurrenceAction, recordPrnMedicationAction } from '../../actions';

type VisitMedication = components['schemas']['VisitMedicationAdministrationDto'];
type DueMedication = components['schemas']['MedicationDueOccurrenceDto'];
type PrnMedication = components['schemas']['MedicationPrnOrderDto'];
type MedicationRecord = components['schemas']['MedicationAdministrationRecordDto'];

const outcomes = ['administered', 'not_administered', 'refused', 'withheld'] as const;
const reasons = ['client_refused', 'client_unavailable', 'medication_unavailable', 'held_per_instruction', 'administration_not_possible', 'other'] as const;

export async function MedicationVisitSection({
  visitId,
  timezone,
  locale,
  data,
  errorCode,
}: Readonly<{
  visitId: string;
  timezone: string;
  locale: Locale;
  data: VisitMedication | null;
  errorCode: string | undefined;
}>) {
  const t = await getTranslations();
  const routeLabels: Record<string, string> = {
    oral: t('Medication.routes.oral'), topical: t('Medication.routes.topical'),
    subcutaneous: t('Medication.routes.subcutaneous'), intramuscular: t('Medication.routes.intramuscular'),
    inhalation: t('Medication.routes.inhalation'), transdermal: t('Medication.routes.transdermal'), other: t('Medication.routes.other'),
  };
  const unitLabels: Record<string, string> = {
    mg: t('Medication.units.mg'), g: t('Medication.units.g'), mL: t('Medication.units.mL'),
    tablet: t('Medication.units.tablet'), capsule: t('Medication.units.capsule'), drop: t('Medication.units.drop'),
    puff: t('Medication.units.puff'), patch: t('Medication.units.patch'),
  };
  const outcomeLabels: Record<string, string> = {
    administered: t('Medication.administered'), not_administered: t('Medication.notAdministered'),
    refused: t('Medication.refused'), withheld: t('Medication.withheld'),
  };
  const reasonLabels: Record<string, string> = {
    client_refused: t('Medication.clientRefused'), client_unavailable: t('Medication.clientUnavailable'),
    medication_unavailable: t('Medication.medicationUnavailable'), held_per_instruction: t('Medication.heldPerInstruction'),
    administration_not_possible: t('Medication.administrationNotPossible'), other: t('Medication.other'),
  };

  const administrationForm = (
    medication: DueMedication | PrnMedication,
    kind: 'scheduled' | 'prn',
  ) => {
    const due = kind === 'scheduled' ? medication as DueMedication : null;
    const prn = kind === 'prn' ? medication as PrnMedication : null;
    const scheduleLabel = due
      ? `${formatVisitDateTime(due.scheduledAt, due.timezone, locale)} · ${due.status === 'due' ? t('Medication.due') : t('Medication.overdueNotDocumented')}`
      : `${t('Medication.asNeeded')} · ${prn!.indication}`;
    const orderedDose = medication.orderedDose;
    const id = due?.occurrenceId ?? prn!.orderId;
    return (
      <article key={`${kind}-${id}`} className="grid gap-4 rounded-md border p-4">
        <div>
          <h3 className="text-lg font-semibold">{medication.medication.name}</h3>
          <p className="text-sm text-slate-600">{scheduleLabel}</p>
          <p className="mt-2 font-medium">{t('Medication.orderedDose')}: {orderedDose.amount} {unitLabels[orderedDose.unit]} · {routeLabels[medication.route]}</p>
          {medication.instructions ? <p className="mt-1 text-sm text-slate-700">{medication.instructions}</p> : null}
        </div>
        <form action={kind === 'prn' ? recordPrnMedicationAction : recordMedicationOccurrenceAction} className="grid gap-4">
          <input type="hidden" name="visitId" value={visitId} />
          {due ? <input type="hidden" name="occurrenceId" value={due.occurrenceId} /> : null}
          {prn ? <input type="hidden" name="orderId" value={prn.orderId} /> : null}
          <input type="hidden" name="actualDoseAmount" value={orderedDose.amount} />
          <input type="hidden" name="actualDoseUnit" value={orderedDose.unit} />
          <p className="rounded bg-blue-50 p-3 text-sm text-blue-950">{t('Medication.reviewOrderFacts', { dose: `${orderedDose.amount} ${unitLabels[orderedDose.unit] ?? orderedDose.unit}`, route: routeLabels[medication.route] ?? '—' })}</p>
          <div className="grid gap-1.5">
            <Label htmlFor={`outcome-${id}`}>{t('Medication.outcome')}</Label>
            <select id={`outcome-${id}`} name="outcome" required defaultValue="" className="min-h-12 rounded-md border bg-white px-3">
              <option value="">{t('Medication.selectOutcome')}</option>
              {outcomes.map((outcome) => <option key={outcome} value={outcome}>{outcomeLabels[outcome]}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`administrationReason-${id}`}>{kind === 'prn' ? t('Medication.administrationReason') : t('Medication.additionalReason')}</Label>
            <Input id={`administrationReason-${id}`} name="administrationReason" required={kind === 'prn'} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`reason-${id}`}>{t('Medication.reason')}</Label>
            <select id={`reason-${id}`} name="reasonCode" defaultValue="" className="min-h-12 rounded-md border bg-white px-3">
              <option value="">{t('Medication.selectReason')}</option>
              {reasons.map((reason) => <option key={reason} value={reason}>{reasonLabels[reason]}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`note-${id}`}>{t('Medication.note')}</Label>
            <textarea id={`note-${id}`} name="note" maxLength={2000} rows={3} className="min-h-24 rounded-md border bg-white p-3" />
          </div>
          <label className="flex min-h-12 items-start gap-3 rounded-md bg-slate-50 p-3 text-sm">
            <input type="checkbox" name="confirm" className="mt-1 size-5" />
            <span>{t('Medication.caregiverConfirm')}</span>
          </label>
          <p className="text-sm text-slate-600">{t('Medication.captureTimeHelp')}</p>
          <Button type="submit" className="min-h-12 w-full sm:w-fit">{t('Medication.recordOutcome')}</Button>
        </form>
      </article>
    );
  };

  const recordedCard = (record: MedicationRecord) => {
    const correction = record.currentCorrection;
    const outcome = correction?.outcome ?? record.outcome;
    const dose = correction
      ? correction.actualDoseAmount && correction.actualDoseUnit
        ? `${correction.actualDoseAmount} ${unitLabels[correction.actualDoseUnit]}`
        : '—'
      : record.actualDose
        ? `${record.actualDose.amount} ${unitLabels[record.actualDose.unit]}`
        : '—';
    return (
      <li key={record.id} className="rounded-md bg-slate-50 p-3">
        <div className="flex flex-wrap justify-between gap-2">
          <p className="font-semibold">{record.medication.name}</p>
          <span className="rounded-full bg-white px-3 py-1 text-sm">{outcomeLabels[outcome]}</span>
        </div>
        <p className="text-sm">{t('Medication.actualDose')}: {dose} · {routeLabels[record.route]}</p>
        <p className="text-sm text-slate-600">{t('Medication.actualTime')}: {formatVisitDateTime(record.occurredAt, timezone, locale)} · {record.administeredByEmployeeName}</p>
        {correction ? <p className="mt-1 text-sm text-amber-900">{t('Medication.corrected')}: {correction.correctionReason}</p> : null}
      </li>
    );
  };

  return (
    <section
      aria-labelledby="visit-medications-heading"
      className="grid gap-4 rounded-lg border bg-white p-4 sm:p-5"
    >
      <div>
        <h2 id="visit-medications-heading" className="text-xl font-semibold">
          {t('Medication.visitSection')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t('Medication.visitPrivacy')}</p>
      </div>
      {!data ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
          {errorCode ? t('Medication.noReadAccess') : t('Medication.loadFailed')} {errorCode ? t(errorMessageKey(errorCode)) : ''}
        </p>
      ) : null}
      {data?.due.length ? <div className="grid gap-3">{data.due.map((medication) => administrationForm(medication, 'scheduled'))}</div> : null}
      {data?.prn.length ? (
        <div className="grid gap-3 border-t pt-4">
          <h3 className="font-semibold">{t('Medication.prnAvailable')}</h3>
          {data.prn.map((medication) => administrationForm(medication, 'prn'))}
        </div>
      ) : null}
      {data && data.due.length === 0 && data.prn.length === 0 ? <p className="text-slate-600">{t('Medication.noDue')}</p> : null}
      {data?.history.length ? (
        <div className="grid gap-3 border-t pt-4">
          <h3 className="font-semibold">{t('Medication.visitHistory')}</h3>
          <ul className="grid gap-3">{data.history.map(recordedCard)}</ul>
        </div>
      ) : null}
    </section>
  );
}
