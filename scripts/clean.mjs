import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outputNames = ['dist', '.next', 'coverage', 'test-results', 'playwright-report'];
const workspaceGroups = ['apps', 'modules', 'packages'];
const targets = ['.turbo', 'dist', 'coverage'].map((name) => join(projectRoot, name));

for (const group of workspaceGroups) {
  const groupPath = join(projectRoot, group);
  let entries;

  try {
    entries = await readdir(groupPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspacePath = join(groupPath, entry.name);
    for (const outputName of outputNames) {
      targets.push(join(workspacePath, outputName));
    }
  }
}

const failures = [];

for (const target of targets) {
  try {
    await rm(target, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    failures.push({ target, path: error.path });
  }
}

if (failures.length > 0) {
  const quoteForShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  console.error(
    'Some generated artifacts could not be removed because they are not writable by this user:',
  );

  for (const failure of failures) {
    const blockedPath = relative(projectRoot, failure.path ?? failure.target);
    const artifactPath = relative(projectRoot, failure.target);
    console.error(`- ${blockedPath}`);
    console.error(
      `  Fix ownership once, then rerun: sudo chown -R "$(id -u):$(id -g)" -- ${quoteForShell(artifactPath)}`,
    );
  }

  process.exitCode = 1;
} else {
  console.log('Removed workspace build outputs, caches, coverage, and Playwright reports.');
}
