import { describe, expect, test } from 'bun:test';
import {
  canTransition,
  DEFAULT_CHECKLIST_ITEMS,
  needsAssessmentComplete,
  validateChecklistItems,
} from './onboarding';

describe('onboarding rules', () => {
  test('needs a requested service, a care need, and visit frequency', () => {
    const complete = {
      requestedServices: ['home support'],
      householdSupport: 'Weekly cleaning',
      everydayAssistance: '',
      accompaniment: '',
      preferredDays: [],
      preferredTimeStart: null,
      preferredTimeEnd: null,
      visitsPerWeek: 1,
      preferredStartDate: null,
      accessibility: '',
      preferences: '',
      organizationalNotes: '',
    };

    expect(needsAssessmentComplete(complete)).toBe(true);
    expect(needsAssessmentComplete({ ...complete, requestedServices: [] })).toBe(false);
    expect(
      needsAssessmentComplete({ ...complete, householdSupport: '', visitsPerWeek: null }),
    ).toBe(false);
    expect(needsAssessmentComplete(null)).toBe(false);
  });

  test('only allows defined stage transitions and reopens declined cases to intake', () => {
    expect(canTransition('inquiry', 'assessment')).toBe(true);
    expect(canTransition('inquiry', 'preparation')).toBe(false);
    expect(canTransition('ready_for_admission', 'admitted')).toBe(false);
    expect(canTransition('declined', 'inquiry')).toBe(true);
    expect(canTransition('admitted', 'assessment')).toBe(false);
  });

  test('keeps core automatic requirements fixed while allowing manual items', () => {
    validateChecklistItems(DEFAULT_CHECKLIST_ITEMS);
    validateChecklistItems([
      ...DEFAULT_CHECKLIST_ITEMS,
      {
        code: 'prospect_follow_up',
        category: 'follow_up',
        label: 'Confirm follow-up completed',
        source: 'manual',
        mandatory: true,
        requirementType: 'policy',
      },
    ]);
    expect(() =>
      validateChecklistItems(
        DEFAULT_CHECKLIST_ITEMS.map((item) =>
          item.code === 'client_identity' ? { ...item, mandatory: false } : item,
        ),
      ),
    ).toThrow();
    expect(() =>
      validateChecklistItems([
        ...DEFAULT_CHECKLIST_ITEMS,
        {
          code: 'unsupported_automatic',
          category: 'policy',
          label: 'Unsupported automatic item',
          source: 'automatic',
          mandatory: false,
          requirementType: 'policy',
        },
      ]),
    ).toThrow();
  });
});
