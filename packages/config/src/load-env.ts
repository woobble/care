import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config } from 'dotenv';

export function loadApplicationEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): string | undefined {
  if (environment.CARE_DISABLE_DOTENV === 'true') return undefined;

  const nodeEnvironment = environment.NODE_ENV ?? 'development';
  const environmentFile =
    nodeEnvironment === 'production'
      ? undefined
      : nodeEnvironment === 'test'
        ? '.env.test'
        : '.env';

  if (!environmentFile) return undefined;

  let directory = workingDirectory;
  for (let depth = 0; depth < 3; depth += 1) {
    const projectEnv = join(directory, environmentFile);
    if (existsSync(projectEnv)) {
      config({ path: projectEnv, processEnv: environment, quiet: true });
      return projectEnv;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return undefined;
}

loadApplicationEnvironment();
