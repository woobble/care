import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const employees = pgSchema('employees');

export const employeeRecords = employees.table('employees', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const employeesSchema = { employeeRecords };
