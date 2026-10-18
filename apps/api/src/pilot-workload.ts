export type PilotWorkloadVisit = {
  id: string;
  localDate: string;
  plannedStart: Date;
  employeeId: string;
};

export function selectDailyPilotWorkload(input: {
  visits: readonly PilotWorkloadVisit[];
  visitsPerWorkday: number;
  preferredVisitId?: string;
  requireTargetPerWorkday?: boolean;
}): PilotWorkloadVisit[] {
  if (
    !Number.isSafeInteger(input.visitsPerWorkday) ||
    input.visitsPerWorkday < 2 ||
    input.visitsPerWorkday > 6
  ) {
    throw new RangeError('Pilot workload must request between 2 and 6 visits per workday');
  }

  const visitsByDay = new Map<string, PilotWorkloadVisit[]>();
  const visitIds = new Set<string>();
  for (const visit of input.visits) {
    if (visitIds.has(visit.id)) throw new Error(`Duplicate pilot workload visit ${visit.id}`);
    visitIds.add(visit.id);
    visitsByDay.set(visit.localDate, [...(visitsByDay.get(visit.localDate) ?? []), visit]);
  }

  const preferredVisit = input.preferredVisitId
    ? input.visits.find((visit) => visit.id === input.preferredVisitId)
    : undefined;
  if (input.preferredVisitId && !preferredVisit) {
    throw new Error(`Preferred pilot workload visit ${input.preferredVisitId} is unavailable`);
  }

  const selected: PilotWorkloadVisit[] = [];
  for (const localDate of [...visitsByDay.keys()].sort()) {
    const dayVisits = [...(visitsByDay.get(localDate) ?? [])].sort(
      (left, right) =>
        left.plannedStart.getTime() - right.plannedStart.getTime() ||
        left.id.localeCompare(right.id),
    );
    if (input.requireTargetPerWorkday && dayVisits.length < input.visitsPerWorkday) {
      throw new Error(
        `Pilot workload on ${localDate} has ${dayVisits.length} ended visits; ${input.visitsPerWorkday} are required`,
      );
    }

    const daySelection: PilotWorkloadVisit[] = [];
    const selectedIds = new Set<string>();
    const selectedEmployees = new Set<string>();
    if (preferredVisit?.localDate === localDate) {
      daySelection.push(preferredVisit);
      selectedIds.add(preferredVisit.id);
      selectedEmployees.add(preferredVisit.employeeId);
    }

    for (const visit of dayVisits) {
      if (daySelection.length >= input.visitsPerWorkday) break;
      if (selectedIds.has(visit.id) || selectedEmployees.has(visit.employeeId)) continue;
      daySelection.push(visit);
      selectedIds.add(visit.id);
      selectedEmployees.add(visit.employeeId);
    }

    for (const visit of dayVisits) {
      if (daySelection.length >= input.visitsPerWorkday) break;
      if (selectedIds.has(visit.id)) continue;
      daySelection.push(visit);
      selectedIds.add(visit.id);
    }

    selected.push(...daySelection);
  }

  return selected;
}
