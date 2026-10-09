import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@care/organizations';

const workforceCompliance = pgSchema('workforce_compliance');

export const workforceComplianceSettings = workforceCompliance.table(
  'settings',
  {
    tenantId: uuid('tenant_id').primaryKey(),
    criticalDays: integer('critical_days').notNull().default(30),
    warningDays: integer('warning_days').notNull().default(90),
    reportingTimezone: text('reporting_timezone').notNull().default('Europe/Berlin'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'workforce_compliance_settings_thresholds_check',
      sql`${table.criticalDays} BETWEEN 1 AND 365 AND ${table.warningDays} BETWEEN 1 AND 365 AND ${table.criticalDays} <= ${table.warningDays}`,
    ),
    check('workforce_compliance_settings_version_check', sql`${table.version} > 0`),
    check(
      'workforce_compliance_settings_timezone_check',
      sql`length(trim(${table.reportingTimezone})) BETWEEN 1 AND 100`,
    ),
    foreignKey({
      name: 'workforce_compliance_settings_tenant_fk',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
  ],
);

export const workforceComplianceSchema = { workforceComplianceSettings };
