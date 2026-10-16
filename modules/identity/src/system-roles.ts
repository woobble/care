import { inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { DatabaseTransaction } from '@care/database';
import { PERMISSIONS, type Permission } from '@care/permissions';

import { identitySchema } from './schema';

const definitions = {
  Administrator: [...PERMISSIONS],
  Office: [
    'client.read',
    'client.create',
    'client.update',
    'client.archive',
    'communications.read',
    'communications.create',
    'communications.update',
    'communications.amend',
    'communications.preferences.manage',
    'employee.read',
    'employee.create',
    'employee.update',
    'employee.assign_facility',
    'employee.assign_team',
    'employee.link_user',
    'employee.manage_qualifications',
    'employee.manage_skills',
    'employee.manage_employment',
    'organization.read',
    'facility.read',
    'team.read',
    'service.read',
    'service.create',
    'service.update',
    'service.archive',
    'service.manage_categories',
    'service.manage_availability',
    'service.manage_pricing',
    'service_agreement.read',
    'service_agreement.create',
    'service_agreement.update',
    'service_agreement.activate',
    'service_agreement.suspend',
    'service_agreement.end',
    'service_agreement.manage_services',
    'schedule.read',
    'schedule.create',
    'schedule.update',
    'schedule.cancel',
    'schedule.confirm',
    'schedule.assign',
    'schedule.generate',
    'visit_execution.read',
    'visit_execution.correct',
    'care_documentation.read',
    'care_documentation.review',
    'care_documentation.amend',
    'benefits.read',
    'benefits.manage',
    'benefits.adjust',
    'benefits.allocate',
    'benefits.review',
    'billing.read',
    'billing.manage',
    'billing.issue',
    'billing.correct',
    'billing.payments.read',
    'billing.payments.manage',
    'billing.settings.manage',
    'claims.read',
    'claims.manage',
    'claims.submit',
    'claims.record_decision',
    'claims.reconcile',
    'claims.settings.manage',
    'documents.read',
    'documents.generate',
    'documents.templates.manage',
    'documents.exports.read',
    'service_evidence.read',
    'service_evidence.prepare',
    'acknowledgement.read',
    'acknowledgement.revoke',
    'operations.read',
    'operations.tasks.create',
    'operations.tasks.manage',
    'operations.tasks.assign',
    'operations.exceptions.manage',
    'operations.recurring_tasks.manage',
    'operations.reminder_settings.manage',
    'onboarding.read',
    'onboarding.create',
    'onboarding.manage',
    'onboarding.admit',
    'onboarding.templates.manage',
  ],
  Caregiver: [
    'client.read',
    'employee.read',
    'organization.read',
    'facility.read',
    'team.read',
    'service.read',
    'service_agreement.read',
    'schedule.read',
    'visit_execution.read',
    'visit_execution.start',
    'visit_execution.record_services',
    'visit_execution.complete',
    'care_documentation.read',
    'care_documentation.create',
    'care_documentation.update',
    'care_documentation.finalize',
    'service_evidence.read',
    'documents.read',
    'documents.generate',
    'acknowledgement.read',
    'acknowledgement.capture',
  ],
} satisfies Record<string, readonly Permission[]>;

/** Seed the canonical built-in roles for both local setup and first production access. */
export async function seedSystemRoles(
  transaction: DatabaseTransaction,
  tenantId: string,
): Promise<{ id: string; name: keyof typeof definitions }[]> {
  const roleDefinitions = Object.entries(definitions) as [
    keyof typeof definitions,
    readonly Permission[],
  ][];
  const roles = await transaction
    .insert(identitySchema.roles)
    .values(roleDefinitions.map(([name]) => ({ id: uuidv7(), tenantId, name })))
    .onConflictDoUpdate({
      target: [identitySchema.roles.tenantId, identitySchema.roles.name],
      set: { name: sql`excluded.name` },
    })
    .returning({ id: identitySchema.roles.id, name: identitySchema.roles.name });

  if (roles.length) {
    await transaction.delete(identitySchema.rolePermissions).where(
      inArray(
        identitySchema.rolePermissions.roleId,
        roles.map((role) => role.id),
      ),
    );
    await transaction.insert(identitySchema.rolePermissions).values(
      roles.flatMap((role) =>
        definitions[role.name as keyof typeof definitions].map((permission) => ({
          roleId: role.id,
          permission,
        })),
      ),
    );
  }

  return roles as { id: string; name: keyof typeof definitions }[];
}
