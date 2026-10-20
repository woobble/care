import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, compareBaseline } from './check.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(extra = {}, exceptions = []) {
  const root = mkdtempSync(join(tmpdir(), 'care-boundaries-'));
  roots.push(root);
  const files = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        paths: { '@module/*': ['./modules/*/src/index.ts'], '@b/*': ['./modules/b/src/*'] },
      },
    }),
    'modules/a/package.json': '{"name":"@care/a","exports":{".":"./src/index.ts"}}',
    'modules/b/package.json': '{"name":"@care/b","exports":{".":"./src/index.ts"}}',
    'modules/a/src/index.ts': 'export const api = () => 1;',
    'modules/b/src/index.ts':
      "export { rows, rows as aliased } from './schema'; export { query } from './query';",
    'modules/b/src/query.ts': 'export const query = () => [];',
    'modules/b/src/schema.ts': 'export const rows = {}; export interface Row { id: string }',
    ...extra,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const policy = {
    modules: {
      a: { public: 'modules/a/src/index.ts', persistence: [] },
      b: { public: 'modules/b/src/index.ts', persistence: ['modules/b/src/schema.ts'] },
    },
    exceptions,
  };
  return { root, policy, result: () => analyze(root, policy) };
}
test('public APIs and own private imports are permitted; comments and strings are ignored', () => {
  const f = fixture({
    'modules/a/src/use.ts':
      "import { query } from '@care/b'; import { api } from './index'; // import { rows } from '@care/b';\nconst s = `import { rows } from '@care/b'`;",
  });
  expect(f.result().violations).toEqual([]);
});
test('barrel table imports, aliases, type queries and namespace imports are prohibited', () => {
  for (const statement of [
    "import { rows } from '@care/b';",
    "import { aliased as local } from '@care/b';",
    "import * as b from '@care/b';",
    "import type { rows } from '@care/b';",
    "const b = import('@care/b');",
    "const b = require('@care/b');",
    "import b = require('@care/b');",
    "type X = typeof import('@care/b').rows;",
  ]) {
    const f = fixture({ 'modules/a/src/use.ts': statement });
    expect(f.result().violations.some((v) => v.kind === 'persistence')).toBe(true);
  }
});
test('relative, workspace deep and path alias private imports are prohibited', () => {
  for (const specifier of ['../../b/src/query', '@care/b/src/query', '@b/query']) {
    const f = fixture({ 'modules/a/src/use.ts': `import { query } from '${specifier}';` });
    expect(f.result().violations.some((v) => v.kind === 'private')).toBe(true);
  }
});
test('multi-hop star, named and imported-local re-exports preserve table provenance', () => {
  for (const barrel of [
    "export * from './schema';",
    "export { rows as exposed } from './schema';",
    "import { rows } from './schema'; export { rows as exposed };",
  ]) {
    const f = fixture({
      'modules/b/src/barrel.ts': barrel,
      'modules/b/src/index.ts': "export * from './barrel';",
      'modules/a/src/use.ts': `import { ${barrel.includes('exposed') ? 'exposed' : 'rows'} } from '@care/b';`,
    });
    expect(f.result().violations.filter((v) => v.kind === 'persistence')).toHaveLength(1);
  }
});
test('pure schema types are allowed through the public entry point', () => {
  const f = fixture({
    'modules/b/src/index.ts': "export type { Row } from './schema';",
    'modules/a/src/use.ts': "import type { Row } from '@care/b';",
  });
  expect(f.result().violations).toEqual([]);
});
test('module cycles report each participating edge, including type dependencies', () => {
  const f = fixture({
    'modules/a/src/index.ts': "import type { query } from '@care/b'; export const api = 1;",
    'modules/b/src/query.ts': "import { api } from '@care/a'; export const query = () => api;",
  });
  expect(f.result().violations.filter((v) => v.kind === 'cycle')).toHaveLength(2);
});
test('explicit infrastructure exception is file scoped and does not permit private access', () => {
  const statement = "import { rows } from '@care/b';";
  const f = fixture(
    { 'apps/api/src/schema.ts': statement, 'apps/api/src/controller.ts': statement },
    [{ files: ['apps/api/src/schema.ts'], allow: ['persistence'], reason: 'Schema composition' }],
  );
  expect(f.result().violations.map((v) => v.file)).toEqual(['apps/api/src/controller.ts']);
});
test('package and web domain dependencies are rejected', () => {
  const f = fixture({
    'packages/shared/src/index.ts': "import { query } from '@care/b';",
    'apps/web/src/use.ts': "import { query } from '@care/b';",
  });
  expect(f.result().violations.filter((v) => v.kind === 'direction')).toHaveLength(2);
});
test('nearest tsconfig aliases and wildcard workspace exports resolve', () => {
  const f = fixture({
    'modules/a/tsconfig.json':
      '{"extends":"../../tsconfig.json","compilerOptions":{"paths":{"local/*":["../b/src/*"]}}}',
    'modules/a/src/use.ts': "import { query } from 'local/query';",
  });
  expect(f.result().violations.map((v) => v.kind)).toEqual(['private']);
});
test('baseline accepts only exact violations, ignores line shifts, reports resolved entries, never mutates', () => {
  const f = fixture({ 'modules/a/src/use.ts': "import { rows } from '@care/b';" });
  const baseline = f.result().violations;
  const snapshot = JSON.stringify(baseline);
  expect(
    compareBaseline(
      baseline.map((v) => ({ ...v, line: 99 })),
      baseline,
    ),
  ).toEqual({ added: [], resolved: [] });
  const newViolation = { ...baseline[0], symbol: 'anotherTable' };
  expect(compareBaseline([...baseline, newViolation], baseline).added).toEqual([newViolation]);
  expect(compareBaseline([], baseline).resolved).toEqual(baseline);
  expect(JSON.stringify(baseline)).toBe(snapshot);
});
test('report order is deterministic and unresolved internal imports fail closed', () => {
  const f = fixture({ 'modules/a/src/use.ts': "import { hidden } from '@module/missing';" });
  expect(f.result().violations[0].kind).toBe('unresolved');
  expect(f.result()).toEqual(f.result());
});

