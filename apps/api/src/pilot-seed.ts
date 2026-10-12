// oxlint-disable no-await-in-loop -- domain setup is ordered so each idempotent lookup observes its preceding write
// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before validating pilot database configuration
import '@care/config/load-env';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import { asUUID } from '@care/contracts';
import { DrizzleAuditWriter } from '@care/audit';
import {
  clientBenefitEntitlements,
  createBenefitsApplicationService,
  serviceAllocations,
} from '@care/benefits';
import {
  createBillingApplicationService,
  createBillingClaimsApplicationService,
} from '@care/billing';
import {
  claims,
  invoiceLines,
  invoices,
  payerArrangements,
  payerBillingProfiles,
  payers,
  paymentAllocations,
  payments,
} from '@care/billing';
import { createCareDocumentationApplicationService } from '@care/care-documentation';
import { createDatabase, createUnitOfWork } from '@care/database';
import {
  createClientApplicationService,
  createClientMasterDataApplicationService,
} from '@care/clients';
import { createDocumentsApplicationService } from '@care/documents';
import { EmployeeApplicationService } from '@care/employees';
import { identitySchema, seedSystemRoles } from '@care/identity';
import { OrganizationApplicationService, tenants } from '@care/organizations';
import { createOperationsApplicationService } from '@care/operations';
import { DrizzleOutboxRepository } from '@care/platform';
import { PERMISSIONS } from '@care/permissions';
import {
  createSchedulingApplicationService,
  UnavailableRouteProvider,
  visitSubstitutions,
} from '@care/scheduling';
import { createServiceEvidenceApplicationService } from '@care/service-evidence';
import { createServiceAgreementApplicationService } from '@care/service-agreements';
import { createS3ObjectStorage } from '@care/storage';
import { createServiceApplicationService, ServicePriceApplicationService } from '@care/services';
import { createVisitExecutionApplicationService } from '@care/visit-execution';
import { loadApiConfig, loadMigrationConfig, loadStorageConfig } from '@care/config';
import { databaseSchema } from '@app/api/database/schema';

const PILOT_SLUG = 'muster-betreuungsdienst-nrw';
const PILOT_NAME = 'Muster Betreuungsdienst NRW';
const PILOT_ORGANIZATION = 'Muster Betreuungsdienst NRW';
const PILOT_NAMESPACE = '9a8d8168-84f7-4cce-aef1-3f2fd6d581b6';
const PILOT_TENANT_ID = uuidv5(PILOT_SLUG, PILOT_NAMESPACE);
const PILOT_ACTOR_ID = uuidv5('synthetic-pilot-seed-actor', PILOT_NAMESPACE);
const PILOT_CAREGIVER_ACTOR_ID = uuidv5('synthetic-pilot-caregiver-actor', PILOT_NAMESPACE);
const PILOT_CAREGIVER_MEMBERSHIP_ID = uuidv5(
  'synthetic-pilot-caregiver-membership',
  PILOT_NAMESPACE,
);
const PILOT_REFERENCE_DATE = process.env.PILOT_REFERENCE_DATE ?? '2026-10-12';
const TIMEZONE = 'Europe/Berlin';
const SYNTHETIC_USER_AGENT = 'synthetic-pilot-seed';
const SYNTHETIC_PAYER_NAME = 'Fiktiver Kostenträger – nur lokaler Pilot';
const SYNTHETIC_PAYER_REFERENCE = 'SYNTHETIC-PILOT-CLAIM-001';
const SYNTHETIC_CLIENT_PAYMENT_REFERENCE = 'SYNTHETIC-PILOT-CLIENT-PAYMENT-001';
const SYNTHETIC_PAYER_PAYMENT_REFERENCE = 'SYNTHETIC-PILOT-PAYER-PAYMENT-001';
const SYNTHETIC_EXTERNAL_SOURCE_LABEL = 'Synthetische externe Finanzierung – noch ungeprüft';

if (process.env.NODE_ENV !== 'development') {
  throw new Error('pilot:seed only runs with NODE_ENV=development; no data was changed');
}
if (!isIsoDate(PILOT_REFERENCE_DATE)) {
  throw new Error('PILOT_REFERENCE_DATE must be a valid YYYY-MM-DD date; no data was changed');
}

const apiConfig = loadApiConfig();
const migrationConfig = loadMigrationConfig();
const storageConfig = loadStorageConfig();
assertLocalDevelopmentDatabase(apiConfig.DATABASE_URL, 'DATABASE_URL', 'care_app');
assertLocalDevelopmentDatabase(
  migrationConfig.MIGRATION_DATABASE_URL,
  'MIGRATION_DATABASE_URL',
  'care_owner',
);

const audit = new DrizzleAuditWriter();
const migrationDatabase = createDatabase(migrationConfig.MIGRATION_DATABASE_URL, databaseSchema);
const applicationDatabase = createDatabase(apiConfig.DATABASE_URL, databaseSchema);
const unitOfWork = createUnitOfWork(applicationDatabase.db);
const outbox = new DrizzleOutboxRepository(applicationDatabase.db);
const objectStorage = createS3ObjectStorage({
  endpoint: storageConfig.S3_ENDPOINT,
  region: storageConfig.S3_REGION,
  bucket: storageConfig.S3_BUCKET,
  accessKey: storageConfig.S3_ACCESS_KEY,
  secretKey: storageConfig.S3_SECRET_KEY,
  forcePathStyle: storageConfig.S3_FORCE_PATH_STYLE,
});
const clientService = createClientApplicationService(unitOfWork, audit, outbox);
const clientMasterData = createClientMasterDataApplicationService(unitOfWork, audit, outbox);
const benefits = createBenefitsApplicationService(unitOfWork, audit, outbox);
const employeeService = new EmployeeApplicationService(unitOfWork, audit, outbox);
const organizationService = new OrganizationApplicationService(unitOfWork, audit, outbox);
const serviceService = createServiceApplicationService(unitOfWork, audit, outbox);
const servicePrices = new ServicePriceApplicationService(unitOfWork, audit, outbox);
const agreementService = createServiceAgreementApplicationService(
  unitOfWork,
  clientService,
  organizationService,
  serviceService,
  audit,
  outbox,
);
const scheduling = createSchedulingApplicationService(
  unitOfWork,
  clientService,
  organizationService,
  employeeService,
  serviceService,
  agreementService,
  audit,
  outbox,
  28,
  undefined,
  new UnavailableRouteProvider(),
);
const visitExecution = createVisitExecutionApplicationService(unitOfWork, audit, outbox);
const careDocumentation = createCareDocumentationApplicationService(unitOfWork, audit, outbox);
const serviceEvidence = createServiceEvidenceApplicationService(
  unitOfWork,
  audit,
  outbox,
  objectStorage,
);
const documents = createDocumentsApplicationService(unitOfWork, audit, outbox, objectStorage);
const billing = createBillingApplicationService(
  unitOfWork,
  audit,
  outbox,
  objectStorage,
  servicePrices,
  benefits,
  serviceEvidence,
  documents,
);
const billingClaims = createBillingClaimsApplicationService(
  unitOfWork,
  audit,
  outbox,
  serviceEvidence,
  documents,
  objectStorage,
);
const operations = createOperationsApplicationService(unitOfWork, audit, outbox, {
  scheduling,
  execution: visitExecution,
  documentation: careDocumentation,
  evidence: serviceEvidence,
  benefits,
  billing,
  claims: billingClaims,
});

type PilotTeam = Awaited<ReturnType<OrganizationApplicationService['createTeam']>>;
type PilotEmployee = { id: string };
type PilotClient = Awaited<ReturnType<typeof clientService.create>>;
type PilotVisit = Awaited<ReturnType<typeof scheduling.search>>['items'][number];

const contextFor = (organizationId?: string) => ({
  requestId: asUUID(uuidv7()),
  correlationId: asUUID(uuidv7()),
  userId: asUUID(PILOT_ACTOR_ID),
  tenantId: asUUID(PILOT_TENANT_ID),
  ...(organizationId ? { organizationId: asUUID(organizationId) } : {}),
});
const auditContext = { userAgent: SYNTHETIC_USER_AGENT };
const principal = {
  userId: PILOT_ACTOR_ID,
  tenantId: PILOT_TENANT_ID,
  grants: PERMISSIONS.map((permission) => ({
    permission,
    scopeType: 'tenant' as const,
    scopeId: PILOT_TENANT_ID,
  })),
};

async function ensurePilotTenant(): Promise<void> {
  const bySlug = await migrationDatabase.db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, PILOT_SLUG))
    .limit(1);
  const byId = await migrationDatabase.db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, PILOT_TENANT_ID))
    .limit(1);
  if (bySlug[0] && bySlug[0].id !== PILOT_TENANT_ID) {
    throw new Error(
      `Pilot slug ${PILOT_SLUG} is already owned by another tenant (${bySlug[0].id}); no data was changed.`,
    );
  }
  if (byId[0] && byId[0].slug !== PILOT_SLUG) {
    throw new Error(
      `Stable pilot tenant ID is already used by slug ${byId[0].slug}; no data was changed.`,
    );
  }
  if (bySlug[0]) return;

  await migrationDatabase.db.insert(tenants).values({
    id: PILOT_TENANT_ID,
    name: PILOT_NAME,
    slug: PILOT_SLUG,
    active: true,
  });
}

async function ensureOrganization() {
  const rows = await organizationService.listOrganizations(principal);
  const matches = rows.filter((item) => item.code === 'MB-NRW');
  if (matches.length > 1) throw new Error('Multiple pilot organizations use code MB-NRW');
  if (matches[0]) {
    if (matches[0].name !== PILOT_ORGANIZATION || matches[0].status !== 'active') {
      throw new Error('Pilot organization MB-NRW differs from the expected active record');
    }
    return matches[0];
  }
  return organizationService.createOrganization(
    principal,
    {
      name: PILOT_ORGANIZATION,
      legalName: 'Muster Betreuungsdienst NRW (synthetisch)',
      code: 'MB-NRW',
      address: 'Fiktivstraße 1, 00000 Musterstadt, Deutschland',
      phone: '+49 000 0000000',
      email: 'buero@muster-betreuungsdienst.invalid',
      timezone: TIMEZONE,
    },
    contextFor(),
    auditContext,
  );
}

async function ensureFacility(organizationId: string) {
  const rows = await organizationService.listFacilities(principal, { organizationId });
  const matches = rows.filter((item) => item.code === 'MB-NRW-01');
  if (matches.length > 1) throw new Error('Multiple pilot facilities use code MB-NRW-01');
  if (matches[0]) {
    if (matches[0].name !== 'Betriebsstelle Musterstadt' || matches[0].status !== 'active') {
      throw new Error('Pilot facility MB-NRW-01 differs from the expected active record');
    }
    return matches[0];
  }
  return organizationService.createFacility(
    principal,
    {
      organizationId,
      name: 'Betriebsstelle Musterstadt',
      code: 'MB-NRW-01',
      address: 'Fiktivstraße 1, 00000 Musterstadt, Deutschland',
      phone: '+49 000 0000000',
      email: 'buero@muster-betreuungsdienst.invalid',
      timezone: TIMEZONE,
    },
    contextFor(organizationId),
    auditContext,
  );
}

async function ensureTeams(organizationId: string, facilityId: string) {
  const definitions = ['Team Alltag', 'Team Entlastung'];
  const rows = await organizationService.listTeams(principal, { organizationId, facilityId });
  const output: PilotTeam[] = [];
  for (const name of definitions) {
    const matches = rows.filter((item) => item.name === name);
    if (matches.length > 1) throw new Error(`Multiple pilot teams named ${name}`);
    if (matches[0]) {
      if (matches[0].status !== 'active') throw new Error(`Pilot team ${name} is archived`);
      output.push(matches[0]);
      continue;
    }
    output.push(
      await organizationService.createTeam(
        principal,
        { organizationId, facilityId, name },
        contextFor(organizationId),
        auditContext,
      ),
    );
  }
  return output;
}

