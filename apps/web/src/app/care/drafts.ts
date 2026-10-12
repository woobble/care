export const CARE_DRAFT_STORAGE_PREFIX = 'care-draft:v1:';
export const CARE_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface CareDraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CareDraftRecord {
  revision: string;
  savedAt: number;
  values: Record<string, string>;
}

export function careDraftPrefix(
  userId: string,
  tenantId: string,
  visitId: string,
  formId: string,
): string {
  return (
    [userId, tenantId, visitId, formId]
      .map(encodeURIComponent)
      .reduce(
        (prefix, part, index) => prefix + (index ? ':' : '') + part,
        CARE_DRAFT_STORAGE_PREFIX,
      ) + ':'
  );
}

export function findCareDraft(
  storage: CareDraftStorage,
  prefix: string,
  revision: string,
  now = Date.now(),
): { current: CareDraftRecord | null; staleCount: number } {
  let current: CareDraftRecord | null = null;
  let staleCount = 0;
  for (const key of keysWithPrefix(storage, prefix)) {
    const record = parseCareDraft(storage.getItem(key));
    if (!record || now - record.savedAt > CARE_DRAFT_RETENTION_MS || record.savedAt > now) {
      storage.removeItem(key);
      continue;
    }
    if (record.revision === revision) {
      if (!current || record.savedAt > current.savedAt) current = record;
    } else {
      staleCount += 1;
    }
  }
  return { current, staleCount };
}

export function saveCareDraft(
  storage: CareDraftStorage,
  prefix: string,
  revision: string,
  values: Record<string, string>,
  savedAt = Date.now(),
): void {
  for (const key of keysWithPrefix(storage, prefix)) storage.removeItem(key);
  storage.setItem(
    prefix + encodeURIComponent(revision),
    JSON.stringify({ revision, savedAt, values } satisfies CareDraftRecord),
  );
}

export function clearCareDrafts(storage: CareDraftStorage, prefix: string): void {
  for (const key of keysWithPrefix(storage, prefix)) storage.removeItem(key);
}

export function clearAllCareDrafts(storage: CareDraftStorage): void {
  clearCareDrafts(storage, 'care-draft:');
}

export function purgeInaccessibleCareDrafts(
  storage: CareDraftStorage,
  userId: string,
  tenantId: string,
  now = Date.now(),
): void {
  const accessiblePrefix =
    CARE_DRAFT_STORAGE_PREFIX +
    encodeURIComponent(userId) +
    ':' +
    encodeURIComponent(tenantId) +
    ':';
  for (const key of keysWithPrefix(storage, CARE_DRAFT_STORAGE_PREFIX)) {
    const record = parseCareDraft(storage.getItem(key));
    if (
      !key.startsWith(accessiblePrefix) ||
      !record ||
      now - record.savedAt > CARE_DRAFT_RETENTION_MS ||
      record.savedAt > now
    ) {
      storage.removeItem(key);
    }
  }
}

function keysWithPrefix(storage: CareDraftStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function parseCareDraft(value: string | null): CareDraftRecord | null {
  if (!value) return null;
  try {
    const record: unknown = JSON.parse(value);
    if (
      typeof record !== 'object' ||
      record === null ||
      !('revision' in record) ||
      typeof record.revision !== 'string' ||
      !('savedAt' in record) ||
      typeof record.savedAt !== 'number' ||
      !Number.isFinite(record.savedAt) ||
      !('values' in record) ||
      typeof record.values !== 'object' ||
      record.values === null ||
      Array.isArray(record.values)
    ) {
      return null;
    }
    const values: Record<string, string> = {};
    for (const [key, item] of Object.entries(record.values)) {
      if (typeof item !== 'string' || key.length > 80 || item.length > 10_000) return null;
      values[key] = item;
    }
    return { revision: record.revision, savedAt: record.savedAt, values };
  } catch {
    return null;
  }
}
