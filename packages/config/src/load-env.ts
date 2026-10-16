import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config } from 'dotenv';

let directory = process.cwd();
for (let depth = 0; depth < 3; depth += 1) {
  const projectEnv = join(directory, '.env');
  if (existsSync(projectEnv)) {
    config({ path: projectEnv, quiet: true });
    break;
  }
  const parent = dirname(directory);
  if (parent === directory) break;
  directory = parent;
}