const EMPLOYEE_DEFINITIONS = [
  { kind: 'office', firstName: 'Fiktiv', lastName: 'Bürokoordination 01', hours: 38.5 },
  { kind: 'office', firstName: 'Fiktiv', lastName: 'Disposition 02', hours: 30 },
  { kind: 'caregiver', firstName: 'Fiktiv', lastName: 'Betreuungskraft 01', hours: 38.5 },
  { kind: 'caregiver', firstName: 'Fiktiv', lastName: 'Betreuungskraft 02', hours: 30 },
  { kind: 'caregiver', firstName: 'Fiktiv', lastName: 'Betreuungskraft 03', hours: 25 },
  { kind: 'caregiver', firstName: 'Fiktiv', lastName: 'Betreuungskraft 04', hours: 20 },
  { kind: 'caregiver', firstName: 'Fiktiv', lastName: 'Betreuungskraft 05', hours: 15 },
  { kind: 'caregiver', firstName: 'Fiktiv', lastName: 'Betreuungskraft 06', hours: 20 },
] as const;

async function ensureEmployees(organizationId: string, facilityId: string, teams: PilotTeam[]) {
  const caregivers: PilotEmployee[] = [];
  for (const [index, definition] of EMPLOYEE_DEFINITIONS.entries()) {
    const personnelNumber = `PILOT-${definition.kind === 'office' ? 'OFF' : 'BET'}-${String(index + 1).padStart(2, '0')}`;
    const matches = await employeeService.search(principal, {
      text: personnelNumber,
      organizationId,
      pageSize: 100,
    });
    if (matches.total > 100)
      throw new Error('Pilot employee lookup exceeded the expected result size');
    if (matches.items.length > 1)
      throw new Error(`Duplicate synthetic employee ${personnelNumber}`);

    let employee = matches.items[0];
    if (
      employee &&
      (employee.firstName !== definition.firstName || employee.lastName !== definition.lastName)
    ) {
      throw new Error(`Employee identifier ${personnelNumber} is already used by another record`);
    }
    if (!employee) {
      employee = await employeeService.create(
        principal,
        {
          organizationId,
          firstName: definition.firstName,
          lastName: definition.lastName,
          preferredName: null,
          email: `${personnelNumber.toLowerCase()}@muster-betreuungsdienst.invalid`,
          phone: '+49 000 0000000',
          personnelNumber,
          employmentType: definition.kind === 'office' ? 'office' : 'part_time',
          startDate: '2025-01-01',
          endDate: null,
          weeklyHours: definition.hours,
        },
        contextFor(organizationId),
        auditContext,
      );
    }
    if (employee.status !== 'active') {
      employee = await employeeService.activate(
        principal,
        employee.id,
        contextFor(organizationId),
        auditContext,
      );
    }
    const detail = await employeeService.get(principal, employee.id);
    if (
      !detail.facilityAssignments.some(
        (assignment) => assignment.facilityId === facilityId && assignment.status === 'active',
      )
    ) {
      await employeeService.assignFacility(
        principal,
        employee.id,
        facilityId,
        { isPrimary: true },
        contextFor(organizationId),
        auditContext,
      );
    }
    if (definition.kind === 'caregiver') {
      const team = teams[(index - 2) % teams.length]!;
      const refreshed = await employeeService.get(principal, employee.id);
      if (
        !refreshed.teamMemberships.some(
          (membership) => membership.teamId === team.id && membership.status === 'active',
        )
      ) {
        await employeeService.assignTeam(
          principal,
          employee.id,
          team.id,
          { role: 'Betreuungskraft' },
          contextFor(organizationId),
          auditContext,
        );
      }
      const current = await scheduling.getEmployeeAvailability(principal, employee.id);
      const desiredWindows = [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startsAt: '08:00',
        endsAt: '18:30',
      }));
      if (!sameWindows(current.availability?.windows ?? [], desiredWindows)) {
        await scheduling.saveEmployeeAvailability(
          principal,
          {
            employeeId: employee.id,
            expectedVersion: current.version,
            timezone: TIMEZONE,
            maxDailyMinutes: 480,
            travelBufferMinutes: 15,
            windows: desiredWindows,
          },
          contextFor(organizationId),
          auditContext,
        );
      }
      caregivers.push(employee);
    }
  }
  return caregivers;
}

const SERVICE_DEFINITIONS = [
  {
    code: 'PILOT_ALLTAG',
    name: 'Alltagsbegleitung',
    priceCents: 3200,
    category: 'recognized_support' as const,
  },
  {
    code: 'PILOT_HAUSWIRTSCHAFT',
    name: 'Hauswirtschaftliche Unterstützung',
    priceCents: 3400,
    category: 'recognized_support' as const,
  },
  {
    code: 'PILOT_EINKAUF',
    name: 'Einkaufsbegleitung',
    priceCents: 3200,
    category: 'recognized_support' as const,
  },
  {
    code: 'PILOT_TERMINE',
    name: 'Begleitung zu Terminen',
    priceCents: 3800,
    category: 'other' as const,
  },
  {
    code: 'PILOT_FREIZEIT',
    name: 'Freizeitbegleitung',
    priceCents: 3000,
    category: 'other' as const,
  },
  {
    code: 'PILOT_ANGEHOERIGE',
    name: 'Entlastung pflegender Angehöriger',
    priceCents: 3600,
    category: 'recognized_support' as const,
  },
] as const;

async function ensureServices(organizationId: string, facilityId: string) {
  const existingCategories = await serviceService.listCategories(principal, true);
  const categoryMatches = existingCategories.filter((item) => item.code === 'PILOT_BETREUUNG');
  if (categoryMatches.length > 1) throw new Error('Duplicate pilot service category code');
  const category =
    categoryMatches[0] ??
    (await serviceService.createCategory(
      principal,
      {
        name: 'Betreuung und Entlastung',
        code: 'PILOT_BETREUUNG',
        description: 'Synthetischer lokaler Pilotkatalog',
        sortOrder: 10,
      },
      contextFor(organizationId),
      auditContext,
    ));
  if (category.status !== 'active') throw new Error('Pilot service category is archived');

  const result: Array<Awaited<ReturnType<typeof serviceService.create>> & { ordinal: number }> = [];
  for (const [index, definition] of SERVICE_DEFINITIONS.entries()) {
    const found = await serviceService.search(principal, {
      text: definition.code,
      validAt: PILOT_REFERENCE_DATE,
      pageSize: 100,
    });
    const matches = found.items.filter((item) => item.service.code === definition.code);
    if (matches.length > 1) throw new Error(`Duplicate pilot service ${definition.code}`);
    let service = matches[0]?.service;
    if (
      service &&
      (service.name !== definition.name ||
        service.unit !== 'hour' ||
        service.categoryId !== category.id ||
        service.benefitCategory !== definition.category)
    ) {
      throw new Error(
        `Existing pilot service ${definition.code} differs from its synthetic definition`,
      );
    }
    if (!service) {
      service = await serviceService.create(
        principal,
        {
          code: definition.code,
          name: definition.name,
          description: 'Synthetischer Pilotservice; keine automatische Kostenzusage',
          categoryId: category.id,
          unit: 'hour',
          benefitCategory: definition.category,
          defaultDurationMinutes: 60,
          validFrom: '2026-01-01',
        },
        contextFor(organizationId),
        auditContext,
      );
    }
    const availability = await serviceService.setAvailability(
      principal,
      service.id,
      [{ organizationId, facilityId, active: true }],
      contextFor(organizationId),
      auditContext,
    );
    if (
      !availability.some(
        (item) =>
          item.active && item.organizationId === organizationId && item.facilityId === facilityId,
      )
    ) {
      throw new Error(`Pilot service ${definition.code} is not available at its facility`);
    }

    const effectivePrices = await servicePrices.list(principal, service.id, {
      organizationId,
      facilityId,
      validAt: PILOT_REFERENCE_DATE,
    });
    if (effectivePrices.length === 0) {
      await servicePrices.create(
        principal,
        {
          serviceId: service.id,
          organizationId,
          facilityId,
          priceCents: definition.priceCents,
          pricingUnit: 'hour',
          validFrom: '2026-01-01',
        },
        contextFor(organizationId),
        auditContext,
      );
    } else if (
      effectivePrices[0]!.priceCents !== definition.priceCents ||
      effectivePrices[0]!.pricingUnit !== 'hour'
    ) {
      throw new Error(
        `Existing price for ${definition.code} differs from the synthetic price; review it before reseeding`,
      );
    }
    result.push({ ...service, ordinal: index });
  }
  return result;
}

const CLIENT_COUNT = 20;
const ACTIVE_CLIENT_COUNT = 15;

async function ensureClients(organizationId: string, facilityId: string) {
  const result: Array<PilotClient & { ordinal: number }> = [];
  for (let index = 0; index < CLIENT_COUNT; index += 1) {
    const suffix = String(index + 1).padStart(2, '0');
    const lastName = `Musterkunde ${suffix}`;
    const matches = await clientService.search(principal, {
      text: lastName,
      organizationId,
      facilityId,
      pageSize: 100,
    });
    const existing = matches.items
      .map((item) => item.client)
      .filter((item) => item.lastName === lastName);
    if (existing.length > 1) throw new Error(`Duplicate synthetic client ${lastName}`);
    let client = existing[0];
    if (
      client &&
      (client.firstName !== 'Fiktiv' ||
        client.organizationId !== organizationId ||
        client.primaryFacilityId !== facilityId)
    ) {
      throw new Error(`Synthetic client identifier ${lastName} conflicts with an existing record`);
    }
    if (!client) {
      client = await clientService.create(
        principal,
        {
          firstName: 'Fiktiv',
          lastName,
          preferredName: null,
          dateOfBirth: `194${index % 10}-04-15`,
          gender: index % 2 === 0 ? 'female' : 'male',
          salutation: index % 2 === 0 ? 'ms' : 'mr',
          email: `kunde-${suffix}@muster-betreuungsdienst.invalid`,
          phone: '+49 000 0000000',
          organizationId,
          primaryFacilityId: facilityId,
          primaryAddress: {
            addressType: 'home',
            street: 'Fiktivstraße',
            houseNumber: String(index + 1),
            postalCode: '00000',
            city: 'Musterstadt',
            countryCode: 'DE',
            isPrimary: true,
          },
        },
        contextFor(organizationId),
        auditContext,
      );
    }
    const grade = clientScenarioGrade(index);
    if (grade !== null) {
      const insurances = await clientMasterData.listInsurances(principal, client.id);
      const insurance = insurances.find(
        (item) => item.insuranceNumber === `SYNTHETIC-PFLEGE-${suffix}`,
      );
      if (!insurance) {
        await clientMasterData.addInsurance(
          principal,
          client.id,
          {
            insuranceType: 'pflegeversicherung',
            insurerName: 'Fiktive Musterkasse NRW',
            insuranceNumber: `SYNTHETIC-PFLEGE-${suffix}`,
            memberNumber: `SYNTHETIC-MITGLIED-${suffix}`,
            validFrom: '2025-01-01',
            isPrimary: true,
            notes: 'Unmistakably fictional pilot reference; not a payer identifier.',
          },
          contextFor(organizationId),
          auditContext,
        );
      }
      const grades = await clientMasterData.listPflegegrade(principal, client.id);
      const expectedFrom = index === 6 ? '2025-01-01' : '2025-01-01';
      const existingGrade = grades.find((item) => item.validFrom === expectedFrom);
      if (!existingGrade) {
        await clientMasterData.addPflegegrad(
          principal,
          client.id,
          {
            grade,
            validFrom: expectedFrom,
            status: 'confirmed',
            insurerReference: `SYNTHETIC-BESCHEID-${suffix}`,
          },
          contextFor(organizationId),
          auditContext,
        );
      } else if (existingGrade.grade !== grade) {
        throw new Error(`Synthetic Pflegegrad record for ${lastName} differs from its scenario`);
      }
    }
    if (index === 0 || index === 1) {
      const contacts = await clientMasterData.listContacts(principal, client.id);
      const contactName = index === 0 ? 'Fiktiv Vertretung 01' : 'Fiktiv Kontakt 02';
      const contactExists = contacts.some(
        (item) => `${item.firstName} ${item.lastName}` === contactName,
      );
      if (!contactExists) {
        await clientMasterData.addContact(
          principal,
          client.id,
          index === 0
            ? {
                firstName: 'Fiktiv',
                lastName: 'Vertretung 01',
                relationshipType: 'legal_representative',
                representationType: 'authorized_representative',
                representationValidFrom: '2025-01-01',
                representationReference: 'SYNTHETIC-VOLLMACHT-01',
                roles: ['legal_representative', 'primary_contact'],
                email: 'vertretung-01@muster-betreuungsdienst.invalid',
              }
            : {
                firstName: 'Fiktiv',
                lastName: 'Kontakt 02',
                relationshipType: 'daughter',
                roles: ['authorized_contact'],
                notes: 'Synthetic scenario: contact authority awaits document review.',
              },
          contextFor(organizationId),
          auditContext,
        );
      }
    }
    if (index < 15 && client.status === 'pending') {
      client = await clientService.activate(
        principal,
        client.id,
        contextFor(organizationId),
        auditContext,
      );
    }
    if (index >= 15 && client.status === 'active') {
      throw new Error(`${lastName} should remain pending in the onboarding scenario`);
    }
    result.push({ ...client, ordinal: index });
  }
  return result;
}

