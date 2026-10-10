'use client';

import { useState, type FormEvent, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@care/api-client';
import { acknowledgeEvidenceAction, declineEvidenceAction } from '@app/web/app/care/actions';

type EligibleSignatory = components['schemas']['EligibleSignatoryDto'];
type SignaturePoint = { x: number; y: number };
type SignatureStrokes = SignaturePoint[][];

export function EvidenceAcknowledgementForm({
  visitId,
  evidencePackageId,
  clientName,
  statementText,
  eligibleSignatories,
  acknowledgementIdempotencyKey,
  declineIdempotencyKey,
}: {
  visitId: string;
  evidencePackageId: string;
  clientName: string;
  statementText: string;
  eligibleSignatories: EligibleSignatory[];
  acknowledgementIdempotencyKey: string;
  declineIdempotencyKey: string;
}) {
  const t = useTranslations('ServiceEvidence.care.form');
  const careT = useTranslations('ServiceEvidence.care');
  const [signatory, setSignatory] = useState('client');
  const [method, setMethod] = useState<'touch_signature' | 'typed_confirmation'>('touch_signature');
  const [strokes, setStrokes] = useState<SignatureStrokes>([]);
  const signatoryName =
    signatory === 'client'
      ? clientName
      : eligibleSignatories.find((item) => `${item.signatoryType}:${item.contactId}` === signatory)
          ?.displayName;

  return (
    <section className="grid gap-5 rounded-lg border bg-white p-4 sm:p-5">
      <header className="grid gap-2">
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="text-slate-700">{statementText}</p>
      </header>

      <label className="grid gap-1 text-sm font-medium">
        <span>{t('signatory')}</span>
        <select
          name="signatory"
          form="acknowledge-evidence"
          value={signatory}
          onChange={(event) => setSignatory(event.currentTarget.value)}
          className="min-h-12 rounded-md border bg-white px-3"
          aria-label={t('selectSignatory')}
        >
          <option value="client">{t('client')}</option>
          {eligibleSignatories.map((person) => (
            <option key={person.contactId} value={`${person.signatoryType}:${person.contactId}`}>
              {person.displayName} · {careT(capacityKey(person.capacity))}
            </option>
          ))}
        </select>
      </label>

      <form
        id="acknowledge-evidence"
        action={acknowledgeEvidenceAction}
        onSubmit={(event) => confirmAcknowledgement(event, t('confirmPrompt'))}
        className="grid gap-4"
      >
        <input type="hidden" name="visitId" value={visitId} />
        <input type="hidden" name="evidencePackageId" value={evidencePackageId} />
        <input type="hidden" name="idempotencyKey" value={acknowledgementIdempotencyKey} />
        <input type="hidden" name="signatory" value={signatory} />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="strokes" value={JSON.stringify(strokes)} />

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{t('method')}</legend>
          <label className="flex min-h-11 items-center gap-3 rounded-md border px-3">
            <input
              type="radio"
              name="method-choice"
              value="touch_signature"
              checked={method === 'touch_signature'}
              onChange={() => setMethod('touch_signature')}
            />
            <span>{t('drawSignature')}</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-md border px-3">
            <input
              type="radio"
              name="method-choice"
              value="typed_confirmation"
              checked={method === 'typed_confirmation'}
              onChange={() => setMethod('typed_confirmation')}
            />
            <span>{t('enterName')}</span>
          </label>
        </fieldset>

        {method === 'touch_signature' ? (
          <SignaturePad strokes={strokes} onChange={setStrokes} />
        ) : (
          <label className="grid gap-1 text-sm font-medium">
            <span>{t('fullName')}</span>
            <input
              name="confirmationName"
              required
              maxLength={200}
              autoComplete="name"
              defaultValue={signatoryName ?? ''}
              key={signatory}
              className="min-h-12 rounded-md border px-3"
            />
            <span className="font-normal text-slate-600">{t('nameMustMatch')}</span>
          </label>
        )}

        <button
          type="submit"
          disabled={method === 'touch_signature' && strokes.length === 0}
          className="min-h-12 rounded-md bg-blue-800 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {method === 'touch_signature' ? t('confirmSignature') : t('recordConfirmation')}
        </button>
      </form>

      <details className="rounded-md border p-3">
        <summary className="min-h-8 cursor-pointer font-medium">
          {t('declinedOrUnavailable')}
        </summary>
        <form
          action={declineEvidenceAction}
          onSubmit={(event) => confirmDecline(event, t('declinePrompt'))}
          className="mt-4 grid gap-3"
        >
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="evidencePackageId" value={evidencePackageId} />
          <input type="hidden" name="idempotencyKey" value={declineIdempotencyKey} />
          <input type="hidden" name="signatory" value={signatory} />
          <label className="grid gap-1 text-sm font-medium">
            <span>{t('reason')}</span>
            <select name="reasonCode" required className="min-h-12 rounded-md border bg-white px-3">
              <option value="declined_without_reason">{t('reasons.declinedWithoutReason')}</option>
              <option value="disagrees_with_record">{t('reasons.disagreesWithRecord')}</option>
              <option value="unable_to_sign">{t('reasons.unableToSign')}</option>
              <option value="signatory_not_available">{t('reasons.signatoryNotAvailable')}</option>
              <option value="other">{t('reasons.other')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            <span>{t('noteOptional')}</span>
            <textarea
              name="note"
              maxLength={500}
              className="min-h-20 rounded-md border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="min-h-12 rounded-md border border-slate-400 px-4 font-semibold text-slate-800"
          >
            {t('recordDecline')}
          </button>
        </form>
      </details>
    </section>
  );
}

function SignaturePad({
  strokes,
  onChange,
}: {
  strokes: SignatureStrokes;
  onChange: (strokes: SignatureStrokes) => void;
}) {
  const t = useTranslations('ServiceEvidence.care.form');
  const [activeStroke, setActiveStroke] = useState<SignaturePoint[]>([]);
  const allStrokes = activeStroke.length ? [...strokes, activeStroke] : strokes;

  function point(event: PointerEvent<SVGSVGElement>): SignaturePoint {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }

  function start(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveStroke([point(event)]);
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      const nextPoint = point(event);
      setActiveStroke((current) => [...current, nextPoint]);
    }
  }

  function finish(event: PointerEvent<SVGSVGElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const finalStroke = [...activeStroke, point(event)];
    if (finalStroke.length > 1) onChange([...strokes, finalStroke]);
    setActiveStroke([]);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{t('signature')}</p>
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        role="img"
        aria-label={t('signatureField')}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => setActiveStroke([])}
        className="h-36 w-full touch-none rounded-md border-2 border-dashed border-slate-400 bg-slate-50"
      >
        {allStrokes.map((stroke) => (
          <path
            key={stroke.map((coordinate) => `${coordinate.x}:${coordinate.y}`).join('|')}
            d={strokePath(stroke)}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="text-slate-900"
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!strokes.length && !activeStroke.length}
          onClick={() => {
            onChange([]);
            setActiveStroke([]);
          }}
          className="min-h-11 rounded-md border px-3 font-medium disabled:text-slate-400"
        >
          {t('clearSignature')}
        </button>
        <button
          type="button"
          disabled={!strokes.length}
          onClick={() => onChange(strokes.slice(0, -1))}
          className="min-h-11 rounded-md border px-3 font-medium disabled:text-slate-400"
        >
          {t('removeLastStroke')}
        </button>
      </div>
      <p className="text-sm text-slate-600">{t('signatureSavedAfterConfirmation')}</p>
    </div>
  );
}

function strokePath(stroke: SignaturePoint[]): string {
  return stroke
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * 1000} ${point.y * 300}`)
    .join(' ');
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function confirmAcknowledgement(event: FormEvent<HTMLFormElement>, prompt: string) {
  if (!window.confirm(prompt)) {
    event.preventDefault();
  }
}

function confirmDecline(event: FormEvent<HTMLFormElement>, prompt: string) {
  if (!window.confirm(prompt)) {
    event.preventDefault();
  }
}

function capacityKey(
  capacity: string,
):
  | 'capacities.legalGuardian'
  | 'capacities.authorizedRepresentative'
  | 'capacities.relative'
  | 'capacities.other'
  | 'capacities.unknown' {
  if (capacity === 'legal_guardian') return 'capacities.legalGuardian';
  if (capacity === 'authorized_representative') return 'capacities.authorizedRepresentative';
  if (capacity === 'relative') return 'capacities.relative';
  if (capacity === 'other') return 'capacities.other';
  return 'capacities.unknown';
}
