import { describe, expect, test } from 'bun:test';

import { transitionStructureStatus } from './organization';

describe('organization structure lifecycle', () => {
  test('uses the same explicit active and archived states for organizations, facilities, and teams', () => {
    expect(transitionStructureStatus('activate')).toBe('active');
    expect(transitionStructureStatus('archive')).toBe('archived');
  });
});