function clientScenarioGrade(index: number): number | null {
  if (index < 5) return index + 1;
  if (index === 6) return 3;
  if (index === 7) return 2;
  if (index === 9) return 4;
  if (index === 10) return 5;
  if (index === 12) return 2;
  return null;
}

async function ensureAgreements(
  clients: Array<PilotClient & { ordinal: number }>,
  services: Array<Awaited<ReturnType<typeof serviceService.create>> & { ordinal: number }>,
) {
  const output: Array<Awaited<ReturnType<typeof agreementService.create>> & { ordinal: number }> =
    [];
  for (const client of clients) {
    const suffix = String(client.ordinal + 1).padStart(2, '0');
    const existing = await agreementService.listForClient(principal, client.id, { pageSize: 100 });
    const matches = existing.items
      .map((item) => item.agreement)
      .filter((item) => item.reference === `PILOT-AG-${suffix}`);
    if (matches.length > 1) throw new Error(`Duplicate pilot agreement PILOT-AG-${suffix}`);
    let agreement = matches[0];
    if (!agreement) {
      agreement = await agreementService.create(
        principal,
        client.id,
        {
          validFrom: '2026-01-01',
          reference: `PILOT-AG-${suffix}`,
          description: 'Synthetische Servicevereinbarung für den lokalen Pilotbetrieb.',
        },
        contextFor(client.organizationId!),
        auditContext,
      );
    }
    const service = services[client.ordinal % services.length]!;
    const currentLines = await agreementService.listServices(principal, agreement.id);
    const lineMatches = currentLines.filter((line) => line.serviceDefinitionId === service.id);
    if (lineMatches.length === 0 && currentLines.length === 0) {
      await agreementService.addService(
        principal,
        agreement.id,
        {
          serviceDefinitionId: service.id,
          quantity: '1.000',
          scheduleRule: {
            type: 'weekly',
            weekdays: recurringWeekdays(client.ordinal),
          },
          preferredTimeStart: timeSlot(client.ordinal),
          preferredTimeEnd: timeSlotEnd(client.ordinal),
        },
        contextFor(client.organizationId!),
        auditContext,
      );
    } else if (lineMatches.length !== 1 || currentLines.length !== 1) {
      throw new Error(`Pilot agreement ${agreement.reference} has unexpected service lines`);
    }
    if (client.ordinal < 15 && agreement.status === 'draft') {
      agreement = await agreementService.activate(
        principal,
        agreement.id,
        contextFor(client.organizationId!),
        auditContext,
      );
    }
    if (client.ordinal >= 15 && agreement.status === 'active') {
      throw new Error(`Pilot agreement ${agreement.reference} should remain under review`);
    }
    output.push({ ...agreement, ordinal: client.ordinal });
  }
  return output;
}

async function ensureFundingSources(clients: Array<PilotClient & { ordinal: number }>) {
  const definitions = [
    {
      client: clients[0]!,
      sourceType: 'statutory_long_term_care_insurance' as const,
      label: 'Synthetische Pflegekasse NRW – Anspruch und Guthaben ungeprüft',
    },
    {
      client: clients[1]!,
      sourceType: 'self_pay' as const,
      label: 'Synthetische Selbstzahlung – keine Zahlung gebucht',
    },
    {
      client: clients[5]!,
      sourceType: 'other' as const,
      label: SYNTHETIC_EXTERNAL_SOURCE_LABEL,
    },
  ];
  for (const definition of definitions) {
    const insurance =
      definition.sourceType === 'statutory_long_term_care_insurance'
        ? (await clientMasterData.listInsurances(principal, definition.client.id)).find(
            (item) => item.insuranceType === 'pflegeversicherung',
          )
        : undefined;
    if (definition.sourceType === 'statutory_long_term_care_insurance' && !insurance) {
      throw new Error('Synthetic Pflegeversicherung record is missing for pilot Client 01');
    }
    const sources = await benefits.listFundingSources(principal, definition.client.id);
    const matches = sources.filter((source) => source.label === definition.label);
    if (matches.length > 1) throw new Error(`Duplicate pilot funding source: ${definition.label}`);
    if (matches[0]) {
      if (
        matches[0].sourceType !== definition.sourceType ||
        matches[0].clientInsuranceId !== (insurance?.id ?? null)
      ) {
        throw new Error(`Pilot funding source differs from its scenario: ${definition.label}`);
      }
      continue;
    }
    await benefits.createFundingSource(
      principal,
      definition.client.id,
      {
        sourceType: definition.sourceType,
        ...(insurance ? { clientInsuranceId: insurance.id } : {}),
        label: definition.label,
      },
      contextFor(definition.client.organizationId!),
      auditContext,
    );
  }
  return definitions.length;
}

async function ensureBenefitScenario(clients: Array<PilotClient & { ordinal: number }>) {
  const client = clients[0]!;
  const sourceLabel = 'Synthetische Pflegekasse NRW – Anspruch und Guthaben ungeprüft';
  const source = (await benefits.listFundingSources(principal, client.id)).find(
    (item) => item.label === sourceLabel,
  );
  if (!source) throw new Error('Synthetic statutory funding source is missing for pilot Client 01');

  const existingEntitlements = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    (transaction) =>
      transaction
        .select()
        .from(clientBenefitEntitlements)
        .where(
          and(
            eq(clientBenefitEntitlements.tenantId, PILOT_TENANT_ID),
            eq(clientBenefitEntitlements.clientId, client.id),
            eq(clientBenefitEntitlements.fundingSourceId, source.id),
            eq(clientBenefitEntitlements.benefitType, 'entlastungsbetrag_45b'),
            eq(clientBenefitEntitlements.validFrom, PILOT_REFERENCE_DATE),
          ),
        )
        .limit(2),
  );
  if (existingEntitlements.length > 1) {
    throw new Error('Duplicate synthetic §45b entitlement for pilot Client 01');
  }
  const existingEntitlement = existingEntitlements[0];
  let entitlementId = existingEntitlement?.id;
  if (existingEntitlement) {
    if (
      existingEntitlement.status !== 'provisional' ||
      existingEntitlement.source !== 'provider_reported' ||
      existingEntitlement.calculationMode !== 'rule_based'
    ) {
      throw new Error('Synthetic §45b entitlement differs from its unconfirmed scenario');
    }
  } else {
    const created = await benefits.createEntitlement(
      principal,
      client.id,
      {
        benefitType: 'entlastungsbetrag_45b',
        fundingSourceId: source.id,
        validFrom: PILOT_REFERENCE_DATE,
        status: 'provisional',
        calculationMode: 'rule_based',
        source: 'provider_reported',
      },
      contextFor(client.organizationId!),
      auditContext,
    );
    entitlementId = created.id;
  }
  if (!entitlementId) throw new Error('Synthetic §45b entitlement could not be resolved');

  await benefits.recordAdjustment(
    principal,
    client.id,
    {
      idempotencyKey: uuidv5('pilot-client-01-external-consumption', PILOT_NAMESPACE),
      fundingSourceId: source.id,
      entitlementId,
      benefitType: 'entlastungsbetrag_45b',
      amountCents: -2_500,
      effectiveDate: PILOT_REFERENCE_DATE,
      adjustmentType: 'external_consumption',
      sourceType: 'synthetic_external_statement',
      reference: 'Synthetic external consumption; not reconciled with a payer statement.',
      verificationStatus: 'provider_reported',
    },
    contextFor(client.organizationId!),
    auditContext,
  );
  const budget = await benefits.getBudget(principal, client.id, PILOT_REFERENCE_DATE);
  const externalConsumption = budget.history.find(
    (entry) =>
      entry.entryType === 'external_consumption_recorded' &&
      entry.amountCents === -2_500 &&
      entry.verificationStatus === 'provider_reported' &&
      entry.reference === 'Synthetic external consumption; not reconciled with a payer statement.',
  );
  const entitlementBudget = budget.entitlementBudgets.find(
    (item) => item.entitlementId === entitlementId,
  );
  if (
    !externalConsumption ||
    entitlementBudget?.entitlementStatus !== 'provisional' ||
    entitlementBudget.confirmedRemainingCents !== 0 ||
    entitlementBudget.estimatedRemainingCents === null
  ) {
    throw new Error('Synthetic benefit scenario failed its ledger consistency check');
  }
  return 1;
}

