const messages: Record<string, string> = {
  INVALID_REQUEST: 'Bitte prüfe die eingegebenen Daten.',
  ORGANIZATION_NOT_FOUND: 'Die Organisation wurde nicht gefunden.',
  ORGANIZATION_ARCHIVED: 'Archivierte Organisationen können nicht geändert werden.',
  ORGANIZATION_HAS_ACTIVE_CHILDREN: 'Archiviere zuerst alle aktiven Einrichtungen und Teams.',
  FACILITY_NOT_FOUND: 'Die Einrichtung wurde nicht gefunden.',
  FACILITY_ARCHIVED: 'Die archivierte Einrichtung kann nicht geändert werden.',
  FACILITY_HAS_ACTIVE_TEAMS: 'Archiviere zuerst die aktiven Teams dieser Einrichtung.',
  TEAM_NOT_FOUND: 'Das Team wurde nicht gefunden.',
  TEAM_ARCHIVED: 'Das archivierte Team kann nicht geändert werden.',
  EMPLOYEE_NOT_FOUND: 'Die Mitarbeiterin oder der Mitarbeiter wurde nicht gefunden.',
  EMPLOYEE_ARCHIVED: 'Archivierte Mitarbeitende können nicht geändert werden.',
  EMPLOYEE_PERSONNEL_NUMBER_ALREADY_EXISTS: 'Diese Personalnummer wird bereits verwendet.',
  INVALID_FACILITY_ASSIGNMENT: 'Die Einrichtung passt nicht zur Organisation der Person.',
  INVALID_TEAM_ASSIGNMENT: 'Das Team passt nicht zur Organisation der Person.',
  PRIMARY_FACILITY_REQUIRED: 'Eine zugewiesene Einrichtung muss als Hauptstandort festgelegt sein.',
  EMPLOYEE_ALREADY_LINKED: 'Diese Person ist bereits mit einem anderen Benutzer verknüpft.',
  USER_ALREADY_LINKED: 'Dieser Benutzer ist bereits mit einer anderen Person verknüpft.',
  CROSS_TENANT_REFERENCE: 'Der ausgewählte Eintrag ist in diesem Mandanten nicht verfügbar.',
  QUALIFICATION_NOT_FOUND: 'Die Qualifikation wurde nicht gefunden.',
  QUALIFICATION_ARCHIVED: 'Die archivierte Qualifikation kann nicht zugewiesen werden.',
  SKILL_NOT_FOUND: 'Die Fähigkeit wurde nicht gefunden.',
  SKILL_ARCHIVED: 'Die archivierte Fähigkeit kann nicht zugewiesen werden.',
  SERVICE_NOT_FOUND: 'Die Leistung wurde nicht gefunden.',
  SERVICE_ARCHIVED: 'Die archivierte Leistung kann nicht geändert werden.',
  SERVICE_CATEGORY_NOT_FOUND: 'Die Leistungskategorie wurde nicht gefunden.',
  SERVICE_CATEGORY_ARCHIVED:
    'Die archivierte Kategorie kann nicht für neue Leistungen verwendet werden.',
  INVALID_SERVICE_VALIDITY: 'Der Gültigkeitszeitraum ist ungültig.',
  INVALID_SERVICE_AVAILABILITY: 'Die Verfügbarkeitszuordnung ist ungültig.',
  SERVICE_CODE_ALREADY_EXISTS: 'Dieser Leistungscode wird bereits verwendet.',
  INVALID_SERVICE_PAGINATION: 'Die Suchfilter sind ungültig.',
  INSUFFICIENT_PERMISSION: 'Du hast keine Berechtigung für diese Aktion.',
};

export function ActionNotice({
  error,
  updated,
}: Readonly<{ error?: string | undefined; updated?: string | undefined }>) {
  return (
    <>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {messages[error] ?? `Die Änderung ist fehlgeschlagen (${error}).`}
        </p>
      ) : null}
      {updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          Änderungen wurden gespeichert.
        </p>
      ) : null}
    </>
  );
}
