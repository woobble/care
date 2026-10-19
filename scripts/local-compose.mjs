import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLocalComposeProject } from './local-compose-project.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [operation] = process.argv.slice(2);

if (!['up', 'down'].includes(operation)) {
  process.stderr.write('Usage: bun scripts/local-compose.mjs up | down\n');
  process.exit(2);
}

try {
  const projectName = resolveLocalComposeProject();
  const compose = ['compose', '--project-name', projectName, '-f', 'compose.yaml'];
  if (projectName !== 'care-platform-dev') {
    compose.push('-f', 'compose.e2e.yaml', '-f', 'compose.authentik-patched-e2e.yaml');
  }
  if (operation === 'down') {
    execFileSync('docker', [...compose, 'down'], { cwd: projectRoot, stdio: 'inherit' });
  } else {
    execFileSync('docker', [...compose, '--profile', 'development', 'up', '-d', '--wait'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    execFileSync(
      'docker',
      [
        ...compose,
        '--profile',
        'development',
        '--profile',
        'bootstrap',
        'run',
        '--rm',
        '--no-deps',
        'seaweedfs-init',
      ],
      { cwd: projectRoot, stdio: 'inherit' },
    );
  }
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    process.exit(error.status || 1);
  }
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Local Compose command failed.'}\n`,
  );
  process.exit(1);
}
