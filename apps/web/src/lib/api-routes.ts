const encodePathSegment = (value: string) => {
  if (value === '.' || value === '..')
    throw new Error('Dot segments are not valid API path values.');
  return encodeURIComponent(value).replace(/\./g, '%2E');
};

const careApiRoutes = {
  employees: () => '/api/v1/employees',
  facilitiesSearch: () => '/api/v1/facilities/search',
  organizationsSearch: () => '/api/v1/organizations/search',
  structureOrganizationsSearch: () => '/api/v1/organizations/search',
  structureFacilitiesSearch: () => '/api/v1/facilities/search',
  structureTeamsSearch: () => '/api/v1/teams/search',
  clients: () => '/api/v1/clients',
  clientContactsSearch: (clientId: string) =>
    `/api/v1/clients/${encodePathSegment(clientId)}/contacts/search`,
  employeeUsersSearch: (employeeId: string) =>
    `/api/v1/employees/${encodePathSegment(employeeId)}/linkable-users/search`,
  qualificationsSearch: () => '/api/v1/qualifications/search',
  skillsSearch: () => '/api/v1/skills/search',
  services: () => '/api/v1/services',
  servicePrices: (serviceId: string) => `/api/v1/services/${encodePathSegment(serviceId)}/prices`,
  teamsSearch: () => '/api/v1/teams/search',
  payers: () => '/api/v1/billing/payers',
  receivables: () => '/api/v1/billing/receivables',
  documentTemplateLogo: () => '/api/v1/document-templates/logo',
  documentPreview: () => '/api/v1/documents/preview',
  documentGenerate: () => '/api/v1/documents/generate',
  invoiceExport: () => '/api/v1/billing/exports/invoices',
  invoiceLinesExport: () => '/api/v1/billing/exports/invoice-lines',
  receivablesExport: () => '/api/v1/billing/exports/receivables',
  benefitAllocationsExport: () => '/api/v1/benefits/exports/allocations',
  documentDownload: (id: string) => `/api/v1/documents/${encodePathSegment(id)}/download`,
  claimDocument: (id: string, documentId: string) =>
    `/api/v1/billing/claims/${encodePathSegment(id)}/documents/${encodePathSegment(documentId)}`,
  invoicePdf: (id: string) => `/api/v1/billing/invoices/${encodePathSegment(id)}/pdf`,
  invoiceCorrectionPdf: (id: string, correctionId: string) =>
    `/api/v1/billing/invoices/${encodePathSegment(id)}/corrections/${encodePathSegment(correctionId)}/pdf`,
} as const;

type CareApiRoutes = typeof careApiRoutes;
type CareApiRoute = keyof CareApiRoutes;
type CareApiRequestFor<K extends CareApiRoute> =
  Parameters<CareApiRoutes[K]> extends []
    ? { route: K; query?: URLSearchParams; init?: RequestInit }
    : {
        route: K;
        pathParams: Parameters<CareApiRoutes[K]>;
        query?: URLSearchParams;
        init?: RequestInit;
      };

export type CareApiRequest = { [K in CareApiRoute]: CareApiRequestFor<K> }[CareApiRoute];

export function buildCareApiUrl(request: CareApiRequest, baseUrl: string): URL {
  const routeBuilder = careApiRoutes[request.route] as
    | ((...pathParams: string[]) => string)
    | undefined;
  if (!routeBuilder) throw new Error('Unknown Care API route.');
  const pathParams = 'pathParams' in request ? request.pathParams : [];
  const path = routeBuilder(...pathParams);
  const target = new URL(baseUrl);
  const origin = target.origin;
  target.pathname = path;
  if (target.origin !== origin || !target.pathname.startsWith('/api/v1/')) {
    throw new Error('Care API route must remain within the configured API origin.');
  }
  target.search = request.query?.toString() ? `?${request.query.toString()}` : '';
  target.hash = '';
  return target;
}
