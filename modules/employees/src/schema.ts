import { foreignKey, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantMemberships, users } from '@care/identity';

const employees = pgSchema('employees');

export const employeeRecords = employees.table(
  'employees',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
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

export const employeesSchema = { employeeRecords };
