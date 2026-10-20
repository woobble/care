import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliArguments = process.argv.slice(2);

if (cliArguments.length !== 1 || cliArguments[0] !== '--production') {
  process.stderr.write(
    'Usage: bun run deploy:update -- --production\nPass --production explicitly to update the production checkout and deployment.\n',
  );
  process.exit(2);
}

try {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']);
  if (resolve(repositoryRoot) !== projectRoot) {
    throw new Error('Run deploy:update from the Care Platform repository.');
  }

  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) {
    throw new Error(
      'The checkout has uncommitted or untracked files. Commit or remove them before updating production.',
    );
  }

  const branch = gitOptional(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch) {
    throw new Error(
      'The production checkout is detached. Check out its release branch before updating.',
    );
  }

  const remote = gitOptional(['config', '--get', `branch.${branch}.remote`]);
  const mergeRef = gitOptional(['config', '--get', `branch.${branch}.merge`]);
  if (!remote || remote === '.' || !mergeRef?.startsWith('refs/heads/')) {
    throw new Error(
      `Branch ${branch || '(detached HEAD)'} must track a branch on a Git remote before it can be updated.`,
    );
  }

  process.stdout.write(`Fetching ${remote}/${mergeRef.slice('refs/heads/'.length)}…\n`);
  execFileSync('git', ['fetch', '--no-tags', remote], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const currentCommit = git(['rev-parse', 'HEAD']);
  const upstreamCommit = git(['rev-parse', upstream]);
  if (currentCommit !== upstreamCommit) {
    const ancestorStatus = gitStatus(['merge-base', '--is-ancestor', 'HEAD', upstream]);
    if (ancestorStatus === 1) {
      throw new Error(
        `Branch ${branch} is ahead of or has diverged from ${upstream}. Reconcile it manually; production updates only fast-forward.`,
      );
    }
    if (ancestorStatus !== 0) {
      throw new Error(`Could not compare the production checkout with ${upstream}.`);
    }

    process.stdout.write(`Fast-forwarding ${branch} to ${upstream}…\n`);
    execFileSync('git', ['merge', '--ff-only', '--no-edit', upstream], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
  } else {
    process.stdout.write(`Checkout is already current with ${upstream}.\n`);
  }

  process.stdout.write('Deploying the updated release…\n');
  execFileSync(
    process.execPath,
    [resolve(projectRoot, 'scripts/deploy.mjs'), 'up', '--production'],
    { cwd: projectRoot, stdio: 'inherit' },
  );
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    process.exit(error.status || 1);
  }
  process.stderr.write(`${error instanceof Error ? error.message : 'Production update failed.'}\n`);
  process.exit(1);
}

function git(arguments__) {
  try {
    return execFileSync('git', arguments__, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? error.stderr : '';
    throw new Error(
      typeof stderr === 'string' && stderr.trim()
        ? stderr.trim()
        : `git ${arguments__.join(' ')} failed.`,
      { cause: error },
    );
  }
}

function gitOptional(arguments__) {
  try {
    return execFileSync('git', arguments__, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
      return null;
    }
    const stderr = error && typeof error === 'object' && 'stderr' in error ? error.stderr : '';
    throw new Error(
      typeof stderr === 'string' && stderr.trim()
        ? stderr.trim()
        : `git ${arguments__.join(' ')} failed.`,
      { cause: error },
    );
  }
}

function gitStatus(arguments__) {
  try {
    execFileSync('git', arguments__, {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return 0;
  } catch (error) {
    return error && typeof error === 'object' && 'status' in error ? error.status : 1;
  }
}
