import type { tourPublications } from '@module/scheduling/schema';

export interface CreateTourInput {
  employeeId: string;
  localDate: string;
  timezone: string;
  visitIds: string[];
}

export interface UpdateTourStopsInput {
  expectedVersion: number;
  stops: Array<{ visitId: string; dispatcherNote?: string | null }>;
}

export interface TourSummary {
  id: string;
  employeeId: string;
  organizationId: string;
  localDate: string;
  timezone: string;
  status: 'draft' | 'published';
  version: number;
  stops: Array<{
    id: string;
    visitId: string;
    sequence: number;
    plannedStart: Date;
    plannedEnd: Date;
    timezone: string;
    estimatedTravelMinutes: number | null;
    estimatedDistanceMeters: number | null;
    routeStatus: 'unknown' | 'available' | 'unavailable' | 'unresolved';
    dispatcherNote: string | null;
  }>;
  latestPublication: typeof tourPublications.$inferSelect | null;
}
