import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLocalComposeProject } from '../../../scripts/local-compose-project.mjs';

import { loadApplicationEnvironment } from './load-env';

const temporaryDirectories: string[] = [];

function createEnvironmentDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'care-env-selection-'));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, '.env'), 'CARE_ENV_SOURCE=development\n');
  writeFileSync(join(directory, '.env.test'), 'CARE_ENV_SOURCE=test\n');
  writeFileSync(join(directory, '.env.production'), 'CARE_ENV_SOURCE=production\n');
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('application environment selection', () => {
  test('restricts local Compose helpers to development and isolated E2E projects', () => {
    expect(resolveLocalComposeProject({})).toBe('care-platform-dev');
    expect(resolveLocalComposeProject({ COMPOSE_PROJECT_NAME: 'care-platform-e2e-goal15' })).toBe(
      'care-platform-e2e-goal15',
    );
    expect(() =>
      resolveLocalComposeProject({ COMPOSE_PROJECT_NAME: 'care-platform-prod' }),
    ).toThrow('Local Compose commands require');
  });

  test('loads only the development environment file in development', () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    const directory = createEnvironmentDirectory();

    expect(loadApplicationEnvironment(environment, directory)).toBe(join(directory, '.env'));
    expect(environment.CARE_ENV_SOURCE).toBe('development');
  });

  test('loads only the dedicated test environment file in tests', () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    const directory = createEnvironmentDirectory();

    expect(loadApplicationEnvironment(environment, directory)).toBe(join(directory, '.env.test'));
    expect(environment.CARE_ENV_SOURCE).toBe('test');
  });

  test('never loads environment files in production', () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    const directory = createEnvironmentDirectory();

    expect(loadApplicationEnvironment(environment, directory)).toBeUndefined();
    expect(environment.CARE_ENV_SOURCE).toBeUndefined();
  });

  test('honors an explicit dotenv opt-out for isolated development processes', () => {
    const environment: NodeJS.ProcessEnv = {
      CARE_DISABLE_DOTENV: 'true',
      NODE_ENV: 'development',
    };
    const directory = createEnvironmentDirectory();

    expect(loadApplicationEnvironment(environment, directory)).toBeUndefined();
    expect(environment.CARE_ENV_SOURCE).toBeUndefined();
  });

  test('disables Bun automatic production environment loading', () => {
    const directory = mkdtempSync(join(tmpdir(), 'care-bun-env-selection-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, '.env.production'), 'CARE_ENV_SOURCE=production\n');

    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const result = execFileSync(
      process.execPath,
      [
        `--config=${join(repositoryRoot, 'bunfig.toml')}`,
        '-e',
        'process.stdout.write(process.env.CARE_ENV_SOURCE ?? "unset")',
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { NODE_ENV: 'production', PATH: process.env.PATH ?? '' },
      },
    );

    expect(result).toBe('unset');
  });

  test('requires an explicit production flag before the deploy wrapper accesses configuration', () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts/deploy.mjs'), 'preflight'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Pass --production explicitly');
    expect(result.stderr).not.toContain('Cannot read .env.production');
  });

  test('does not fall back to development configuration when test configuration is absent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'care-env-test-only-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, '.env'), 'CARE_ENV_SOURCE=development\n');

    const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    expect(loadApplicationEnvironment(environment, directory)).toBeUndefined();
    expect(environment.CARE_ENV_SOURCE).toBeUndefined();
  });
});