test('star schema barrels preserve valid application APIs without false persistence findings', () => {
  const f = fixture({
    'modules/b/src/index.ts': "export * from './schema'; export * from './query';",
    'modules/a/src/use.ts': "import { query } from '@care/b';",
  });
  expect(f.result().violations).toEqual([]);
});
test('namespace re-exports preserve persistence ownership', () => {
  const f = fixture({
    'modules/b/src/index.ts': "export * as tables from './schema';",
    'modules/a/src/use.ts': "import { tables } from '@care/b';",
  });
  expect(f.result().violations.some((v) => v.kind === 'persistence')).toBe(true);
});
test('wildcard package exports resolve to source', () => {
  const f = fixture({
    'modules/b/package.json':
      '{"name":"@care/b","exports":{".":"./src/index.ts","./*":"./src/*.ts"}}',
    'modules/a/src/use.ts': "import { query } from '@care/b/query';",
  });
  expect(f.result().violations.map((v) => v.kind)).toEqual(['private']);
});
test('CLI exits nonzero for new violations and does not expand the baseline', () => {
  const f = fixture({ 'modules/a/src/use.ts': "import { rows } from '@care/b';" });
  mkdirSync(join(f.root, 'scripts/architecture'), { recursive: true });
  writeFileSync(join(f.root, 'scripts/architecture/ownership.json'), JSON.stringify(f.policy));
  const baselinePath = join(f.root, 'scripts/architecture/baseline.json');
  const baseline = '{"violations":[]}';
  writeFileSync(baselinePath, baseline);
  const result = Bun.spawnSync(
    [process.execPath, new URL('./check.mjs', import.meta.url).pathname],
    { cwd: f.root },
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain('[persistence] rows');
  expect(require('node:fs').readFileSync(baselinePath, 'utf8')).toBe(baseline);
  writeFileSync(baselinePath, JSON.stringify({ violations: f.result().violations }));
  expect(
    Bun.spawnSync([process.execPath, new URL('./check.mjs', import.meta.url).pathname], {
      cwd: f.root,
    }).exitCode,
  ).toBe(0);
});
