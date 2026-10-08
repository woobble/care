export function roleLabelKey(
  name: string,
):
  | 'Users.rolesLabels.administrator'
  | 'Users.rolesLabels.office'
  | 'Users.rolesLabels.caregiver'
  | 'Users.rolesLabels.unknown' {
  const keys = {
    administrator: 'Users.rolesLabels.administrator',
    office: 'Users.rolesLabels.office',
    caregiver: 'Users.rolesLabels.caregiver',
  } as const;
  const normalized = name.toLowerCase();
  return normalized in keys ? keys[normalized as keyof typeof keys] : 'Users.rolesLabels.unknown';
}

export function scopeTypeLabelKey(
  scopeType: string,
):
  | 'Users.scopes.tenant'
  | 'Users.scopes.organization'
  | 'Users.scopes.facility'
  | 'Users.scopes.team'
  | 'Users.scopes.unknown' {
  const keys = {
    tenant: 'Users.scopes.tenant',
    organization: 'Users.scopes.organization',
    facility: 'Users.scopes.facility',
    team: 'Users.scopes.team',
  } as const;
  return scopeType in keys ? keys[scopeType as keyof typeof keys] : 'Users.scopes.unknown';
}

const permissionResources = {
  'tenant.members': 'Users.permissionResources.members',
  'tenant.roles': 'Users.permissionResources.roles',
  client: 'Users.permissionResources.clients',
  service: 'Users.permissionResources.services',
  service_agreement: 'Users.permissionResources.serviceAgreements',
  schedule: 'Users.permissionResources.schedule',
  visit_execution: 'Users.permissionResources.visits',
  care_documentation: 'Users.permissionResources.documentation',
  service_evidence: 'Users.permissionResources.serviceEvidence',
  acknowledgement: 'Users.permissionResources.acknowledgements',
  employee: 'Users.permissionResources.employees',
  organization: 'Users.permissionResources.organizations',
  facility: 'Users.permissionResources.facilities',
  team: 'Users.permissionResources.teams',
  audit: 'Users.permissionResources.audit',
} as const;

const permissionActions = {
  read: 'Users.permissionActions.read',
  manage: 'Users.permissionActions.manage',
  assign: 'Users.permissionActions.assign',
  create: 'Users.permissionActions.create',
  update: 'Users.permissionActions.update',
  archive: 'Users.permissionActions.archive',
  manage_categories: 'Users.permissionActions.manageCategories',
  manage_availability: 'Users.permissionActions.manageAvailability',
  activate: 'Users.permissionActions.activate',
  suspend: 'Users.permissionActions.suspend',
  end: 'Users.permissionActions.end',
  manage_services: 'Users.permissionActions.manageServices',
  cancel: 'Users.permissionActions.cancel',
  confirm: 'Users.permissionActions.confirm',
  generate: 'Users.permissionActions.generate',
  start: 'Users.permissionActions.start',
  record_services: 'Users.permissionActions.recordServices',
  complete: 'Users.permissionActions.complete',
  correct: 'Users.permissionActions.correct',
  finalize: 'Users.permissionActions.finalize',
  amend: 'Users.permissionActions.amend',
  review: 'Users.permissionActions.review',
  prepare: 'Users.permissionActions.prepare',
  capture: 'Users.permissionActions.capture',
  revoke: 'Users.permissionActions.revoke',
  assign_facility: 'Users.permissionActions.assignFacility',
  assign_team: 'Users.permissionActions.assignTeam',
  link_user: 'Users.permissionActions.linkUser',
  manage_qualifications: 'Users.permissionActions.manageQualifications',
  manage_skills: 'Users.permissionActions.manageSkills',
  manage_employment: 'Users.permissionActions.manageEmployment',
} as const;

export function permissionLabelKeys(permission: string): {
  resource:
    | (typeof permissionResources)[keyof typeof permissionResources]
    | 'Users.permissionResources.unknown';
  action:
    | (typeof permissionActions)[keyof typeof permissionActions]
    | 'Users.permissionActions.unknown';
} {
  const separator = permission.lastIndexOf('.');
  const resource = separator < 0 ? permission : permission.slice(0, separator);
  const action = separator < 0 ? '' : permission.slice(separator + 1);
  return {
    resource:
      resource in permissionResources
        ? permissionResources[resource as keyof typeof permissionResources]
        : 'Users.permissionResources.unknown',
    action:
      action in permissionActions
        ? permissionActions[action as keyof typeof permissionActions]
        : 'Users.permissionActions.unknown',
  };
}
