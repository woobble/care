import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('i18n scanner reports hardcoded JSX in nested feature directories', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'care-i18n-scan-'));
  try {
    await Promise.all(
      ['scripts', 'messages', 'src/app', 'src/components', 'src/features/clients/components'].map(
        (path) => mkdir(join(fixture, path), { recursive: true }),
      ),
    );
    await Promise.all([
      copyFile(join(import.meta.dir, 'check-i18n.ts'), join(fixture, 'scripts/check-i18n.ts')),
      writeFile(join(fixture, 'messages/en.json'), '{}'),
      writeFile(join(fixture, 'messages/de.json'), '{}'),
      writeFile(
        join(fixture, 'src/features/clients/components/fixture.tsx'),
        '<p>Untranslated feature fixture</p>',
      ),
    ]);
    const result = Bun.spawn([process.execPath, join(fixture, 'scripts/check-i18n.ts')], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([result.exited, new Response(result.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain(
      'src/features/clients/components/fixture.tsx:1: Untranslated feature fixture',
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
