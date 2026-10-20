import type { tasks } from '@module/operations/schema';

export type TaskRow = typeof tasks.$inferSelect;
export type SourceType = NonNullable<(typeof tasks.$inferSelect)['sourceType']>;
export type TaskStatus = (typeof tasks.$inferSelect)['status'];
export type TaskPriority = (typeof tasks.$inferSelect)['priority'];
export interface OperationsSourceReference {
  type: SourceType;
  id: string;
}

export interface OperationsTaskInput {
  organizationId?: string;
  facilityId?: string | null;
  clientId?: string | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedEmployeeId?: string | null;
  dueAt?: Date | null;
  source?: OperationsSourceReference | null;
}

export interface OperationsTaskPatch {
  expectedVersion: number;
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedEmployeeId?: string | null;
  dueAt?: Date | null;
}

export interface OperationsTaskListQuery {
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedEmployeeId?: string;
  assignedToMe?: boolean;
  sourceTypes?: SourceType[];
  due?: 'overdue' | 'today' | 'upcoming';
  fromDate?: string;
  untilDate?: string;
  search?: string;
  order?: 'due' | 'created' | 'priority';
  page?: number;
  pageSize?: number;
  offset?: number;
}

export interface TaskResourceContext {
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
}
