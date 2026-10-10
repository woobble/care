import { createHash } from 'node:crypto';

export function stableIssueId(
  domain: string,
  entityType: string,
  entityId: string,
  issueCode: string,
): string {
  return createHash('sha256')
    .update(`${domain}\u0000${entityType}\u0000${entityId}\u0000${issueCode}`)
    .digest('hex');
}

export function evidenceIssueCode(
  item: {
    status: string;
    evidencePackageId: string | null;
    signatureAvailable: boolean;
  },
  acknowledgementRequired: boolean,
): string | null {
  if (!item.evidencePackageId) return null;
  if (item.status === 'awaiting_acknowledgement' && !acknowledgementRequired) return null;
  switch (item.status) {
    case 'awaiting_acknowledgement':
      return 'acknowledgement_missing';
    case 'declined':
      return 'acknowledgement_declined';
    case 'revoked':
      return 'acknowledgement_revoked';
    case 'outdated':
      return 'evidence_outdated';
    default:
      return null;
  }
}

export function evidencePackageIssueCode(status: string): string | null {
  switch (status) {
    case 'ready':
      return 'acknowledgement_missing';
    case 'declined':
      return 'acknowledgement_declined';
    case 'revoked':
      return 'acknowledgement_revoked';
    case 'outdated':
      return 'evidence_outdated';
    default:
      return null;
  }
}