async function ensureVisits(
  agreements: Array<Awaited<ReturnType<typeof agreementService.create>> & { ordinal: number }>,
  clients: Array<PilotClient & { ordinal: number }>,
  services: Array<Awaited<ReturnType<typeof serviceService.create>> & { ordinal: number }>,
  caregivers: PilotEmployee[],
) {
  const from = PILOT_REFERENCE_DATE;
  const until = addDays(from, 27);
  const totals = { generated: 0, alreadyExisting: 0, requiresManualPlacement: 0 };
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const caregiverForClient = new Map(
    clients
      .filter((client) => client.ordinal < 15)
      .map((client) => [client.id, caregivers[client.ordinal % caregivers.length]!]),
  );
  for (const agreement of agreements.filter((item) => item.status === 'active')) {
    const generated = await scheduling.generateAgreementVisits(
      principal,
      agreement.id,
      { from, until },
      contextFor(agreement.organizationId),
      auditContext,
    );
    totals.generated += generated.generated;
    totals.alreadyExisting += generated.alreadyExisting;
    totals.requiresManualPlacement += generated.requiresManualPlacement;
  }

  const rows: PilotVisit[] = [];
  for (let page = 1; ; page += 1) {
    const result = await scheduling.search(principal, {
      from: new Date(`${addDays(from, -1)}T00:00:00.000Z`),
      until: new Date(`${addDays(until, 2)}T00:00:00.000Z`),
      organizationId: agreements[0]!.organizationId,
      page,
      pageSize: 100,
      sortBy: 'plannedStart',
      sortOrder: 'asc',
    });
    rows.push(...result.items.filter((item) => item.origin === 'agreement_generated'));
    if (rows.length >= result.total || result.items.length === 0) break;
  }
  const confirmedSubstitutions = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    async (transaction) =>
      transaction
        .select({
          visitId: visitSubstitutions.visitId,
          employeeId: visitSubstitutions.substituteEmployeeId,
        })
        .from(visitSubstitutions)
        .where(
          and(
            eq(visitSubstitutions.tenantId, PILOT_TENANT_ID),
            eq(visitSubstitutions.status, 'confirmed'),
            inArray(
              visitSubstitutions.visitId,
              rows.map((visit) => visit.id),
            ),
          ),
        )
        .orderBy(asc(visitSubstitutions.createdAt)),
  );
  const substitutedEmployeeByVisit = new Map(
    confirmedSubstitutions.map((item) => [item.visitId, item.employeeId]),
  );
  for (const visit of rows) {
    const targetEmployee = caregiverForClient.get(visit.clientId);
    const client = clientById.get(visit.clientId);
    if (!targetEmployee || !client || client.ordinal >= 15) continue;
    const assignments = await scheduling.listAssignments(principal, visit.id);
    const active = assignments.filter((assignment) => assignment.status === 'active');
    if (active.length === 0) {
      await scheduling.assign(
        principal,
        visit.id,
        { employeeId: targetEmployee.id },
        contextFor(visit.organizationId),
        auditContext,
      );
    } else if (
      active.length !== 1 ||
      active[0]!.employeeId !== (substitutedEmployeeByVisit.get(visit.id) ?? targetEmployee.id)
    ) {
      throw new Error(`Generated pilot visit ${visit.id} has an unexpected active assignment`);
    }
  }

  const coverageVisit = rows
    .filter((visit) => visit.clientId === clients[0]!.id)
    .sort((left, right) => left.plannedStart.getTime() - right.plannedStart.getTime())[1];
  if (!coverageVisit) throw new Error('Pilot leave coverage visit was not generated');
  const coverageAssignment = (await scheduling.listAssignments(principal, coverageVisit.id)).find(
    (assignment) => assignment.status === 'active',
  );
  if (!coverageAssignment) throw new Error('Pilot leave coverage visit has no active assignment');
  const coverage = await ensureAbsenceSubstitution(coverageVisit, coverageAssignment);

  const assignedRows: PilotVisit[] = [];
  for (let page = 1; ; page += 1) {
    const result = await scheduling.search(principal, {
      from: new Date(`${addDays(from, -1)}T00:00:00.000Z`),
      until: new Date(`${addDays(until, 2)}T00:00:00.000Z`),
      organizationId: agreements[0]!.organizationId,
      page,
      pageSize: 100,
      sortBy: 'plannedStart',
      sortOrder: 'asc',
    });
    assignedRows.push(...result.items.filter((item) => item.origin === 'agreement_generated'));
    if (assignedRows.length >= result.total || result.items.length === 0) break;
  }
  const byTour = new Map<string, PilotVisit[]>();
  for (const visit of assignedRows) {
    const client = clientById.get(visit.clientId);
    if (!client || client.ordinal >= 15) continue;
    const assignment = visit.assignments.find((item) => item.status === 'active');
    if (!assignment) throw new Error(`Pilot visit ${visit.id} has no active caregiver assignment`);
    const localDate = localDateInBerlin(visit.plannedStart);
    const key = `${assignment.employeeId}:${localDate}`;
    byTour.set(key, [...(byTour.get(key) ?? []), visit]);
  }
  let publishedTours = 0;
  for (const [key, tourVisits] of byTour) {
    const [employeeId, localDate] = key.split(':');
    const employee = caregivers.find((item) => item.id === employeeId)!;
    const existingTours = await scheduling.listTours(
      principal,
      employeeId!,
      from,
      addDays(until, 1),
    );
    const existing = existingTours.find((tour) => tour.localDate === localDate);
    let tour;
    if (!existing) {
      tour = await scheduling.createTour(
        principal,
        {
          employeeId: employee.id,
          localDate: localDate!,
          timezone: TIMEZONE,
          visitIds: tourVisits.map((item) => item.id),
        },
        contextFor(tourVisits[0]!.organizationId),
        auditContext,
      );
    } else {
      tour = await scheduling.getTour(principal, existing.id);
      const stalePublishedTour =
        existing.status === 'published' && existing.latestPublishedVersion !== existing.version;
      if (
        existing.status === 'published' &&
        !stalePublishedTour &&
        tour.stops.length !== tourVisits.length
      ) {
        throw new Error(`Published pilot tour ${existing.id} differs from its generated visits`);
      }
      if (existing.status === 'draft' || stalePublishedTour) {
        tour = await scheduling.updateTourStops(
          principal,
          existing.id,
          {
            expectedVersion: existing.version,
            stops: tourVisits.map((item) => ({ visitId: item.id })),
          },
          contextFor(tourVisits[0]!.organizationId),
          auditContext,
        );
      }
    }
    if (tour.status === 'draft') {
      await scheduling.publishTour(
        principal,
        tour.id,
        tour.version,
        contextFor(tourVisits[0]!.organizationId),
        auditContext,
      );
    }
    if ((await scheduling.getTour(principal, tour.id)).status !== 'published') {
      throw new Error(`Pilot tour ${tour.id} did not publish`);
    }
    publishedTours += 1;
  }

  const scenarioVisits = assignedRows.filter((visit) => {
    const date = localDateInBerlin(visit.plannedStart);
    return date >= from && date <= until;
  });
  const visitsByEmployee = new Map<string, PilotVisit[]>();
  for (const visit of scenarioVisits) {
    const client = clientById.get(visit.clientId);
    if (!client || client.ordinal >= ACTIVE_CLIENT_COUNT) {
      throw new Error(`Pilot visit ${visit.id} references a non-scheduled client`);
    }
    const expectedService = client.ordinal % services.length;
    if (
      visit.organizationId !== agreements[0]!.organizationId ||
      visit.facilityId !== clients[0]!.primaryFacilityId ||
      visit.serviceAgreementId !== agreements[client.ordinal]!.id ||
      visit.services.length !== 1 ||
      visit.services[0]!.serviceDefinitionId !== services[expectedService]!.id
    ) {
      throw new Error(`Pilot visit ${visit.id} has inconsistent source or service references`);
    }
    const active = visit.assignments.filter((assignment) => assignment.status === 'active');
    if (
      active.length !== 1 ||
      !caregivers.some((employee) => employee.id === active[0]!.employeeId)
    ) {
      throw new Error(
        `Pilot visit ${visit.id} does not have exactly one active caregiver assignment`,
      );
    }
    const staffVisits = visitsByEmployee.get(active[0]!.employeeId) ?? [];
    staffVisits.push(visit);
    visitsByEmployee.set(active[0]!.employeeId, staffVisits);
  }
  for (const [employeeId, staffVisits] of visitsByEmployee) {
    staffVisits.sort((left, right) => left.plannedStart.getTime() - right.plannedStart.getTime());
    for (let index = 1; index < staffVisits.length; index += 1) {
      const previous = staffVisits[index - 1]!;
      const current = staffVisits[index]!;
      if (
        localDateInBerlin(previous.plannedStart) === localDateInBerlin(current.plannedStart) &&
        previous.plannedEnd.getTime() + 15 * 60_000 > current.plannedStart.getTime()
      ) {
        throw new Error(`Pilot caregiver ${employeeId} has overlapping visits or travel buffers`);
      }
    }
  }
  if (scenarioVisits.length !== ACTIVE_CLIENT_COUNT * 8) {
    throw new Error(
      `Expected ${ACTIVE_CLIENT_COUNT * 8} active recurring visits, found ${scenarioVisits.length}`,
    );
  }
  const workflowVisit = scenarioVisits.find(
    (visit) => visit.clientId === clients[5]!.id && localDateInBerlin(visit.plannedStart) === from,
  );
  if (!workflowVisit) {
    throw new Error(
      `The persistent finance scenario needs a Client 06 recurring visit on ${from}; choose a matching weekday reference date`,
    );
  }
  return {
    ...totals,
    ...coverage,
    visitCount: scenarioVisits.length,
    publishedTours,
    workflowVisitId: workflowVisit.id,
  };
}

async function ensurePilotCaregiverActor(
  employeeId: string,
  tenantRoles: Awaited<ReturnType<typeof seedSystemRoles>>,
) {
  const caregiverRole = tenantRoles.find((role) => role.name === 'Caregiver');
  if (!caregiverRole) throw new Error('The pilot Caregiver role is missing');

  await migrationDatabase.db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.tenant_id', ${PILOT_TENANT_ID}, true)`);
    const [existingUser] = await transaction
      .select({
        id: identitySchema.users.id,
        status: identitySchema.users.status,
        displayName: identitySchema.users.displayName,
        email: identitySchema.users.email,
      })
      .from(identitySchema.users)
      .where(eq(identitySchema.users.id, PILOT_CAREGIVER_ACTOR_ID))
      .limit(1);
    if (!existingUser) {
      await transaction.insert(identitySchema.users).values({
        id: PILOT_CAREGIVER_ACTOR_ID,
        status: 'active',
        displayName: 'Synthetic pilot visit actor — no sign-in',
      });
    } else if (
      existingUser.status !== 'active' ||
      existingUser.displayName !== 'Synthetic pilot visit actor — no sign-in' ||
      existingUser.email !== null
    ) {
      throw new Error('The synthetic pilot visit actor differs from its seed-only identity');
    }

    const [externalIdentity] = await transaction
      .select({ id: identitySchema.externalIdentities.id })
      .from(identitySchema.externalIdentities)
      .where(eq(identitySchema.externalIdentities.userId, PILOT_CAREGIVER_ACTOR_ID))
      .limit(1);
    if (externalIdentity) {
      throw new Error('The seed-only pilot visit actor must not have an external login mapping');
    }

    await transaction
      .insert(identitySchema.tenantMemberships)
      .values({
        id: PILOT_CAREGIVER_MEMBERSHIP_ID,
        userId: PILOT_CAREGIVER_ACTOR_ID,
        tenantId: PILOT_TENANT_ID,
        status: 'active',
      })
      .onConflictDoNothing({
        target: [
          identitySchema.tenantMemberships.userId,
          identitySchema.tenantMemberships.tenantId,
        ],
      });
    const [membership] = await transaction
      .select({
        id: identitySchema.tenantMemberships.id,
        status: identitySchema.tenantMemberships.status,
      })
      .from(identitySchema.tenantMemberships)
      .where(
        and(
          eq(identitySchema.tenantMemberships.userId, PILOT_CAREGIVER_ACTOR_ID),
          eq(identitySchema.tenantMemberships.tenantId, PILOT_TENANT_ID),
        ),
      )
      .limit(1);
    if (
      !membership ||
      membership.id !== PILOT_CAREGIVER_MEMBERSHIP_ID ||
      membership.status !== 'active'
    ) {
      throw new Error('The seed-only pilot visit actor membership is inactive or unexpected');
    }

    const [assignedRole] = await transaction
      .select({ roleId: identitySchema.membershipRoles.roleId })
      .from(identitySchema.membershipRoles)
      .where(eq(identitySchema.membershipRoles.membershipId, membership.id))
      .limit(2);
    const allAssignedRoles = await transaction
      .select({ roleId: identitySchema.membershipRoles.roleId })
      .from(identitySchema.membershipRoles)
      .where(eq(identitySchema.membershipRoles.membershipId, membership.id));
    if (allAssignedRoles.some((item) => item.roleId !== caregiverRole.id)) {
      throw new Error('The seed-only pilot visit actor has an unexpected role assignment');
    }
    if (!assignedRole) {
      await transaction.insert(identitySchema.membershipRoles).values({
        membershipId: membership.id,
        tenantId: PILOT_TENANT_ID,
        roleId: caregiverRole.id,
      });
    }

    const scopes = await transaction
      .select({
        scopeType: identitySchema.membershipScopes.scopeType,
        scopeId: identitySchema.membershipScopes.scopeId,
      })
      .from(identitySchema.membershipScopes)
      .where(eq(identitySchema.membershipScopes.membershipId, membership.id));
    if (scopes.some((scope) => scope.scopeType !== 'tenant' || scope.scopeId !== PILOT_TENANT_ID)) {
      throw new Error('The seed-only pilot visit actor has an unexpected access scope');
    }
    if (scopes.length === 0) {
      await transaction.insert(identitySchema.membershipScopes).values({
        membershipId: membership.id,
        tenantId: PILOT_TENANT_ID,
        scopeType: 'tenant',
        scopeId: PILOT_TENANT_ID,
      });
    }
  });

  await employeeService.linkUser(
    principal,
    employeeId,
    PILOT_CAREGIVER_ACTOR_ID,
    contextFor(),
    auditContext,
  );

  const rolePermissions = await migrationDatabase.db
    .select({ permission: identitySchema.rolePermissions.permission })
    .from(identitySchema.rolePermissions)
    .where(eq(identitySchema.rolePermissions.roleId, caregiverRole.id));
  const permissions = new Set(rolePermissions.map((row) => row.permission));
  const grants = PERMISSIONS.filter((permission) => permissions.has(permission)).map(
    (permission) => ({ permission, scopeType: 'tenant' as const, scopeId: PILOT_TENANT_ID }),
  );
  if (!grants.some((grant) => grant.permission === 'visit_execution.complete')) {
    throw new Error('The canonical Caregiver role cannot complete the pilot visit');
  }
  return {
    userId: PILOT_CAREGIVER_ACTOR_ID,
    tenantId: PILOT_TENANT_ID,
    roles: ['Caregiver'],
    grants,
  };
}

