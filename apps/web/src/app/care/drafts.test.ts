import { describe, expect, test } from 'bun:test';
import {
  CARE_DRAFT_RETENTION_MS,
  CARE_DRAFT_STORAGE_PREFIX,
  careDraftPrefix,
  clearCareDrafts,
  findCareDraft,
  purgeInaccessibleCareDrafts,
  saveCareDraft,
  type CareDraftStorage,
} from './drafts';

class MemoryStorage implements CareDraftStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('caregiver visit drafts', () => {
  test('keys drafts by user, tenant, visit, form, and server revision', () => {
    const prefix = careDraftPrefix('user one', 'tenant', 'visit', 'note');
    const storage = new MemoryStorage();
    saveCareDraft(storage, prefix, 'documentation:3', { content: 'Kept locally' }, 100);

    expect(storage.key(0)).toContain(encodeURIComponent('user one'));
    expect(storage.key(0)).toEndWith(encodeURIComponent('documentation:3'));
    expect(findCareDraft(storage, prefix, 'documentation:3', 200).current).toEqual({
      revision: 'documentation:3',
      savedAt: 100,
      values: { content: 'Kept locally' },
    });
  });

  test('does not restore stale or expired revisions and can discard them', () => {
    const storage = new MemoryStorage();
    const prefix = careDraftPrefix('user', 'tenant', 'visit', 'note');
    storage.setItem(
      prefix + encodeURIComponent('documentation:2'),
      JSON.stringify({ revision: 'documentation:2', savedAt: 100, values: { content: 'Older' } }),
    );
    storage.setItem(
      prefix + encodeURIComponent('documentation:1'),
      JSON.stringify({
        revision: 'documentation:1',
        savedAt: 100 - CARE_DRAFT_RETENTION_MS - 1,
        values: { content: 'Expired' },
      }),
    );

    expect(findCareDraft(storage, prefix, 'documentation:3', 200)).toEqual({
      current: null,
      staleCount: 1,
    });
    clearCareDrafts(storage, prefix);
    expect(storage.length).toBe(0);
  });

  test('purges drafts belonging to another account or tenant', () => {
    const storage = new MemoryStorage();
    const ownPrefix = careDraftPrefix('user', 'tenant', 'visit', 'note');
    const otherPrefix = careDraftPrefix('other-user', 'tenant', 'visit', 'note');
    saveCareDraft(storage, ownPrefix, 'execution:1', { content: 'Own' }, 100);
    saveCareDraft(storage, otherPrefix, 'execution:1', { content: 'Other' }, 100);

    purgeInaccessibleCareDrafts(storage, 'user', 'tenant', 200);

    expect(storage.length).toBe(1);
    expect(storage.key(0)?.startsWith(CARE_DRAFT_STORAGE_PREFIX + 'user:tenant:')).toBe(true);
  });
});
