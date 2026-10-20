import type { SQL } from 'drizzle-orm';

import type { DatabaseTransaction } from '@care/database';
import type { AuthorizationPrincipal, ResourceContext } from '@care/permissions';

import type { OperationsSourceReference, TaskResourceContext, TaskRow } from './task.contracts';

/** Legacy foreign reads, SQL predicates and display joins. No task lifecycle or aggregation. */
export interface OperationsTaskData {
  validateSource(
    principal: AuthorizationPrincipal,
    source: OperationsSourceReference,
  ): Promise<TaskResourceContext>;
  clientContext(principal: AuthorizationPrincipal, clientId: string): Promise<TaskResourceContext>;
  assertTaskScope(resource: ResourceContext): Promise<void>;
  assertTaskClientAccess(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    task: Pick<TaskRow, 'clientId'>,
  ): Promise<void>;
  employeeForUser(tenantId: string, userId: string): Promise<string | null>;
  activityActors(
    transaction: DatabaseTransaction,
    tenantId: string,
    actorIds: string[],
  ): Promise<Array<{ id: string; displayName: string | null }>>;
  listWithDisplay(
    transaction: DatabaseTransaction,
    where: SQL | undefined,
    orderBy: SQL[],
    pageSize: number,
    offset: number,
  ): Promise<
    Array<{ task: TaskRow; clientName: string | null; assignedEmployeeName: string | null }>
  >;
  matchingClientName(pattern: string): SQL;
  dueLocalDates(): { dueDate: SQL; today: SQL };
  clientReadScope(principal: AuthorizationPrincipal): SQL | null;
}