async function ensureCompletedPilotVisit(
  visitId: string,
  caregiverEmployeeId: string,
  organizationId: string,
  tenantRoles: Awaited<ReturnType<typeof seedSystemRoles>>,
) {
  const caregiverPrincipal = await ensurePilotCaregiverActor(caregiverEmployeeId, tenantRoles);
  const request = contextForActor(PILOT_CAREGIVER_ACTOR_ID, organizationId);
  let detail = await visitExecution.get(caregiverPrincipal, visitId);
  if (detail.execution.status === 'not_started') {
    if (localDateInBerlin(new Date()) !== PILOT_REFERENCE_DATE) {
      throw new Error(
        `A first completed pilot visit must use today's Berlin date; set PILOT_REFERENCE_DATE=${localDateInBerlin(new Date())} and rerun`,
      );
    }
    detail = await visitExecution.start(caregiverPrincipal, visitId, request, auditContext);
  }

  let version = detail.execution.version;
  for (const service of detail.services) {
    if (!service.visitServiceId) throw new Error('The pilot work visit has an unplanned service');
    if (service.status === 'not_recorded') {
      const recorded = await visitExecution.recordService(
        caregiverPrincipal,
        visitId,
        uuidv5(`pilot-performed:${service.visitServiceId}`, PILOT_NAMESPACE),
        {
          expectedVersion: version,
          visitServiceId: service.visitServiceId,
          status: 'performed',
          actualQuantity: service.plannedQuantity,
        },
        request,
        auditContext,
      );
      version = recorded.version;
    } else if (
      service.status !== 'performed' ||
      service.actualQuantity !== service.plannedQuantity
    ) {
      throw new Error('The existing pilot visit execution differs from its synthetic scenario');
    }
  }
  if (detail.execution.status !== 'completed') {
    detail = await visitExecution.complete(
      caregiverPrincipal,
      visitId,
      version,
      request,
      auditContext,
    );
  }
  detail = await visitExecution.get(caregiverPrincipal, visitId);
  if (detail.execution.status !== 'completed' || detail.services.length === 0) {
    throw new Error('The pilot visit did not complete with performed services');
  }

  let documentation = await careDocumentation.createForVisit(
    caregiverPrincipal,
    visitId,
    request,
    auditContext,
  );
  for (const service of detail.services) {
    if (!service.id) throw new Error('The completed pilot service has no performed-service ID');
    const existingEvidence = documentation.services.find(
      (item) => item.performedServiceId === service.id,
    )?.evidence;
    const evidenceNote = 'Synthetic pilot service evidence; no real client information.';
    if (!existingEvidence) {
      documentation = await careDocumentation.recordEvidence(
        caregiverPrincipal,
        documentation.documentation!.id,
        service.id,
        {
          expectedVersion: documentation.documentation!.version,
          status: 'documented',
          note: evidenceNote,
        },
        request,
        auditContext,
      );
    } else if (existingEvidence.status !== 'documented' || existingEvidence.note !== evidenceNote) {
      throw new Error('The existing pilot service evidence differs from its synthetic scenario');
    }
  }

  const note = 'Synthetic pilot visit completed as agreed. No clinical or medication data.';
  if (
    !documentation.entries.some((entry) => entry.type === 'care_note' && entry.content === note)
  ) {
    documentation = await careDocumentation.addEntry(
      caregiverPrincipal,
      documentation.documentation!.id,
      { expectedVersion: documentation.documentation!.version, type: 'care_note', content: note },
      request,
      auditContext,
    );
  }
  if (documentation.documentation?.status === 'draft') {
    documentation = await careDocumentation.finalize(
      caregiverPrincipal,
      documentation.documentation.id,
      documentation.documentation.version,
      request,
      auditContext,
    );
  }
  if (documentation.documentation?.status !== 'finalized') {
    throw new Error('The synthetic pilot care documentation did not finalize');
  }

  const evidencePackage = await serviceEvidence.prepare(
    caregiverPrincipal,
    visitId,
    request,
    auditContext,
  );
  if (!evidencePackage.isCurrent || evidencePackage.status !== 'ready') {
    throw new Error('The synthetic pilot evidence package is not current and ready');
  }
  return { detail, documentation, evidencePackage };
}

function contextForActor(userId: string, organizationId?: string) {
  return {
    requestId: asUUID(uuidv7()),
    correlationId: asUUID(uuidv7()),
    userId: asUUID(userId),
    tenantId: asUUID(PILOT_TENANT_ID),
    ...(organizationId ? { organizationId: asUUID(organizationId) } : {}),
  };
}

async function ensurePilotBillingProfile(organizationId: string) {
  const settings = await billing.settings(principal);
  const existing = settings.find((item) => item.organizationId === organizationId)?.profile;
  const desired = {
    organizationId,
    bankAccountHolder: 'Muster Betreuungsdienst NRW (synthetisch)',
    iban: 'DE89370400440532013000',
    paymentTermsDays: 14,
    invoiceNumberPrefix: 'MBNRW',
    defaultCurrency: 'EUR' as const,
    taxTreatment: 'tax_exempt' as const,
    taxExemptionBasis: 'Synthetic local pilot setting; not a tax determination.',
    requireAcknowledgement: false,
    requiredInvoiceFormat: 'pdf' as const,
  };
  if (existing) {
    if (
      existing.bankAccountHolder !== desired.bankAccountHolder ||
      existing.iban !== desired.iban ||
      existing.paymentTermsDays !== desired.paymentTermsDays ||
      existing.invoiceNumberPrefix !== desired.invoiceNumberPrefix ||
      existing.taxTreatment !== desired.taxTreatment ||
      existing.taxExemptionBasis !== desired.taxExemptionBasis ||
      existing.requireAcknowledgement !== desired.requireAcknowledgement ||
      existing.requiredInvoiceFormat !== desired.requiredInvoiceFormat
    ) {
      throw new Error('Pilot billing profile differs from its synthetic configuration');
    }
    return existing;
  }
  return billing.saveSettings(principal, desired, contextFor(organizationId), auditContext);
}

async function ensurePilotOtherEntitlement(
  clientId: string,
  fundingSourceId: string,
  organizationId: string,
) {
  const existing = await unitOfWork.transaction({ tenantId: PILOT_TENANT_ID }, (transaction) =>
    transaction
      .select()
      .from(clientBenefitEntitlements)
      .where(
        and(
          eq(clientBenefitEntitlements.tenantId, PILOT_TENANT_ID),
          eq(clientBenefitEntitlements.clientId, clientId),
          eq(clientBenefitEntitlements.fundingSourceId, fundingSourceId),
          eq(clientBenefitEntitlements.benefitType, 'other'),
          eq(clientBenefitEntitlements.validFrom, PILOT_REFERENCE_DATE),
        ),
      )
      .limit(2),
  );
  if (existing.length > 1) throw new Error('Duplicate synthetic external entitlement exists');
  const current = existing[0];
  if (current) {
    if (
      current.status !== 'confirmed' ||
      current.calculationMode !== 'manual' ||
      current.source !== 'contract'
    ) {
      throw new Error('Synthetic external entitlement differs from its contract scenario');
    }
    return current;
  }
  return benefits.createEntitlement(
    principal,
    clientId,
    {
      benefitType: 'other',
      fundingSourceId,
      validFrom: PILOT_REFERENCE_DATE,
      status: 'confirmed',
      calculationMode: 'manual',
      source: 'contract',
    },
    contextFor(organizationId),
    auditContext,
  );
}

async function ensurePilotPayerSetup(
  organizationId: string,
  clientId: string,
  fundingSourceId: string,
  serviceDate: string,
) {
  const payerMatches = await migrationDatabase.db
    .select()
    .from(payers)
    .where(
      and(
        eq(payers.tenantId, PILOT_TENANT_ID),
        eq(payers.organizationId, organizationId),
        eq(payers.name, SYNTHETIC_PAYER_NAME),
      ),
    )
    .limit(2);
  if (payerMatches.length > 1) throw new Error('Duplicate synthetic pilot payer exists');
  let payer = payerMatches[0];
  if (!payer) {
    payer = await billingClaims.createPayer(
      principal,
      {
        organizationId,
        payerType: 'other',
        name: SYNTHETIC_PAYER_NAME,
        addressText: 'Fiktivstraße 0, 00000 Musterstadt, Deutschland',
        submissionInstructions: 'Local synthetic demonstration; no external submission.',
        status: 'active',
        validFrom: serviceDate,
      },
      contextFor(organizationId),
      auditContext,
    );
  } else if (
    payer.status !== 'active' ||
    payer.payerType !== 'other' ||
    payer.payerIdentifier !== null
  ) {
    throw new Error('Synthetic pilot payer differs from its local-only setup');
  }

  const profiles = await migrationDatabase.db
    .select()
    .from(payerBillingProfiles)
    .where(
      and(
        eq(payerBillingProfiles.tenantId, PILOT_TENANT_ID),
        eq(payerBillingProfiles.payerId, payer.id),
        eq(payerBillingProfiles.channel, 'manual_portal'),
        eq(payerBillingProfiles.fundingSourceType, 'other'),
      ),
    )
    .orderBy(desc(payerBillingProfiles.version))
    .limit(1);
  let payerProfile = profiles[0];
  if (!payerProfile) {
    payerProfile = await billingClaims.savePayerProfile(
      principal,
      {
        organizationId,
        payerId: payer.id,
        channel: 'manual_portal',
        fundingSourceType: 'other',
        validFrom: serviceDate,
        sourceName: 'Synthetic local pilot claim profile',
        sourceVersion: 'local-only-1',
        sourceEffectiveDate: serviceDate,
        requiresClientInsuranceNumber: false,
        requiresPayerIdentifier: false,
        requiresAcknowledgement: false,
        requiresMandate: false,
        requiresInvoicePdf: true,
        requiresEvidencePdf: true,
        requiresMandateDocument: false,
        requiresExternalReference: false,
        requiresProviderRecognition: false,
        expectedVersion: 0,
      },
      contextFor(organizationId),
      auditContext,
    );
  } else if (
    !payerProfile.requiresInvoicePdf ||
    !payerProfile.requiresEvidencePdf ||
    payerProfile.requiresMandate ||
    payerProfile.requiresExternalReference ||
    payerProfile.sourceName !== 'Synthetic local pilot claim profile'
  ) {
    throw new Error('Synthetic pilot claim profile differs from its local-only setup');
  }

  const arrangements = await migrationDatabase.db
    .select()
    .from(payerArrangements)
    .where(
      and(
        eq(payerArrangements.tenantId, PILOT_TENANT_ID),
        eq(payerArrangements.clientId, clientId),
        eq(payerArrangements.payerId, payer.id),
        eq(payerArrangements.fundingSourceId, fundingSourceId),
      ),
    )
    .limit(2);
  if (arrangements.length > 1) throw new Error('Duplicate pilot payer arrangement exists');
  let arrangement = arrangements[0];
  if (!arrangement) {
    arrangement = await billing.createPayerArrangement(
      principal,
      {
        organizationId,
        clientId,
        payerId: payer.id,
        fundingSourceId,
        payerType: 'other',
        payerReference: 'SYNTHETIC-LOCAL-PILOT-REFERENCE',
        arrangementType: 'direct_payer_billing',
        recipientType: 'other',
        recipientName: SYNTHETIC_PAYER_NAME,
        recipientAddress: 'Fiktivstraße 0, 00000 Musterstadt, Deutschland',
        mandateStatus: 'authorized',
        documentedSource: 'Synthetic local scenario authorization; no real mandate.',
        documentedReference: 'SYNTHETIC-LOCAL-ONLY',
        validFrom: serviceDate,
      },
      contextFor(organizationId),
      auditContext,
    );
  } else if (
    arrangement.arrangementType !== 'direct_payer_billing' ||
    arrangement.recipientName !== SYNTHETIC_PAYER_NAME
  ) {
    throw new Error('Synthetic payer arrangement differs from its local-only setup');
  }
  if (!arrangement) throw new Error('Synthetic pilot payer arrangement could not be resolved');
  if (arrangement.mandateStatus === 'not_applicable') {
    arrangement = await billing.updatePayerArrangement(
      principal,
      arrangement.id,
      {
        expectedVersion: arrangement.version,
        mandateStatus: 'authorized',
        documentedSource: 'Synthetic local scenario authorization; no real mandate.',
        documentedReference: 'SYNTHETIC-LOCAL-ONLY',
      },
      contextFor(organizationId),
      auditContext,
    );
  } else if (
    arrangement.mandateStatus !== 'authorized' ||
    arrangement.documentedSource !== 'Synthetic local scenario authorization; no real mandate.' ||
    arrangement.documentedReference !== 'SYNTHETIC-LOCAL-ONLY'
  ) {
    throw new Error('Synthetic payer authorization differs from its local-only setup');
  }
  return { payer, payerProfile, arrangement };
}

