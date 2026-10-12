import { describe, expect, test } from 'bun:test';
import { assertDatabaseObjectReferences, createRecoverySet, restoreRecoverySet } from './recovery';

describe('operator recovery commands', () => {
  test('requires explicit write quiescence before touching production configuration', async () => {
    await expect(createRecoverySet([])).rejects.toThrow('--confirm-quiesced');
  });

  test('requires a recovery set and explicit isolated targets before restoring', async () => {
    await expect(restoreRecoverySet([])).rejects.toThrow('Usage: restore');
  });

  test('detects missing and hash-mismatched database object references', () => {
    expect(() =>
      assertDatabaseObjectReferences(new Map([['documents/a.pdf', 'a'.repeat(64)]]), [
        { key: 'documents/missing.pdf', sha256: 'b'.repeat(64) },
        { key: 'documents/a.pdf', sha256: 'c'.repeat(64) },
      ]),
    ).toThrow('1 referenced objects missing, 1 hashes differ');
  });
});
