import { createHash } from 'node:crypto';

import type { ClientRepresentationType } from '@care/clients';

export const EVIDENCE_SNAPSHOT_VERSION = 1 as const;
export const ACKNOWLEDGEMENT_STATEMENT_VERSION = 'de-v1';
export const ACKNOWLEDGEMENT_STATEMENT_TEXT =
  'Ich bestätige, dass mir die aufgeführten Leistungen und Angaben wie dokumentiert vorgelegt wurden.';

export type EvidenceOutcome = 'performed' | 'partially_performed' | 'not_performed';
export type ServiceEvidenceState = 'documented' | 'not_required';
export type EvidenceSignatoryType = 'client' | 'representative' | 'other_authorized_person';
export type SignatoryCapacity =
  | 'client'
  | 'legal_guardian'
  | 'authorized_representative'
  | 'relative'
  | 'other';
export type AcknowledgementMethod = 'touch_signature' | 'typed_confirmation';
export type DeclineReasonCode =
  | 'declined_without_reason'
  | 'disagrees_with_record'
  | 'unable_to_sign'
  | 'signatory_not_available'
  | 'other';

export interface EvidencePackageItem {
  performedServiceId: string;
  serviceCode: string;
  serviceName: string;
  unit: 'occurrence' | 'minute' | 'hour' | 'day';
  plannedQuantity: string | null;
  actualQuantity: string | null;
  outcome: EvidenceOutcome;
  reasonCode: string | null;
  performedByEmployeeId: string;
  evidenceState: ServiceEvidenceState;
}

export interface EvidenceSnapshot {
  snapshotVersion: typeof EVIDENCE_SNAPSHOT_VERSION;
  tenantId: string;
  clientId: string;
  clientName: string;
  visitId: string;
  plannedStart: string;
  timezone: string;
  executionId: string;
  executionVersion: number;
  actualStart: string;
  actualEnd: string;
  documentationId: string;
  documentationVersion: number;
  amendmentCount: number;
  items: EvidencePackageItem[];
}

export interface SignaturePoint {
  x: number;
  y: number;
}

export type SignatureStrokes = SignaturePoint[][];

export function isRepresentativeAuthorizedAt(
  input: {
    roles: readonly string[];
    representationType: ClientRepresentationType | null;
    validFrom: string | null;
    validUntil: string | null;
  },
  date: string,
): boolean {
  return (
    input.roles.includes('legal_representative') &&
    input.representationType !== null &&
    (!input.validFrom || input.validFrom <= date) &&
    (!input.validUntil || input.validUntil >= date)
  );
}

const MAX_SIGNATURE_STROKES = 32;
const MAX_SIGNATURE_POINTS = 2_000;
const MAX_SIGNATURE_BYTES = 48_000;

export function canonicalEvidenceSnapshot(snapshot: EvidenceSnapshot): string {
  const items = [...snapshot.items]
    .map((item) => ({
      performedServiceId: item.performedServiceId,
      serviceCode: item.serviceCode,
      serviceName: item.serviceName,
      unit: item.unit,
      plannedQuantity: item.plannedQuantity,
      actualQuantity: item.actualQuantity,
      outcome: item.outcome,
      reasonCode: item.reasonCode,
      performedByEmployeeId: item.performedByEmployeeId,
      evidenceState: item.evidenceState,
    }))
    .sort((left, right) =>
      left.performedServiceId < right.performedServiceId
        ? -1
        : left.performedServiceId > right.performedServiceId
          ? 1
          : 0,
    );

  return JSON.stringify({
    snapshotVersion: snapshot.snapshotVersion,
    tenantId: snapshot.tenantId,
    clientId: snapshot.clientId,
    clientName: snapshot.clientName,
    visitId: snapshot.visitId,
    plannedStart: snapshot.plannedStart,
    timezone: snapshot.timezone,
    executionId: snapshot.executionId,
    executionVersion: snapshot.executionVersion,
    actualStart: snapshot.actualStart,
    actualEnd: snapshot.actualEnd,
    documentationId: snapshot.documentationId,
    documentationVersion: snapshot.documentationVersion,
    amendmentCount: snapshot.amendmentCount,
    items,
  });
}

export function hashEvidenceSnapshot(snapshot: EvidenceSnapshot): string {
  return createHash('sha256').update(canonicalEvidenceSnapshot(snapshot), 'utf8').digest('hex');
}

export function verifyEvidenceSnapshot(snapshot: EvidenceSnapshot, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashEvidenceSnapshot(snapshot), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeQuantity(value: string | null): string | null {
  if (value === null) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new InvalidEvidenceSnapshotError();
  const [integerPart = '0', fractionalPart = ''] = value.split('.');
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fractionalPart.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

export function canonicalSignature(strokes: SignatureStrokes): Uint8Array {
  if (!Array.isArray(strokes) || strokes.length === 0) throw new EmptySignatureError();
  if (strokes.length > MAX_SIGNATURE_STROKES) throw new SignatureTooLargeError();
  let pointCount = 0;
  let totalLength = 0;
  const normalized = strokes.map((stroke) => {
    if (!Array.isArray(stroke) || stroke.length < 2) throw new EmptySignatureError();
    pointCount += stroke.length;
    for (let index = 0; index < stroke.length; index += 1) {
      const point = stroke[index];
      if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1
      ) {
        throw new InvalidSignatureError();
      }
      if (index > 0) {
        const previous = stroke[index - 1]!;
        totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
    }
    return stroke.map((point) => ({ x: roundCoordinate(point.x), y: roundCoordinate(point.y) }));
  });
  if (pointCount > MAX_SIGNATURE_POINTS) throw new SignatureTooLargeError();
  if (totalLength < 0.02) throw new EmptySignatureError();

  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, strokes: normalized }));
  if (bytes.byteLength > MAX_SIGNATURE_BYTES) throw new SignatureTooLargeError();
  return bytes;
}

export function hashSignatureArtifact(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeConfirmationName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}

export function isTypedConfirmationValid(expectedName: string, confirmedName: string): boolean {
  const expected = normalizeConfirmationName(expectedName);
  const confirmed = normalizeConfirmationName(confirmedName);
  return expected.length > 0 && expected === confirmed;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export class InvalidEvidenceSnapshotError extends Error {
  readonly code = 'EVIDENCE_PACKAGE_INVALID_STATE';
  constructor() {
    super('Evidence snapshot contains invalid data');
    this.name = 'InvalidEvidenceSnapshotError';
  }
}

export class EmptySignatureError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_EMPTY_SIGNATURE';
  constructor() {
    super('A touch signature must contain a visible stroke');
    this.name = 'EmptySignatureError';
  }
}

export class InvalidSignatureError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_INVALID_INPUT';
  constructor() {
    super('The touch signature contains invalid coordinates');
    this.name = 'InvalidSignatureError';
  }
}

export class SignatureTooLargeError extends Error {
  readonly code = 'ACKNOWLEDGEMENT_SIGNATURE_TOO_LARGE';
  constructor() {
    super('The touch signature is too large');
    this.name = 'SignatureTooLargeError';
  }
}