async function ensurePilotInvoice(
  clientId: string,
  organizationId: string,
  facilityId: string,
  candidate: Awaited<ReturnType<typeof billing.candidates>>[number],
  recipientType: 'client' | 'payer',
  payerArrangementId?: string,
) {
  const matchingInvoices = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    async (transaction) => {
      const condition = candidate.fundingAllocationId
        ? eq(invoiceLines.fundingAllocationId, candidate.fundingAllocationId)
        : isNull(invoiceLines.fundingAllocationId);
      return transaction
        .select({
          id: invoices.id,
          status: invoices.status,
          recipientType: invoices.recipientType,
          payerArrangementId: invoices.payerArrangementId,
        })
        .from(invoiceLines)
        .innerJoin(
          invoices,
          and(
            eq(invoices.tenantId, invoiceLines.tenantId),
            eq(invoices.id, invoiceLines.invoiceId),
          ),
        )
        .where(
          and(
            eq(invoiceLines.tenantId, PILOT_TENANT_ID),
            eq(invoiceLines.performedServiceId, candidate.performedServiceId),
            condition,
          ),
        )
        .limit(2);
    },
  );
  if (matchingInvoices.length > 1) {
    throw new Error(`Multiple invoices already use pilot source ${candidate.sourceKey}`);
  }

  let invoice;
  const existing = matchingInvoices[0];
  if (existing) {
    if (
      existing.recipientType !== recipientType ||
      existing.payerArrangementId !== (payerArrangementId ?? null) ||
      existing.status === 'cancelled'
    ) {
      throw new Error(`Existing pilot invoice for ${candidate.sourceKey} needs manual review`);
    }
    invoice = await billing.getInvoice(principal, existing.id);
    if (invoice.status === 'draft') {
      invoice = await billing.issueInvoice(
        principal,
        invoice.id,
        { expectedVersion: invoice.version },
        contextFor(organizationId),
        auditContext,
      );
    }
  } else {
    if (!candidate.ready || candidate.remainingBillableAmountCents <= 0) {
      throw new Error(
        `Pilot billing source ${candidate.sourceKey} is not ready: ${candidate.blockers.join(', ')}`,
      );
    }
    const draft = await billing.createDraft(
      principal,
      {
        organizationId,
        facilityId,
        clientId,
        recipientType,
        ...(payerArrangementId ? { payerArrangementId } : {}),
        lines: [
          {
            performedServiceId: candidate.performedServiceId,
            amountCents: candidate.remainingBillableAmountCents,
            ...(candidate.fundingAllocationId
              ? { fundingAllocationId: candidate.fundingAllocationId }
              : {}),
          },
        ],
      },
      contextFor(organizationId),
      auditContext,
    );
    invoice = await billing.issueInvoice(
      principal,
      draft.id,
      { expectedVersion: draft.version },
      contextFor(organizationId),
      auditContext,
    );
  }
  if (invoice.status !== 'issued' || invoice.lines.length !== 1) {
    throw new Error(`Pilot invoice for ${candidate.sourceKey} did not issue exactly one line`);
  }
  return invoice;
}

async function findPilotInvoiceForSource(
  performedServiceId: string,
  fundingAllocationId: string | null,
) {
  const matchingInvoices = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    async (transaction) => {
      const condition = fundingAllocationId
        ? eq(invoiceLines.fundingAllocationId, fundingAllocationId)
        : isNull(invoiceLines.fundingAllocationId);
      return transaction
        .select({ id: invoices.id })
        .from(invoiceLines)
        .innerJoin(
          invoices,
          and(
            eq(invoices.tenantId, invoiceLines.tenantId),
            eq(invoices.id, invoiceLines.invoiceId),
          ),
        )
        .where(
          and(
            eq(invoiceLines.tenantId, PILOT_TENANT_ID),
            eq(invoiceLines.performedServiceId, performedServiceId),
            condition,
          ),
        )
        .limit(2);
    },
  );
  if (matchingInvoices.length > 1) {
    throw new Error(`Multiple invoices already use pilot service ${performedServiceId}`);
  }
  return matchingInvoices[0] ? billing.getInvoice(principal, matchingInvoices[0].id) : undefined;
}

async function ensurePilotClaimAndPayments(
  payerInvoiceId: string,
  clientInvoiceId: string,
  payerArrangementId: string,
  payerProfileId: string,
  organizationId: string,
  serviceDate: string,
) {
  const payerInvoice = await billing.getInvoice(principal, payerInvoiceId);
  const existingClaims = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    (transaction) =>
      transaction
        .select({ id: claims.id })
        .from(claims)
        .where(and(eq(claims.tenantId, PILOT_TENANT_ID), eq(claims.invoiceId, payerInvoiceId)))
        .limit(2),
  );
  if (existingClaims.length > 1) throw new Error('Duplicate claim exists for pilot payer invoice');

  let claimId = existingClaims[0]?.id;
  if (!claimId) {
    const created = await billingClaims.createClaim(
      principal,
      {
        invoiceId: payerInvoice.id,
        expectedInvoiceVersion: payerInvoice.version,
        payerArrangementId,
        payerBillingProfileId: payerProfileId,
        lines: payerInvoice.lines.map((line) => ({
          invoiceLineId: line.id,
          amountCents: line.amountCents,
        })),
      },
      contextFor(organizationId),
      auditContext,
    );
    claimId = created.claim.id;
  }

  let claim = await billingClaims.getClaim(principal, claimId);
  if (claim.claim.status === 'draft') {
    const readiness = await billingClaims.readiness(principal, claimId);
    if (!readiness.ready) {
      throw new Error(
        `Synthetic pilot claim is not ready: ${readiness.blockers.map((item) => item.code).join(', ')}`,
      );
    }
    claim = await billingClaims.prepare(
      principal,
      claimId,
      claim.claim.version,
      contextFor(organizationId),
      auditContext,
    );
  }
  if (claim.claim.status === 'ready') {
    claim = await billingClaims.submit(
      principal,
      claimId,
      {
        expectedVersion: claim.claim.version,
        externalReference: SYNTHETIC_PAYER_REFERENCE,
        protectedNote: 'Synthetic local claim state only; nothing was sent externally.',
      },
      contextFor(organizationId),
      auditContext,
    );
  }
  if (claim.claim.status === 'submitted') {
    const lines = claim.lines.map((line) => ({
      claimLineId: line.id,
      acceptedCents: line.amountCents,
      rejectedCents: 0,
    }));
    claim = await billingClaims.recordDecision(
      principal,
      claimId,
      {
        expectedVersion: claim.claim.version,
        decision: 'accepted',
        decisionDate: serviceDate,
        externalReference: 'SYNTHETIC-LOCAL-ACCEPTANCE-NOT-A-PAYER-RESPONSE',
        acceptedCents: claim.claim.amountCents,
        rejectedCents: 0,
        reasonCode: 'SYNTHETIC_PILOT_SCENARIO',
        protectedExplanation: 'Synthetic workflow state; not a real payer decision.',
        lines,
      },
      contextFor(organizationId),
      auditContext,
    );
  }
  if (claim.claim.status !== 'accepted') {
    throw new Error(`Synthetic pilot claim stopped in unexpected state ${claim.claim.status}`);
  }

  const payerPayment = await ensurePilotPayment({
    reference: SYNTHETIC_PAYER_PAYMENT_REFERENCE,
    organizationId,
    payerName: SYNTHETIC_PAYER_NAME,
    amountCents: claim.claim.amountCents,
  });
  const payerPaymentAllocation = await ensurePilotPaymentAllocation({
    paymentId: payerPayment.id,
    invoiceId: payerInvoiceId,
    claimId,
    amountCents: claim.claim.amountCents,
    organizationId,
  });

  const clientInvoice = await billing.getInvoice(principal, clientInvoiceId);
  const clientPaidCents = Math.max(1, Math.floor(clientInvoice.grandTotalCents / 3));
  if (clientPaidCents >= clientInvoice.grandTotalCents) {
    throw new Error('Pilot self-pay invoice is too small for a partial payment scenario');
  }
  const clientPayment = await ensurePilotPayment({
    reference: SYNTHETIC_CLIENT_PAYMENT_REFERENCE,
    organizationId,
    payerName: 'Fiktiv Klient 06 (synthetisch)',
    amountCents: clientPaidCents,
  });
  const clientPaymentAllocation = await ensurePilotPaymentAllocation({
    paymentId: clientPayment.id,
    invoiceId: clientInvoiceId,
    amountCents: clientPaidCents,
    organizationId,
  });

  const updatedPayerInvoice = await billing.getInvoice(principal, payerInvoiceId);
  const updatedClientInvoice = await billing.getInvoice(principal, clientInvoiceId);
  if (
    updatedPayerInvoice.outstandingCents !== 0 ||
    updatedClientInvoice.outstandingCents === null ||
    updatedClientInvoice.outstandingCents <= 0 ||
    updatedClientInvoice.outstandingCents >= updatedClientInvoice.grandTotalCents
  ) {
    throw new Error('Pilot invoice totals and synthetic payments do not reconcile');
  }
  const finalClaim = await billingClaims.getClaim(principal, claimId);
  if (finalClaim.claim.status !== 'accepted') {
    throw new Error('Pilot claim acceptance does not match the claim amount');
  }
  const summary = await billingClaims.paymentSummary(principal, claimId);
  if (
    summary.acceptedCents !== finalClaim.claim.amountCents ||
    summary.acceptedCents !== summary.paidCents ||
    summary.unpaidCents !== 0 ||
    payerPaymentAllocation.amountCents !== summary.paidCents ||
    clientPaymentAllocation.amountCents !== clientPaidCents
  ) {
    throw new Error('Pilot claim and payment allocation totals are inconsistent');
  }
  return {
    claimId,
    claimAmountCents: finalClaim.claim.amountCents,
    payerInvoice: updatedPayerInvoice,
    clientInvoice: updatedClientInvoice,
    clientPaidCents,
  };
}

async function ensurePilotPayment(input: {
  reference: string;
  organizationId: string;
  payerName: string;
  amountCents: number;
}) {
  const existing = await unitOfWork.transaction({ tenantId: PILOT_TENANT_ID }, (transaction) =>
    transaction
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, PILOT_TENANT_ID), eq(payments.reference, input.reference)))
      .limit(2),
  );
  if (existing.length > 1) throw new Error(`Duplicate synthetic payment ${input.reference}`);
  const payment = existing[0];
  if (payment) {
    if (
      payment.organizationId !== input.organizationId ||
      payment.amountCents !== input.amountCents ||
      payment.payerNameSnapshot !== input.payerName
    ) {
      throw new Error(`Synthetic payment ${input.reference} differs from its expected record`);
    }
    return payment;
  }
  return billing.recordPayment(
    principal,
    {
      organizationId: input.organizationId,
      amountCents: input.amountCents,
      receivedAt: new Date().toISOString(),
      method: 'bank_transfer',
      payerName: input.payerName,
      reference: input.reference,
    },
    contextFor(input.organizationId),
    auditContext,
  );
}

