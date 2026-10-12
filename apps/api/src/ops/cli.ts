// oxlint-disable-next-line import/no-unassigned-import -- operator commands read the protected deployment env file
import '@care/config/load-env';
import { resolveSecretFiles } from '@care/config';
import { bootstrapInitialAdmin } from './bootstrap';
import {
  createRecoverySet,
  pruneRecoverySets,
  restoreRecoverySet,
  verifyRecoverySet,
} from './recovery';
import { runProductionPreflight } from './preflight';

process.umask(0o077);

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'preflight':
      await runProductionPreflight();
      break;
    case 'bootstrap-admin':
      await bootstrapInitialAdmin(args);
      break;
    case 'create':
      await createRecoverySet(args);
      break;
    case 'verify':
      if (!args[0]) throw new Error('Usage: verify <recovery-set-id>');
      await verifyRecoverySet(args[0], { markVerified: true });
      break;
    case 'restore':
      await restoreRecoverySet(args);
      break;
    case 'prune':
      await pruneRecoverySets(args);
      break;
    default:
      process.stderr.write(
        'Usage: preflight | bootstrap-admin ... | create --confirm-quiesced | verify <set-id> | restore <set-id> ... | prune [--apply]\n',
      );
      process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`Operator command failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unexpected failure';
  let message = error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]');
  try {
    const environment = resolveSecretFiles(process.env);
    for (const name of [
      'DATABASE_URL',
      'MIGRATION_DATABASE_URL',
      'WORKER_DATABASE_URL',
      'OIDC_CLIENT_SECRET',
      'AUTH_SECRET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'AUTHENTIK_SECRET_KEY',
      'POSTGRES_PASSWORD',
      'CARE_APP_PASSWORD',
      'CARE_WORKER_PASSWORD',
      'AUTHENTIK_BOOTSTRAP_PASSWORD',
      'SMTP_PASSWORD',
    ]) {
      const secret = environment[name];
      if (secret) message = message.replaceAll(secret, '[redacted]');
    }
  } catch {
    // The original configuration error is already value-free.
  }
  return `${error.name}: ${message.slice(0, 500)}`;
}
