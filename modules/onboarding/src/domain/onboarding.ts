import { z } from 'zod';
import type { AdmissionStage, NeedsAssessment } from '../schema';

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const needsAssessmentSchema = z
  .object({
    requestedServices: z.array(z.string().trim().min(1).max(80)).max(20),
    householdSupport: z.string().max(2000),
    everydayAssistance: z.string().max(2000),
    accompaniment: z.string().max(2000),
    preferredDays: z
      .array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']))
      .max(7)
      .refine((days) => new Set(days).size === days.length),
    preferredTimeStart: z.string().regex(timePattern).nullable(),
    preferredTimeEnd: z.string().regex(timePattern).nullable(),
    visitsPerWeek: z.number().min(0.5).max(21).nullable(),
    preferredStartDate: z.iso.date().nullable(),
    accessibility: z.string().max(2000),
    preferences: z.string().max(2000),
    organizationalNotes: z.string().max(2000),
  })
  .strict()
  .refine(
    (value) =>
      (value.preferredTimeStart === null && value.preferredTimeEnd === null) ||
      (value.preferredTimeStart !== null &&
        value.preferredTimeEnd !== null &&
        value.preferredTimeEnd > value.preferredTimeStart),
    { message: 'Preferred time range is invalid' },
  );

export const DEFAULT_CHECKLIST_ITEMS = [
  {
    code: 'client_identity',
    category: 'client_master_data',
    label: 'Client identity complete',
    source: 'automatic',
    mandatory: true,
    requirementType: 'policy',
  },
  {
    code: 'primary_contact',
    category: 'contact_and_representation',
    label: 'Primary contact recorded',
    source: 'automatic',
    mandatory: true,
    requirementType: 'policy',
  },
  {
    code: 'needs_assessment',
    category: 'needs_assessment',
    label: 'Betreuung needs assessment complete',
    source: 'automatic',
    mandatory: true,
    requirementType: 'policy',
  },
  {
    code: 'funding_arrangement',
    category: 'funding_arrangement',
    label: 'Funding arrangement documented',
    source: 'automatic',
    mandatory: true,
    requirementType: 'policy',
  },
  {
    code: 'service_agreement',
    category: 'service_agreement',
    label: 'Service agreement accepted',
    source: 'automatic',
    mandatory: true,
    requirementType: 'policy',
  },
  {
    code: 'first_visit',
    category: 'scheduling_readiness',
    label: 'First Betreuungseinsatz planned',
    source: 'automatic',
    mandatory: false,
    requirementType: 'policy',
  },
  {
    code: 'provider_document_evidence',
    category: 'required_documents',
    label: 'Provider-selected document evidence',
    source: 'document',
    mandatory: false,
    requirementType: 'policy',
  },
] as const;

export type ChecklistItemInput = {
  code: string;
  category: string;
  label: string;
  source: 'automatic' | 'manual' | 'document';
  mandatory: boolean;
  requirementType: 'policy' | 'external';
};

export function validateChecklistItems(items: readonly ChecklistItemInput[]): void {
  if (items.length < DEFAULT_CHECKLIST_ITEMS.length || items.length > 40) {
    throw new InvalidChecklistTemplateError();
  }
  const codes = new Set<string>();
  for (const item of items) {
    if (
      !/^[a-z][a-z0-9_]{1,63}$/.test(item.code) ||
      item.category.trim().length < 1 ||
      item.category.trim().length > 80 ||
      item.label.trim().length < 1 ||
      item.label.trim().length > 160 ||
      codes.has(item.code) ||
      (item.source === 'automatic' &&
        !DEFAULT_CHECKLIST_ITEMS.some((definition) => definition.code === item.code))
    ) {
      throw new InvalidChecklistTemplateError();
    }
    codes.add(item.code);
  }
  for (const core of DEFAULT_CHECKLIST_ITEMS) {
    const configured = items.find((item) => item.code === core.code);
    if (
      !configured ||
      configured.source !== core.source ||
      (core.source === 'automatic' && configured.mandatory !== core.mandatory) ||
      (core.source === 'document' && configured.category !== core.category)
    ) {
      throw new InvalidChecklistTemplateError();
    }
  }
}

export function canTransition(from: AdmissionStage, to: AdmissionStage): boolean {
  if (from === 'admitted' || from === to) return false;
  if (from === 'declined' || from === 'withdrawn') return to === 'inquiry' || to === 'assessment';
  if (to === 'declined' || to === 'withdrawn') return true;
  switch (from) {
    case 'inquiry':
      return to === 'assessment';
    case 'assessment':
      return to === 'inquiry' || to === 'preparation';
    case 'preparation':
      return to === 'assessment' || to === 'ready_for_admission';
    case 'ready_for_admission':
      return to === 'preparation';
  }
}

export function needsAssessmentComplete(value: NeedsAssessment | null): boolean {
  return (
    value !== null &&
    value.requestedServices.length > 0 &&
    (value.householdSupport.trim().length > 0 ||
      value.everydayAssistance.trim().length > 0 ||
      value.accompaniment.trim().length > 0) &&
    value.visitsPerWeek !== null
  );
}

export class InvalidNeedsAssessmentError extends Error {
  readonly code = 'ONBOARDING_INVALID_ASSESSMENT';

  constructor() {
    super('The needs assessment is invalid');
    this.name = 'InvalidNeedsAssessmentError';
  }
}

export class InvalidChecklistTemplateError extends Error {
  readonly code = 'ONBOARDING_INVALID_CHECKLIST_TEMPLATE';

  constructor() {
    super('The checklist template is invalid');
    this.name = 'InvalidChecklistTemplateError';
  }
}

export class InvalidAdmissionTransitionError extends Error {
  readonly code = 'ONBOARDING_INVALID_TRANSITION';

  constructor(from: AdmissionStage, to: AdmissionStage) {
    super(`Cannot move admission from ${from} to ${to}`);
    this.name = 'InvalidAdmissionTransitionError';
  }
}
