import { sql } from 'drizzle-orm';
import { pgSchema, text, timestamp, uniqueIndex, uuid, primaryKey } from 'drizzle-orm/pg-core';

const identity = pgSchema('identity');

export const users = identity.table('users', {
  id: uuid('id').primaryKey(),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  displayName: text('display_name'),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const externalIdentities = identity.table(
  'external_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('external_identities_issuer_subject_uq').on(table.issuer, table.subject)],
);

export const tenantMemberships = identity.table(
  'tenant_memberships',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    status: text('status')
      .$type<'pending' | 'active' | 'inactive' | 'revoked'>()
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tenant_memberships_user_tenant_uq').on(table.userId, table.tenantId),
    uniqueIndex('tenant_memberships_tenant_user_uq').on(table.tenantId, table.userId),
    uniqueIndex('tenant_memberships_tenant_id_id_uq').on(table.tenantId, table.id),
  ],
);

export const roles = identity.table(
  'roles',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
  },
  (table) => [
    uniqueIndex('roles_tenant_name_uq').on(table.tenantId, table.name),
    uniqueIndex('roles_tenant_id_id_uq').on(table.tenantId, table.id),
  ],
);

export const rolePermissions = identity.table(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    permission: text('permission').notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permission] })],
);

export const membershipRoles = identity.table(
  'membership_roles',
  {
    membershipId: uuid('membership_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    roleId: uuid('role_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.membershipId, table.roleId] })],
);

export const membershipScopes = identity.table(
  'membership_scopes',
  {
    membershipId: uuid('membership_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.membershipId, table.scopeType, table.scopeId] })],
);

export const tenantInvitations = identity.table(
  'tenant_invitations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    email: text('email').notNull(),
    status: text('status')
      .$type<'pending' | 'accepted' | 'expired' | 'revoked'>()
      .notNull()
      .default('pending'),
    createdBy: uuid('created_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tenant_invitations_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('tenant_invitations_pending_email_uq')
      .on(table.tenantId, table.email)
      .where(sql`status = 'pending'`),
  ],
);

export const identitySchema = {
  users,
  externalIdentities,
  tenantMemberships,
  roles,
  rolePermissions,
  membershipRoles,
  membershipScopes,
  tenantInvitations,
};
