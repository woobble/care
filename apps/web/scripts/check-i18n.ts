import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const webRoot = join(import.meta.dir, '..');
const appRoot = join(webRoot, 'src/app');
const componentRoot = join(webRoot, 'src/components');
const catalogRoot = join(import.meta.dir, '../messages');
const pathFilter = process.argv[2];
const english = JSON.parse(await readFile(join(catalogRoot, 'en.json'), 'utf8')) as unknown;
const german = JSON.parse(await readFile(join(catalogRoot, 'de.json'), 'utf8')) as unknown;

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

const englishKeys = leafKeys(english).sort();
const germanKeys = leafKeys(german).sort();
const englishSet = new Set(englishKeys);
const germanSet = new Set(germanKeys);
const missingGerman = englishKeys.filter((key) => !germanSet.has(key));
const germanOnly = germanKeys.filter((key) => !englishSet.has(key));
if (missingGerman.length || germanOnly.length) {
  console.error('Translation catalog keys differ.');
  if (missingGerman.length) console.error(`Missing in German: ${missingGerman.join(', ')}`);
  if (germanOnly.length) console.error(`German-only keys: ${germanOnly.join(', ')}`);
  process.exitCode = 1;
}

// A deliberately small TSX text scan: it checks literal leaf-element content and
// common visible attributes without pretending to understand arbitrary JSX.
const attributePattern =
  /\b(alt|aria-description|aria-label|confirmation|label|placeholder|title)\s*=\s*(["'])(.*?)\2/gs;
const elementTextPattern = /<[A-Za-z][\w.-]*(?:\s+[^<>]*?)?\s*>([^<>]+)<\/[A-Za-z][\w.-]*\s*>/gs;
const literalExpressionPattern = /\{\s*(["'])([^"'\n]+)\1\s*\}/g;
const findings = new Set<string>();

function isUserText(value: string): boolean {
  const text = value.trim();
  if (!text || text === 'Care Platform') return false;
  if (/^[a-z][a-z\d_-]*$/.test(text)) return false;
  return /[A-Za-zÄÖÜäöüß]/.test(text);
}

function visibleJsxText(value: string): string {
  let depth = 0;
  let visible = '';
  for (const character of value) {
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character === '}' && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0) visible += character;
  }
  return /[{}]/.test(visible) ? '' : visible.trim();
}

async function scan(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      // oxlint-disable-next-line no-await-in-loop -- Preserve sequential file and process operations.
      await scan(path);
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    if (pathFilter && !path.includes(pathFilter)) continue;

    // oxlint-disable-next-line no-await-in-loop -- Preserve sequential file and process operations.
    const source = await readFile(path, 'utf8');
    const report = (offset: number, value: string) => {
      if (!isUserText(value)) return;
      const line = source.slice(0, offset).split('\n').length;
      findings.add(`${relative(webRoot, path)}:${line}: ${value.replace(/\s+/g, ' ')}`);
    };

    elementTextPattern.lastIndex = 0;
    for (const match of source.matchAll(elementTextPattern)) {
      const text = visibleJsxText(match[1]!);
      const offset = (match.index ?? 0) + match[0].indexOf(match[1]!);
      report(offset, text);
    }
    attributePattern.lastIndex = 0;
    for (const match of source.matchAll(attributePattern)) {
      const tagStart = source.lastIndexOf('<', match.index);
      const tagEnd = source.indexOf('>', match.index);
      if (tagStart >= 0 && tagEnd >= (match.index ?? 0)) report(match.index ?? 0, match[3]!);
    }
    literalExpressionPattern.lastIndex = 0;
    for (const match of source.matchAll(literalExpressionPattern))
      report(match.index ?? 0, match[2]!);
  }
}

await scan(appRoot);
await scan(componentRoot);
if (findings.size) {
  console.error('Possible hardcoded user-facing text remains in apps/web/src/app:');
  for (const finding of [...findings].sort()) console.error(`  ${finding}`);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log(
    `Catalog parity passed (${englishKeys.length} messages); no static JSX UI text found.`,
  );
}
