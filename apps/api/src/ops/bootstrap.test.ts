import { describe, expect, test } from 'bun:test';
import { bootstrapInitialAdmin } from './bootstrap';

describe('initial administrator bootstrap', () => {
  test('requires all four explicit inputs before reading production configuration', async () => {
    await expect(bootstrapInitialAdmin([])).rejects.toThrow('Usage: bootstrap-admin');
  });

  test('requires the operator confirmation to match the tenant slug', async () => {
    await expect(
      bootstrapInitialAdmin([
        '--tenant-name',
        'Pilot Care',
        '--tenant-slug',
        'pilot-care',
        '--subject',
        'authentik-user-uuid',
        '--confirm-initial-admin',
        'different-tenant',
      ]),
    ).rejects.toThrow('--confirm-initial-admin pilot-care');
  });

  test('rejects unrecognized and duplicate operator arguments', async () => {
    await expect(
      bootstrapInitialAdmin([
        '--tenant-name',
        'Pilot Care',
        '--tenant-slug',
        'pilot-care',
        '--subject',
        'authentik-user-uuid',
        '--confirm-initial-admin',
        'pilot-care',
        '--force',
      ]),
    ).rejects.toThrow('Usage: bootstrap-admin');
  });
});
