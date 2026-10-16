import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantMemberships, users } from '@care/identity';
import { facilities, organizationsTable, teams, tenants } from '@care/organizations';

const employees = pgSchema('employees');

export const employeeRecords = employees.table(
  'employees',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id'),
    userId: uuid('user_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name'),
    email: text('email'),
    phone: text('phone'),
    personnelNumber: text('personnel_number'),
    employmentType: text('employment_type'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    weeklyHours: numeric('weekly_hours', { precision: 5, scale: 2, mode: 'number' }),
    status: text('status').$type<'active' | 'inactive' | 'archived'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('employees_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('employees_tenant_organization_id_id_uq').on(
      table.tenantId,
      table.organizationId,
      table.id,
    ),
    uniqueIndex('employees_personnel_number_uq')
      .on(table.tenantId, table.personnelNumber)
      .where(sql`${table.personnelNumber} IS NOT NULL`),
    uniqueIndex('employees_user_per_tenant_uq')
      .on(table.tenantId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index('employees_tenant_organization_status_name_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
      table.lastName,
      table.firstName,
      table.id,
    ),
    check(
      'employees_employment_dates_check',
      sql`${table.endDate} IS NULL OR ${table.startDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      'employees_weekly_hours_check',
      sql`${table.weeklyHours} IS NULL OR ${table.weeklyHours} BETWEEN 0 AND 168`,
    ),
    foreignKey({
      name: 'employees_tenant_fk',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
    foreignKey({
      name: 'employees_tenant_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
    }),
    foreignKey({
      name: 'employees_user_fk',
      columns: [table.userId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'employees_tenant_membership_fk',
      columns: [table.tenantId, table.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
    }),
  ],
);

export const employeeFacilityAssignments = employees.table(
  'employee_facility_assignments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('employee_facility_active_assignment_uq')
      .on(table.tenantId, table.employeeId, table.facilityId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('employee_facility_primary_uq')
      .on(table.tenantId, table.employeeId)
      .where(sql`${table.status} = 'active' AND ${table.isPrimary} = true`),
    index('employee_facility_by_facility_idx')
      .on(table.tenantId, table.facilityId, table.employeeId)
      .where(sql`${table.status} = 'active'`),
    check(
      'employee_facility_assignment_dates_check',
      sql`${table.validUntil} IS NULL OR ${table.validFrom} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    foreignKey({
      name: 'employee_facility_assignment_employee_fk',
      columns: [table.tenantId, table.organizationId, table.employeeId],
      foreignColumns: [
        employeeRecords.tenantId,
        employeeRecords.organizationId,
        employeeRecords.id,
      ],
    }),
    foreignKey({
      name: 'employee_facility_assignment_facility_fk',
      columns: [table.tenantId, table.organizationId, table.facilityId],
      foreignColumns: [facilities.tenantId, facilities.organizationId, facilities.id],
    }),
  ],
);

export const employeeTeamMemberships = employees.table(
  'employee_team_memberships',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    teamId: uuid('team_id').notNull(),
    role: text('role'),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('employee_team_active_membership_uq')
      .on(table.tenantId, table.employeeId, table.teamId)
      .where(sql`${table.status} = 'active'`),
    index('employee_team_by_team_idx')
      .on(table.tenantId, table.teamId, table.employeeId)
      .where(sql`${table.status} = 'active'`),
    check(
      'employee_team_membership_dates_check',
      sql`${table.validUntil} IS NULL OR ${table.validFrom} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    foreignKey({
      name: 'employee_team_membership_employee_fk',
      columns: [table.tenantId, table.organizationId, table.employeeId],
      foreignColumns: [
        employeeRecords.tenantId,
        employeeRecords.organizationId,
        employeeRecords.id,
      ],
    }),
    foreignKey({
      name: 'employee_team_membership_team_fk',
      columns: [table.tenantId, table.organizationId, table.teamId],
      foreignColumns: [teams.tenantId, teams.organizationId, teams.id],
    }),
  ],
);

export const qualificationDefinitions = employees.table(
  'qualification_definitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('qualification_definitions_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('qualification_definitions_tenant_name_uq').on(table.tenantId, table.name),
    uniqueIndex('qualification_definitions_tenant_code_uq')
      .on(table.tenantId, table.code)
      .where(sql`${table.code} IS NOT NULL`),
    foreignKey({
      name: 'qualification_definitions_tenant_fk',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
  ],
);

export const employeeQualifications = employees.table(
  'employee_qualifications',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    qualificationId: uuid('qualification_id').notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    issuer: text('issuer'),
    status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('employee_qualification_active_employee_definition_uq')
      .on(table.tenantId, table.employeeId, table.qualificationId)
      .where(sql`${table.status} = 'active'`),
    index('employee_qualification_employee_history_idx').on(
      table.tenantId,
      table.employeeId,
      table.qualificationId,
    ),
    index('employee_qualification_tenant_valid_until_idx')
      .on(table.tenantId, table.validUntil)
      .where(sql`${table.validUntil} IS NOT NULL`),
    check(
      'employee_qualification_dates_check',
      sql`${table.validUntil} IS NULL OR ${table.validFrom} IS NULL OR ${table.validUntil} >= ${table.validFrom}`,
    ),
    check(
      'employee_qualification_revocation_check',
      sql`(${table.status} = 'active' AND ${table.revokedAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: 'employee_qualification_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'employee_qualification_definition_fk',
      columns: [table.tenantId, table.qualificationId],
      foreignColumns: [qualificationDefinitions.tenantId, qualificationDefinitions.id],
    }),
  ],
);

export const skillDefinitions = employees.table(
  'skill_definitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('skill_definitions_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('skill_definitions_tenant_name_uq').on(table.tenantId, table.name),
    uniqueIndex('skill_definitions_tenant_code_uq')
      .on(table.tenantId, table.code)
      .where(sql`${table.code} IS NOT NULL`),
    foreignKey({
      name: 'skill_definitions_tenant_fk',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
  ],
);

export const employeeSkills = employees.table(
  'employee_skills',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('employee_skill_employee_definition_uq').on(
      table.tenantId,
      table.employeeId,
      table.skillId,
    ),
    foreignKey({
      name: 'employee_skill_employee_fk',
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employeeRecords.tenantId, employeeRecords.id],
    }),
    foreignKey({
      name: 'employee_skill_definition_fk',
      columns: [table.tenantId, table.skillId],
      foreignColumns: [skillDefinitions.tenantId, skillDefinitions.id],
    }),
  ],
);

export const employeesSchema = {
  employeeRecords,
  employeeFacilityAssignments,
  employeeTeamMemberships,
  qualificationDefinitions,
  employeeQualifications,
  skillDefinitions,
  employeeSkills,
};
