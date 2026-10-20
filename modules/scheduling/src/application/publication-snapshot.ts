export function isPublishedStop(value: unknown): value is {
  visitId: string;
  plannedStart: string;
  plannedEnd: string;
} {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.visitId === 'string' &&
    typeof row.plannedStart === 'string' &&
    typeof row.plannedEnd === 'string'
  );
}
