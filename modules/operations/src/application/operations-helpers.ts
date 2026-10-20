import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import { InvalidOperationsInputError } from './task.errors';
export function hasGrant(principal: AuthorizationPrincipal, permission: Permission): boolean {
  return principal.grants.some((grant) => grant.permission === permission);
}

export function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  maximum: number,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > maximum)
    throw new InvalidOperationsInputError();
  return result;
}

export function displayNameWithoutIdentifiers(value: string | null): string | null {
  const normalized = value?.trim();
  if (
    !normalized ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(normalized)
  )
    return null;
  return normalized;
}