async function ensurePilotPaymentAllocation(input: {
  paymentId: string;
  invoiceId: string;
  claimId?: string;
  amountCents: number;
  organizationId: string;
}) {
  const existing = await unitOfWork.transaction({ tenantId: PILOT_TENANT_ID }, (transaction) =>
    transaction
      .select()
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.tenantId, PILOT_TENANT_ID),
          eq(paymentAllocations.paymentId, input.paymentId),
          eq(paymentAllocations.invoiceId, input.invoiceId),
          input.claimId
            ? eq(paymentAllocations.claimId, input.claimId)
            : isNull(paymentAllocations.claimId),
        ),
      )
      .limit(2),
  );
  if (existing.length > 1) throw new Error('Duplicate synthetic payment allocation exists');
  const allocation = existing[0];
  if (allocation) {
    if (allocation.amountCents !== input.amountCents) {
      throw new Error('Existing synthetic payment allocation differs from its expected amount');
    }
    return allocation;
  }
  return billing.allocatePayment(
    principal,
    {
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      ...(input.claimId ? { claimId: input.claimId } : {}),
      amountCents: input.amountCents,
    },
    contextFor(input.organizationId),
    auditContext,
  );
}

async function ensurePilotTask(input: {
  organizationId: string;
  facilityId: string;
  clientId: string;
  title: string;
  description: string;
  source: {
    type: 'client' | 'service_agreement' | 'benefit_entitlement' | 'invoice' | 'claim';
    id: string;
  };
  priority?: 'low' | 'normal' | 'high';
}) {
  const found = await operations.listTasks(principal, {
    organizationId: input.organizationId,
    clientId: input.clientId,
    search: input.title,
    pageSize: 100,
  });
  const matches = found.items.filter((task) => task.title === input.title);
  if (matches.length > 1) throw new Error(`Duplicate synthetic Operations task: ${input.title}`);
  const existing = matches[0];
  if (existing) {
    if (existing.source?.type !== input.source.type || existing.source.id !== input.source.id) {
      throw new Error(`Synthetic Operations task ${input.title} has a stale source link`);
    }
    return existing;
  }
  return operations.createTask(
    principal,
    {
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      clientId: input.clientId,
      title: input.title,
      description: input.description,
      priority: input.priority ?? 'normal',
      dueAt: new Date(`${addDays(PILOT_REFERENCE_DATE, 7)}T16:00:00.000Z`),
      source: input.source,
    },
    contextFor(input.organizationId),
    auditContext,
  );
}

async function ensurePilotOperationalTasks(input: {
  organizationId: string;
  facilityId: string;
  clients: Array<PilotClient & { ordinal: number }>;
  agreements: Array<Awaited<ReturnType<typeof agreementService.create>> & { ordinal: number }>;
  externalEntitlementId: string;
  clientInvoiceId: string;
  claimId: string;
}) {
  const created = [];
  for (const agreement of input.agreements.filter((item) => item.status === 'draft')) {
    const client = input.clients[agreement.ordinal]!;
    created.push(
      await ensurePilotTask({
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        clientId: client.id,
        title: `[SYNTHETIC PILOT] Review draft agreement ${agreement.reference}`,
        description: 'Synthetic reminder: review the draft service agreement before admission.',
        source: { type: 'service_agreement', id: agreement.id },
      }),
    );
  }
  for (const client of input.clients.filter((item) => item.ordinal >= ACTIVE_CLIENT_COUNT)) {
    created.push(
      await ensurePilotTask({
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        clientId: client.id,
        title: `[SYNTHETIC PILOT] Follow up onboarding for client ${String(client.ordinal + 1).padStart(2, '0')}`,
        description: 'Synthetic Office follow-up for the client onboarding case.',
        source: { type: 'client', id: client.id },
        priority: 'high',
      }),
    );
  }
  for (const client of input.clients.slice(0, 2)) {
    created.push(
      await ensurePilotTask({
        organizationId: input.organizationId,
        facilityId: input.facilityId,
        clientId: client.id,
        title: `[SYNTHETIC PILOT] Verify contact authority for client ${String(client.ordinal + 1).padStart(2, '0')}`,
        description:
          'Synthetic follow-up: confirm whether the recorded contact may act for the client.',
        source: { type: 'client', id: client.id },
      }),
    );
  }

  const firstClient = input.clients[0]!;
  created.push(
    await ensurePilotTask({
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      clientId: firstClient.id,
      title: '[SYNTHETIC PILOT] Review provider-reported benefit entry',
      description: 'Synthetic follow-up: verify the external §45b statement before relying on it.',
      source: { type: 'benefit_entitlement', id: input.externalEntitlementId },
      priority: 'high',
    }),
  );
  const sixthClient = input.clients[5]!;
  created.push(
    await ensurePilotTask({
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      clientId: sixthClient.id,
      title: '[SYNTHETIC PILOT] Review private invoice remainder',
      description: 'Synthetic follow-up for the outstanding self-pay invoice balance.',
      source: { type: 'invoice', id: input.clientInvoiceId },
    }),
  );
  created.push(
    await ensurePilotTask({
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      clientId: sixthClient.id,
      title: '[SYNTHETIC PILOT] Review local claim exercise',
      description:
        'Synthetic training item: the accepted claim and payment were not sent to or received from a payer.',
      source: { type: 'claim', id: input.claimId },
    }),
  );

  if (created.length !== 15) {
    throw new Error(`Expected 15 synthetic Office tasks, found ${created.length}`);
  }
  return created;
}

async function ensurePilotFinancialScenario(input: {
  organizationId: string;
  facilityId: string;
  clients: Array<PilotClient & { ordinal: number }>;
  caregivers: PilotEmployee[];
  agreements: Array<Awaited<ReturnType<typeof agreementService.create>> & { ordinal: number }>;
  tenantRoles: Awaited<ReturnType<typeof seedSystemRoles>>;
  visitId: string;
}) {
  const client = input.clients[5]!;
  const assigned = (await scheduling.listAssignments(principal, input.visitId)).filter(
    (assignment) => assignment.status === 'active',
  );
  if (assigned.length !== 1 || assigned[0]!.employeeId !== input.caregivers[5]!.id) {
    throw new Error('The financial pilot visit has an unexpected caregiver assignment');
  }
  const completed = await ensureCompletedPilotVisit(
    input.visitId,
    input.caregivers[5]!.id,
    input.organizationId,
    input.tenantRoles,
  );
  const performed = completed.detail.services[0];
  if (!performed?.id || completed.detail.services.length !== 1) {
    throw new Error('Expected one performed service for the synthetic financial scenario');
  }

  const externalSources = (await benefits.listFundingSources(principal, client.id)).filter(
    (source) => source.label === SYNTHETIC_EXTERNAL_SOURCE_LABEL,
  );
  if (externalSources.length !== 1 || externalSources[0]!.sourceType !== 'other') {
    throw new Error('The synthetic external funding source for Client 06 is missing or ambiguous');
  }
  const entitlement = await ensurePilotOtherEntitlement(
    client.id,
    externalSources[0]!.id,
    input.organizationId,
  );
  const serviceDate = localDateInBerlin(new Date(completed.detail.execution.actualEnd!));
  const billingProfile = await ensurePilotBillingProfile(input.organizationId);
  if (!billingProfile) throw new Error('Pilot billing profile could not be resolved');
  const performedServiceId = performed.id;

  const initialCandidates = await billing.candidates(principal, {
    from: serviceDate,
    until: serviceDate,
    clientId: client.id,
  });
  const unallocated = initialCandidates.find(
    (candidate) =>
      candidate.performedServiceId === performedServiceId && candidate.fundingAllocationId === null,
  );
  if (!unallocated?.serviceAmountCents || unallocated.serviceAmountCents < 2) {
    throw new Error('The completed pilot service has no positive provider-priced billable amount');
  }
  const externalShareCents = Math.floor(unallocated.serviceAmountCents / 2);
  const allocation = await benefits.allocateService(
    principal,
    performedServiceId,
    [
      {
        fundingSourceId: externalSources[0]!.id,
        entitlementId: entitlement.id,
        amountCents: externalShareCents,
        status: 'confirmed',
        idempotencyKey: uuidv5('pilot-client-06-other-allocation', PILOT_NAMESPACE),
      },
    ],
    contextFor(input.organizationId),
    auditContext,
  );
  const fundingAllocationId = allocation.allocations[0]?.id;
  if (
    !fundingAllocationId ||
    allocation.serviceAmountCents !== unallocated.serviceAmountCents ||
    allocation.allocatedCents !== externalShareCents ||
    allocation.remainingCents !== unallocated.serviceAmountCents - externalShareCents
  ) {
    throw new Error('The split funding allocation failed its service amount consistency check');
  }

  const payerSetup = await ensurePilotPayerSetup(
    input.organizationId,
    client.id,
    externalSources[0]!.id,
    serviceDate,
  );
  const payerArrangementId = payerSetup.arrangement.id;
  const splitCandidates = await billing.candidates(principal, {
    from: serviceDate,
    until: serviceDate,
    clientId: client.id,
  });
  const payerCandidate = splitCandidates.find(
    (candidate) =>
      candidate.performedServiceId === performedServiceId &&
      candidate.fundingAllocationId === fundingAllocationId,
  );
  const clientCandidate = splitCandidates.find(
    (candidate) =>
      candidate.performedServiceId === performedServiceId && candidate.fundingAllocationId === null,
  );
  const existingPayerInvoice = await findPilotInvoiceForSource(
    performedServiceId,
    fundingAllocationId,
  );
  const existingClientInvoice = await findPilotInvoiceForSource(performedServiceId, null);
  if (
    !payerCandidate ||
    !clientCandidate ||
    (!existingPayerInvoice &&
      (!payerCandidate.ready ||
        payerCandidate.remainingBillableAmountCents !== externalShareCents)) ||
    (!existingClientInvoice &&
      (!clientCandidate.ready ||
        clientCandidate.remainingBillableAmountCents !== allocation.remainingCents)) ||
    payerCandidate.recommendedRecipient !== 'payer' ||
    payerCandidate.recommendedPayerArrangementId !== payerArrangementId
  ) {
    const blockers = [...(payerCandidate?.blockers ?? []), ...(clientCandidate?.blockers ?? [])];
    throw new Error(
      `The pilot split billing candidates are inconsistent (payer recipient=${payerCandidate?.recommendedRecipient ?? 'missing'}, payer arrangement=${payerCandidate?.recommendedPayerArrangementId ?? 'missing'}, payer amount=${payerCandidate?.remainingBillableAmountCents ?? 'missing'}, client amount=${clientCandidate?.remainingBillableAmountCents ?? 'missing'}; expected ${payerArrangementId}, ${externalShareCents}/${allocation.remainingCents} cents)${blockers.length ? `: ${blockers.join(', ')}` : ''}`,
    );
  }

  const payerInvoice = await ensurePilotInvoice(
    client.id,
    input.organizationId,
    input.facilityId,
    payerCandidate,
    'payer',
    payerArrangementId,
  );
  const currentClientCandidates = await billing.candidates(principal, {
    from: serviceDate,
    until: serviceDate,
    clientId: client.id,
  });
  const currentClientCandidate = currentClientCandidates.find(
    (candidate) =>
      candidate.performedServiceId === performedServiceId && candidate.fundingAllocationId === null,
  );
  if (
    !currentClientCandidate ||
    (!existingClientInvoice &&
      (!currentClientCandidate.ready ||
        currentClientCandidate.remainingBillableAmountCents !== allocation.remainingCents))
  ) {
    throw new Error('The self-pay remainder changed after issuing the pilot payer invoice');
  }
  const clientInvoice = await ensurePilotInvoice(
    client.id,
    input.organizationId,
    input.facilityId,
    currentClientCandidate,
    'client',
  );
  if (
    payerInvoice.status !== 'issued' ||
    payerInvoice.lines.length !== 1 ||
    payerInvoice.grandTotalCents !== externalShareCents ||
    clientInvoice.status !== 'issued' ||
    clientInvoice.lines.length !== 1 ||
    clientInvoice.grandTotalCents !== allocation.remainingCents ||
    payerInvoice.grandTotalCents + clientInvoice.grandTotalCents !== unallocated.serviceAmountCents
  ) {
    throw new Error('The two pilot invoice lines do not reconcile to the performed service amount');
  }

  const benefitScenario = await ensurePilotClaimAndPayments(
    payerInvoice.id,
    clientInvoice.id,
    payerArrangementId,
    payerSetup.payerProfile.id,
    input.organizationId,
    serviceDate,
  );
  const externalEntitlements = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    (transaction) =>
      transaction
        .select({ id: clientBenefitEntitlements.id })
        .from(clientBenefitEntitlements)
        .where(
          and(
            eq(clientBenefitEntitlements.tenantId, PILOT_TENANT_ID),
            eq(clientBenefitEntitlements.clientId, input.clients[0]!.id),
            eq(clientBenefitEntitlements.benefitType, 'entlastungsbetrag_45b'),
            eq(clientBenefitEntitlements.validFrom, PILOT_REFERENCE_DATE),
          ),
        )
        .limit(2),
  );
  if (externalEntitlements.length !== 1) {
    throw new Error('The provisional Client 01 benefit entitlement is missing or ambiguous');
  }
  const tasks = await ensurePilotOperationalTasks({
    organizationId: input.organizationId,
    facilityId: input.facilityId,
    clients: input.clients,
    agreements: input.agreements,
    externalEntitlementId: externalEntitlements[0]!.id,
    clientInvoiceId: clientInvoice.id,
    claimId: benefitScenario.claimId,
  });

  const activeAllocations = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    (transaction) =>
      transaction
        .select()
        .from(serviceAllocations)
        .where(
          and(
            eq(serviceAllocations.tenantId, PILOT_TENANT_ID),
            eq(serviceAllocations.performedServiceId, performedServiceId),
          ),
        ),
  );
  if (
    activeAllocations.length !== 1 ||
    activeAllocations[0]!.amountCents !== externalShareCents ||
    activeAllocations[0]!.status !== 'confirmed'
  ) {
    throw new Error('The pilot performed service has invalid or duplicate funding allocations');
  }
  const existingTasks = await operations.listTasks(principal, {
    organizationId: input.organizationId,
    search: '[SYNTHETIC PILOT]',
    pageSize: 100,
  });
  if (existingTasks.total !== 15 || tasks.length !== 15) {
    throw new Error(`Expected 15 unique synthetic Office tasks, found ${existingTasks.total}`);
  }
  if (billingProfile.organizationId !== input.organizationId) {
    throw new Error('Pilot billing profile belongs to an unexpected organization');
  }

  return {
    performedServiceId: performed.id,
    completedVisitId: input.visitId,
    externalAllocationCents: externalShareCents,
    serviceAmountCents: unallocated.serviceAmountCents,
    invoiceCount: 2,
    claimId: benefitScenario.claimId,
    payerInvoice: benefitScenario.payerInvoice,
    clientInvoice: benefitScenario.clientInvoice,
    clientPaidCents: benefitScenario.clientPaidCents,
    operationsTaskCount: tasks.length,
    syntheticCaregiverActor: PILOT_CAREGIVER_ACTOR_ID,
  };
}

