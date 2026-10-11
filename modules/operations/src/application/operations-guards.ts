import { and, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { employeeFacilityAssignments, employeeRecords } from '@care/employees';

export async function validateOperationsAssignee(
  transaction: DatabaseTransaction,
  tenantId: string,
  employeeId: string,
  organizationId: string,
  facilityId: string | null,
): Promise<void> {
  const [employee] = await transaction
    .select({ id: employeeRecords.id })
    .from(employeeRecords)
    .where(
      and(
        eq(employeeRecords.tenantId, tenantId),
        eq(employeeRecords.id, employeeId),
        eq(employeeRecords.status, 'active'),
        eq(employeeRecords.organizationId, organizationId),
      ),
    )
    .for('share')
    .limit(1);
  if (!employee) throw new OperationsAssigneeInvalidError();
  if (!facilityId) return;

  const [assignment] = await transaction
    .select({ id: employeeFacilityAssignments.id })
    .from(employeeFacilityAssignments)
    .where(
      and(
        eq(employeeFacilityAssignments.tenantId, tenantId),
        eq(employeeFacilityAssignments.organizationId, organizationId),
        eq(employeeFacilityAssignments.employeeId, employeeId),
        eq(employeeFacilityAssignments.facilityId, facilityId),
        eq(employeeFacilityAssignments.status, 'active'),
      ),
    )
    .for('share')
    .limit(1);
  if (!assignment) throw new OperationsAssigneeInvalidError();
}

export class OperationsAssigneeInvalidError extends Error {
  readonly code = 'OPERATIONS_ASSIGNEE_INVALID';

  constructor() {
    super('The assignee is not active in this task scope');
  }
}
