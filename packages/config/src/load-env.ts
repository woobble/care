import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