async function ensureAbsenceSubstitution(
  visit: PilotVisit,
  assignment: Awaited<ReturnType<typeof scheduling.listAssignments>>[number],
) {
  const substitutionReason = 'Synthetic pilot coverage for planned leave';
  const priorSubstitutions = await unitOfWork.transaction(
    { tenantId: PILOT_TENANT_ID },
    (transaction) =>
      transaction
        .select()
        .from(visitSubstitutions)
        .where(
          and(
            eq(visitSubstitutions.tenantId, PILOT_TENANT_ID),
            eq(visitSubstitutions.visitId, visit.id),
            eq(visitSubstitutions.reason, substitutionReason),
          ),
        )
        .limit(1),
  );
  const priorSubstitution = priorSubstitutions[0];
  const absenceEmployeeId = priorSubstitution?.originalEmployeeId ?? assignment.employeeId;

  const absenceWindow = await scheduling.listUnavailability(
    principal,
    absenceEmployeeId,
    new Date(visit.plannedStart.getTime() - 1_000),
    new Date(visit.plannedEnd.getTime() + 1_000),
  );
  let absenceExists = absenceWindow.absences.some(
    (item) =>
      item.startsAt.getTime() === visit.plannedStart.getTime() &&
      item.endsAt.getTime() === visit.plannedEnd.getTime() &&
      item.reason === 'vacation',
  );
  if (!absenceExists) {
    await scheduling.createUnavailability(
      principal,
      {
        employeeId: absenceEmployeeId,
        startsAt: visit.plannedStart,
        endsAt: visit.plannedEnd,
        reason: 'vacation',
        note: 'Synthetic pilot: planned leave coverage.',
      },
      contextFor(visit.organizationId),
      auditContext,
    );
    absenceExists = true;
  }

  if (priorSubstitution?.status === 'confirmed' || priorSubstitution?.status === 'cancelled') {
    return { absenceScenario: absenceExists, substitutionStatus: priorSubstitution.status };
  }

  const candidates = await scheduling.substituteCandidates(principal, visit.id);
  const substituteEmployeeId = priorSubstitution?.substituteEmployeeId ?? candidates[0]?.employeeId;
  if (!substituteEmployeeId) {
    throw new Error(`No eligible substitute is available for pilot visit ${visit.id}`);
  }
  const proposed =
    priorSubstitution ??
    (await scheduling.proposeSubstitution(
      principal,
      visit.id,
      { originalAssignmentId: assignment.id, substituteEmployeeId, reason: substitutionReason },
      contextFor(visit.organizationId),
      auditContext,
    ));
  await scheduling.confirmSubstitution(
    principal,
    proposed.id,
    contextFor(visit.organizationId),
    auditContext,
  );
  return { absenceScenario: absenceExists, substitutionStatus: 'confirmed' as const };
}

function assertPilotConsistency(
  clientCount: number,
  agreementCount: number,
  serviceCount: number,
  fundingSourceCount: number,
  benefitEntitlementCount: number,
  visitSummary: {
    visitCount: number;
    publishedTours: number;
    requiresManualPlacement: number;
    absenceScenario: boolean;
    substitutionStatus: 'confirmed' | 'proposed' | 'cancelled';
  },
): void {
  if (
    clientCount !== CLIENT_COUNT ||
    agreementCount !== CLIENT_COUNT ||
    serviceCount !== SERVICE_DEFINITIONS.length ||
    fundingSourceCount !== 3 ||
    benefitEntitlementCount !== 1 ||
    visitSummary.visitCount !== ACTIVE_CLIENT_COUNT * 8 ||
    visitSummary.publishedTours < 1 ||
    visitSummary.requiresManualPlacement !== 0 ||
    !visitSummary.absenceScenario ||
    visitSummary.substitutionStatus !== 'confirmed'
  ) {
    throw new Error(
      'Pilot consistency check failed; inspect scoped pilot records before reseeding',
    );
  }
}

function recurringWeekdays(
  index: number,
): Array<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday'> {
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
  return [weekdays[index % weekdays.length]!, weekdays[(index + 2) % weekdays.length]!];
}

function timeSlot(index: number): string {
  const startMinutes = 8 * 60 + (clientTimeSlots[index] ?? index % 8) * 75;
  return `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')}`;
}

function timeSlotEnd(index: number): string {
  const endMinutes = 8 * 60 + (clientTimeSlots[index] ?? index % 8) * 75 + 60;
  return `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
}

const clientTimeSlots = assignClientTimeSlots();

function assignClientTimeSlots(): number[] {
  const weekdays = Array.from({ length: ACTIVE_CLIENT_COUNT }, (_, index) =>
    recurringWeekdays(index),
  );
  const assigned: number[] = [];
  for (let index = 0; index < ACTIVE_CLIENT_COUNT; index += 1) {
    const occupied = new Set<number>();
    for (let prior = 0; prior < index; prior += 1) {
      if (weekdays[index]!.some((day) => weekdays[prior]!.includes(day))) {
        occupied.add(assigned[prior]!);
      }
    }
    const slot = Array.from({ length: 8 }, (_, candidate) => candidate).find(
      (candidate) => !occupied.has(candidate),
    );
    if (slot === undefined)
      throw new Error('Pilot weekly visits do not fit the configured time slots');
    assigned.push(slot);
  }
  while (assigned.length < CLIENT_COUNT) assigned.push(0);
  return assigned;
}

function sameWindows(
  actual: readonly { weekday: number; startsAt: string; endsAt: string }[],
  expected: readonly { weekday: number; startsAt: string; endsAt: string }[],
): boolean {
  const normalize = (values: readonly { weekday: number; startsAt: string; endsAt: string }[]) =>
    [...values]
      .map((item) => `${item.weekday}:${item.startsAt}:${item.endsAt}`)
      .sort()
      .join('|');
  return normalize(actual) === normalize(expected);
}

function localDateInBerlin(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function formatEuro(amountCents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    amountCents / 100,
  );
}

function assertLocalDevelopmentDatabase(
  connectionString: string,
  name: string,
  username: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(`${name} must point to the local PostgreSQL development database`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(hostname) ||
    (parsed.port !== '' && parsed.port !== '5432') ||
    decodeURIComponent(parsed.username) !== username ||
    parsed.pathname !== '/care' ||
    /prod|stage|live/i.test(parsed.pathname + parsed.hostname)
  ) {
    throw new Error(
      `${name} must use the local Compose PostgreSQL database care at localhost with user ${username}; no data was changed`,
    );
  }
}

try {
  await objectStorage.check();
  await ensurePilotTenant();
  const tenantRoles = await migrationDatabase.db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.tenant_id', ${PILOT_TENANT_ID}, true)`);
    return seedSystemRoles(transaction, PILOT_TENANT_ID);
  });

  const organization = await ensureOrganization();
  const facility = await ensureFacility(organization.id);
  const teams = await ensureTeams(organization.id, facility.id);
  const employees = await ensureEmployees(organization.id, facility.id, teams);
  const services = await ensureServices(organization.id, facility.id);
  const clients = await ensureClients(organization.id, facility.id);
  const fundingSourceCount = await ensureFundingSources(clients);
  const benefitEntitlementCount = await ensureBenefitScenario(clients);
  const agreements = await ensureAgreements(clients, services);
  const generated = await ensureVisits(agreements, clients, services, employees);
  assertPilotConsistency(
    clients.length,
    agreements.length,
    services.length,
    fundingSourceCount,
    benefitEntitlementCount,
    generated,
  );
  const financialScenario = await ensurePilotFinancialScenario({
    organizationId: organization.id,
    facilityId: facility.id,
    clients,
    caregivers: employees,
    agreements,
    tenantRoles,
    visitId: generated.workflowVisitId,
  });

  process.stdout.write(
    [
      `Synthetic pilot ready: ${PILOT_NAME}`,
      `tenant=${PILOT_TENANT_ID} organization=${organization.id} facility=${facility.id}`,
      `employees=${EMPLOYEE_DEFINITIONS.length} (2 office, ${employees.length} Betreuungskräfte) clients=${clients.length} services=${services.length} agreements=${agreements.length}`,
      `synthetic funding sources=${fundingSourceCount} (eligibility and balances unconfirmed)`,
      `benefit scenario: provisional §45b entitlement=${benefitEntitlementCount}, synthetic external consumption=€25.00`,
      `scheduled visits=${generated.visitCount} generated=${generated.generated} already-existing=${generated.alreadyExisting} manual-placement=${generated.requiresManualPlacement} published-tours=${generated.publishedTours}`,
      `exceptional coverage: absence=${generated.absenceScenario ? 'recorded' : 'missing'} substitution=${generated.substitutionStatus}`,
      `completed synthetic visit=${financialScenario.completedVisitId} service allocation=${formatEuro(financialScenario.externalAllocationCents)} / ${formatEuro(financialScenario.serviceAmountCents)}`,
      `issued invoices=${financialScenario.invoiceCount} (split payer/client); claim=${financialScenario.claimId} synthetic decision and payment recorded locally only`,
      `client self-pay invoice=${formatEuro(financialScenario.clientInvoice.grandTotalCents)} paid=${formatEuro(financialScenario.clientPaidCents)} outstanding=${formatEuro(financialScenario.clientInvoice.outstandingCents ?? 0)}`,
      `Office follow-up tasks=${financialScenario.operationsTaskCount}; seed-only caregiver actor has no sign-in mapping`,
      `scenario clock=${PILOT_REFERENCE_DATE} timezone=${TIMEZONE} roles=${tenantRoles.length}`,
      'No records outside the dedicated pilot tenant were changed.',
    ].join('\n') + '\n',
  );
} finally {
  await applicationDatabase.close();
  await migrationDatabase.close();
}
