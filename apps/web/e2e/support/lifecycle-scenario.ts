import { createHash } from 'node:crypto';

import { v7 as uuidv7 } from 'uuid';
import type { Client } from 'pg';

import {
  cleanupOfficeAdminSession,
  createAuthentikUser,
  required,
  signInWithAuthentik,
  waitForPlatformUser,
} from './office-admin';
import type { OfficeAdminSession } from './office-admin';
import type { Page } from '@playwright/test';
import { dateInBerlin } from './browser';

export interface LifecycleScenario {
  runId: string;
  tenantId: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  employeeId: string;
  employeeName: string;
  clientId: string;
  clientName: string;
  representativeContactId: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  agreementId: string;
  agreementServiceId: string;
  visitId?: string;
  visitServiceId?: string;
  executionId?: string;
  performedServiceId?: string;
  documentationId?: string;
  evidencePackageId?: string;
  fundingSourceId: string;
  entitlementId: string;
}

export interface CaregiverIdentity {
  apiToken: string;
  authentikOrigin: string;
  authentikUserId: number;
  email: string;
  issuer: string;
  membershipId: string;
  password: string;
  platformUserId: string;
  subject: string;
  username: string;
}

export async function createUnlinkedCaregiverIdentity(
  database: Client,
  office: OfficeAdminSession,
  page: Page,
): Promise<CaregiverIdentity> {
  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const username = `caregiver-e2e-${office.runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${uuidv7()}`;
  const authentikUser = await createAuthentikUser(authentikOrigin, apiToken, {
    username,
    name: `Caregiver E2E ${office.runId}`,
    email,
    password,
    emailVerified: true,
  });
  let platformUserId: string | undefined;
  let membershipId: string | undefined;
  try {
    await signInWithAuthentik(page, username, password);
    const provision = await waitForPlatformUser(database, issuer, authentikUser.uuid);
    platformUserId = provision.id;
    const caregiverRole = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Caregiver'",
      [office.tenantId],
    );
    const caregiverRoleId = caregiverRole.rows[0]?.id;
    if (!caregiverRoleId) throw new Error('The tenant has no Caregiver role');
    membershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [membershipId, provision.id, office.tenantId],
      );
      await database.query(
        `INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id)
         VALUES ($1, $2, $3)`,
        [membershipId, office.tenantId, caregiverRoleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $2)`,
        [membershipId, office.tenantId],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    await cleanupOfficeAdminSession(database, {
      apiToken,
      authentikOrigin,
      authentikUserId: authentikUser.pk,
      issuer,
      subject: authentikUser.uuid,
      ...(platformUserId ? { platformUserId } : {}),
      ...(membershipId ? { membershipId } : {}),
    });
    throw error;
  }
  if (!platformUserId || !membershipId) {
    throw new Error('The caregiver identity was not provisioned');
  }
  return {
    apiToken,
    authentikOrigin,
    authentikUserId: authentikUser.pk,
    email,
    issuer,
    membershipId,
    password,
    platformUserId,
    subject: authentikUser.uuid,
    username,
  };
}

export async function cleanupLifecycleScenario(
  database: Client,
  scenario: LifecycleScenario,
  options: { preserveBillingHistory?: boolean } = {},
): Promise<void> {
  if (options.preserveBillingHistory) return;
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [scenario.tenantId]);
    const visitRows = await database.query<{ id: string }>(
      'SELECT id FROM scheduling.visits WHERE tenant_id = $1 AND client_id = $2',
      [scenario.tenantId, scenario.clientId],
    );
    const visitIds = visitRows.rows.map((row) => row.id);
    const executionRows = await database.query<{ id: string }>(
      'SELECT id FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
      [scenario.tenantId, visitIds],
    );
    const executionIds = executionRows.rows.map((row) => row.id);
    const documentationRows = await database.query<{ id: string }>(
      'SELECT id FROM care_documentation.documents WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
      [scenario.tenantId, visitIds],
    );
    const documentationIds = documentationRows.rows.map((row) => row.id);
    const packageRows = await database.query<{ id: string }>(
      'SELECT id FROM service_evidence.evidence_packages WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
      [scenario.tenantId, documentationIds],
    );
    const packageIds = packageRows.rows.map((row) => row.id);
    const resourceIds = [
      scenario.organizationId,
      scenario.facilityId,
      scenario.employeeId,
      scenario.clientId,
      scenario.serviceId,
      scenario.agreementId,
      ...visitIds,
      ...executionIds,
      ...documentationIds,
      ...packageIds,
    ];
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [scenario.tenantId, resourceIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE event ->> 'aggregateId' = ANY($1::text[])`,
      [resourceIds],
    );
    await Promise.all(
      (
        [
          ['service_evidence', 'acknowledgements', 'acknowledgements_append_only'],
          ['service_evidence', 'evidence_packages', 'evidence_packages_immutable'],
          ['care_documentation', 'entries', 'documentation_entries_draft_only'],
          ['care_documentation', 'service_evidence', 'service_evidence_draft_only'],
          ['care_documentation', 'history', 'documentation_history_append_only'],
          ['care_documentation', 'amendments', 'documentation_amendments_append_only'],
          ['visit_execution', 'performed_services', 'performed_services_completed_immutable'],
          ['benefits', 'allocation_buckets', 'benefit_allocation_buckets_immutable'],
          ['benefits', 'ledger_entries', 'benefit_ledger_entries_immutable'],
          ['benefits', 'service_allocations', 'service_allocations_immutable'],
          ['benefits', 'service_allocation_reversals', 'service_allocation_reversals_immutable'],
        ] as const
      ).map(([schema, table, trigger]) =>
        database.query(`ALTER TABLE ${schema}.${table} DISABLE TRIGGER ${trigger}`),
      ),
    );
    if (packageIds.length) {
      await database.query(
        'DELETE FROM service_evidence.acknowledgements WHERE tenant_id = $1 AND evidence_package_id = ANY($2::uuid[])',
        [scenario.tenantId, packageIds],
      );
      await database.query(
        'DELETE FROM service_evidence.evidence_packages WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [scenario.tenantId, packageIds],
      );
    }
    if (documentationIds.length) {
      await database.query(
        'DELETE FROM care_documentation.service_evidence WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
        [scenario.tenantId, documentationIds],
      );
      await database.query(
        'DELETE FROM care_documentation.entries WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
        [scenario.tenantId, documentationIds],
      );
      await database.query(
        'DELETE FROM care_documentation.history WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
        [scenario.tenantId, documentationIds],
      );
      await database.query(
        'DELETE FROM care_documentation.amendments WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
        [scenario.tenantId, documentationIds],
      );
      await database.query(
        'DELETE FROM care_documentation.documents WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [scenario.tenantId, documentationIds],
      );
    }
    if (executionIds.length) {
      await database.query(
        'DELETE FROM visit_execution.performed_services WHERE tenant_id = $1 AND execution_id = ANY($2::uuid[])',
        [scenario.tenantId, executionIds],
      );
      await database.query(
        'DELETE FROM visit_execution.executions WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [scenario.tenantId, executionIds],
      );
    }
    if (visitIds.length) {
      await database.query(
        'DELETE FROM scheduling.visit_assignments WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [scenario.tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visit_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [scenario.tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [scenario.tenantId, visitIds],
      );
    }
    await database.query(
      'DELETE FROM billing.profiles WHERE tenant_id = $1 AND organization_id = $2',
      [scenario.tenantId, scenario.organizationId],
    );
    await database.query(
      'DELETE FROM benefits.ledger_entries WHERE tenant_id = $1 AND client_id = $2',
      [scenario.tenantId, scenario.clientId],
    );
    await database.query(
      'DELETE FROM benefits.allocation_buckets WHERE tenant_id = $1 AND client_id = $2',
      [scenario.tenantId, scenario.clientId],
    );
    await database.query(
      'DELETE FROM benefits.client_entitlements WHERE tenant_id = $1 AND id = $2',
      [scenario.tenantId, scenario.entitlementId],
    );
    await database.query('DELETE FROM benefits.funding_sources WHERE tenant_id = $1 AND id = $2', [
      scenario.tenantId,
      scenario.fundingSourceId,
    ]);
    await database.query(
      'DELETE FROM scheduling.schedule_generations WHERE tenant_id = $1 AND agreement_id = $2',
      [scenario.tenantId, scenario.agreementId],
    );
    await database.query(
      'DELETE FROM service_agreements.agreement_services WHERE tenant_id = $1 AND agreement_id = $2',
      [scenario.tenantId, scenario.agreementId],
    );
    await database.query(
      'DELETE FROM service_agreements.agreements WHERE tenant_id = $1 AND id = $2',
      [scenario.tenantId, scenario.agreementId],
    );
    await database.query(
      'DELETE FROM services.service_prices WHERE tenant_id = $1 AND service_id = $2',
      [scenario.tenantId, scenario.serviceId],
    );
    await database.query(
      'DELETE FROM services.service_availability WHERE tenant_id = $1 AND service_id = $2',
      [scenario.tenantId, scenario.serviceId],
    );
    await database.query(
      'DELETE FROM services.service_definitions WHERE tenant_id = $1 AND id = $2',
      [scenario.tenantId, scenario.serviceId],
    );
    await database.query(
      'DELETE FROM services.service_categories WHERE tenant_id = $1 AND name = $2',
      [scenario.tenantId, `E2E Category ${scenario.runId}`],
    );
    await database.query(
      'DELETE FROM clients.client_contact_roles WHERE tenant_id = $1 AND client_id = $2',
      [scenario.tenantId, scenario.clientId],
    );
    await database.query(
      'DELETE FROM clients.client_contacts WHERE tenant_id = $1 AND client_id = $2',
      [scenario.tenantId, scenario.clientId],
    );
    await database.query(
      'DELETE FROM clients.client_addresses WHERE tenant_id = $1 AND client_id = $2',
      [scenario.tenantId, scenario.clientId],
    );
    await database.query('DELETE FROM clients.clients WHERE tenant_id = $1 AND id = $2', [
      scenario.tenantId,
      scenario.clientId,
    ]);
    await database.query('DELETE FROM employees.employees WHERE tenant_id = $1 AND id = $2', [
      scenario.tenantId,
      scenario.employeeId,
    ]);
    await database.query('DELETE FROM organizations.facilities WHERE tenant_id = $1 AND id = $2', [
      scenario.tenantId,
      scenario.facilityId,
    ]);
    const templateRows = await database.query<{ id: string }>(
      'SELECT id FROM onboarding.checklist_templates WHERE tenant_id = $1 AND organization_id = $2',
      [scenario.tenantId, scenario.organizationId],
    );
    const templateIds = templateRows.rows.map((template) => template.id);
    if (templateIds.length) {
      await database.query(
        'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
        [scenario.tenantId, templateIds],
      );
      await database.query(
        "DELETE FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])",
        [scenario.tenantId, templateIds],
      );
      await database.query(
        'DELETE FROM onboarding.checklist_template_items WHERE tenant_id = $1 AND template_id = ANY($2::uuid[])',
        [scenario.tenantId, templateIds],
      );
      await database.query(
        'DELETE FROM onboarding.checklist_templates WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [scenario.tenantId, templateIds],
      );
    }
    await database.query(
      'DELETE FROM organizations.organizations WHERE tenant_id = $1 AND id = $2',
      [scenario.tenantId, scenario.organizationId],
    );
    await Promise.all(
      (
        [
          ['visit_execution', 'performed_services', 'performed_services_completed_immutable'],
          ['care_documentation', 'amendments', 'documentation_amendments_append_only'],
          ['care_documentation', 'history', 'documentation_history_append_only'],
          ['care_documentation', 'service_evidence', 'service_evidence_draft_only'],
          ['care_documentation', 'entries', 'documentation_entries_draft_only'],
          ['service_evidence', 'evidence_packages', 'evidence_packages_immutable'],
          ['service_evidence', 'acknowledgements', 'acknowledgements_append_only'],
          ['benefits', 'service_allocation_reversals', 'service_allocation_reversals_immutable'],
          ['benefits', 'service_allocations', 'service_allocations_immutable'],
          ['benefits', 'ledger_entries', 'benefit_ledger_entries_immutable'],
          ['benefits', 'allocation_buckets', 'benefit_allocation_buckets_immutable'],
        ] as const
      ).map(([schema, table, trigger]) =>
        database.query(`ALTER TABLE ${schema}.${table} ENABLE TRIGGER ${trigger}`),
      ),
    );
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

export async function cleanupAdmissionCase(
  database: Client,
  tenantId: string,
  caseId: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = $2 OR event -> 'payload' ->> 'caseId' = $2)`,
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_documents WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_tasks WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_communications WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM communications.prospect_interactions WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.checklist_responses WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.assessments WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.transitions WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query('DELETE FROM onboarding.cases WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      caseId,
    ]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

export async function seedLifecycleScenario(
  database: Client,
  office: OfficeAdminSession,
  options: { visit?: 'planned' | 'completed' } = {},
): Promise<LifecycleScenario> {
  const runId = office.runId;
  const now = new Date();
  const organizationId = uuidv7();
  const facilityId = uuidv7();
  const categoryId = uuidv7();
  const serviceId = uuidv7();
  const priceId = uuidv7();
  const employeeId = uuidv7();
  const clientId = uuidv7();
  const addressId = uuidv7();
  const contactId = uuidv7();
  const agreementId = uuidv7();
  const agreementServiceId = uuidv7();
  const fundingSourceId = uuidv7();
  const entitlementId = uuidv7();
  const serviceCode = `E2E-${runId.toUpperCase()}`;
  const serviceName = `E2E Service ${runId}`;
  const organizationName = `E2E Organization ${runId}`;
  const facilityName = `E2E Facility ${runId}`;
  const clientName = `Agreement E2E ${runId}`;
  const employeeName = `E2E ${runId}`;
  const serviceDate = dateInBerlin();

  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [office.tenantId]);
    await database.query(
      `INSERT INTO organizations.organizations
         (id, tenant_id, name, legal_name, address, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        organizationId,
        office.tenantId,
        organizationName,
        `E2E Support Services ${runId}`,
        'E2E Straße 1, 10115 Berlin',
        now,
      ],
    );
    await database.query(
      `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [facilityId, office.tenantId, organizationId, facilityName, now],
    );
    await database.query(
      `INSERT INTO employees.employees (id, tenant_id, first_name, last_name, status, created_at)
       VALUES ($1, $2, 'E2E', $3, 'active', $4)`,
      [employeeId, office.tenantId, runId, now],
    );
    await database.query(
      `INSERT INTO services.service_categories
         (id, tenant_id, name, code, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
      [categoryId, office.tenantId, `E2E Category ${runId}`, `E2E-CAT-${runId}`, now],
    );
    await database.query(
      `INSERT INTO services.service_definitions
         (id, tenant_id, code, name, category_id, unit, default_duration_minutes,
          benefit_category, status, valid_from, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'occurrence', 60, 'other', 'active', $6, $7, $7)`,
      [serviceId, office.tenantId, serviceCode, serviceName, categoryId, serviceDate, now],
    );
    await database.query(
      `INSERT INTO services.service_availability
         (id, tenant_id, service_id, organization_id, facility_id, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $6)`,
      [uuidv7(), office.tenantId, serviceId, organizationId, facilityId, now],
    );
    await database.query(
      `INSERT INTO services.service_prices
         (id, tenant_id, service_id, organization_id, facility_id, price_cents, pricing_unit,
          valid_from, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 4500, 'visit', $6, $7, $8)`,
      [
        priceId,
        office.tenantId,
        serviceId,
        organizationId,
        facilityId,
        serviceDate,
        office.platformUserId,
        now,
      ],
    );
    await database.query(
      `INSERT INTO clients.clients
         (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Agreement', $5, 'active', $6, $6)`,
      [clientId, office.tenantId, organizationId, facilityId, `E2E ${runId}`, now],
    );
    await database.query(
      `INSERT INTO clients.client_addresses
         (id, tenant_id, client_id, address_type, street, house_number, postal_code, city,
          country_code, is_primary, created_at, updated_at)
       VALUES ($1, $2, $3, 'billing', 'E2E Street', '1', '10115', 'Berlin', 'DE', true, $4, $4)`,
      [addressId, office.tenantId, clientId, now],
    );
    await database.query(
      `INSERT INTO clients.client_contacts
         (id, tenant_id, client_id, first_name, last_name, relationship_type,
          representation_type, representation_valid_from, representation_valid_until,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E', 'Representative', 'legal_representative',
               'power_of_attorney', '2000-01-01', '2099-12-31', $4, $4)`,
      [contactId, office.tenantId, clientId, now],
    );
    await database.query(
      `INSERT INTO clients.client_contact_roles (tenant_id, client_id, contact_id, role)
       VALUES ($1, $2, $3, 'legal_representative')`,
      [office.tenantId, clientId, contactId],
    );
    await database.query(
      `INSERT INTO service_agreements.agreements
         (id, tenant_id, client_id, organization_id, facility_id, status, valid_from,
          reference, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $8)`,
      [
        agreementId,
        office.tenantId,
        clientId,
        organizationId,
        facilityId,
        serviceDate,
        `E2E-${runId}`,
        now,
      ],
    );
    await database.query(
      `INSERT INTO service_agreements.agreement_services
         (id, tenant_id, agreement_id, service_definition_id, service_code, service_name,
          service_unit, status, valid_from, quantity, schedule_type, weekdays,
          preferred_time_start, preferred_time_end, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'occurrence', 'active', $7, 1, 'weekly',
               ARRAY['monday', 'wednesday']::text[], '09:00', '10:00', $8, $8)`,
      [
        agreementServiceId,
        office.tenantId,
        agreementId,
        serviceId,
        serviceCode,
        serviceName,
        serviceDate,
        now,
      ],
    );
    await database.query(
      `INSERT INTO benefits.funding_sources
         (id, tenant_id, client_id, source_type, label, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'self_pay', $4, 'active', $5, $6, $6)`,
      [
        fundingSourceId,
        office.tenantId,
        clientId,
        `E2E self pay ${runId}`,
        office.platformUserId,
        now,
      ],
    );
    await database.query(
      `INSERT INTO benefits.client_entitlements
         (id, tenant_id, client_id, benefit_type, funding_source_id, valid_from, status,
          calculation_mode, source, verified_at, version, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'private', $4, $5, 'confirmed', 'manual', 'contract', $6, 1, $7, $6, $6)`,
      [
        entitlementId,
        office.tenantId,
        clientId,
        fundingSourceId,
        serviceDate,
        now,
        office.platformUserId,
      ],
    );
    await database.query(
      `INSERT INTO benefits.allocation_buckets
         (id, tenant_id, client_id, funding_source_id, entitlement_id, benefit_type, origin_period,
          amount_cents, bucket_type, verification_status, source_reference, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'private', date_trunc('month', $6::date)::date,
               10000, 'opening_balance', 'provider_reported', $7, $8, $9)`,
      [
        uuidv7(),
        office.tenantId,
        clientId,
        fundingSourceId,
        entitlementId,
        serviceDate,
        `e2e:${runId}:opening`,
        office.platformUserId,
        now,
      ],
    );
    await database.query(
      `INSERT INTO billing.profiles
         (id, tenant_id, organization_id, bank_account_holder, iban, payment_terms_days, invoice_number_prefix,
          default_currency, tax_treatment, tax_exemption_basis, require_acknowledgement,
          created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 14, 'E2E', 'EUR', 'small_business', '§ 19 UStG', false, $6, $6, $7, $7)`,
      [
        uuidv7(),
        office.tenantId,
        organizationId,
        `E2E Support Services ${runId}`,
        'DE89370400440532013000',
        office.platformUserId,
        now,
      ],
    );

    let visitId: string | undefined;
    let visitServiceId: string | undefined;
    let executionId: string | undefined;
    let performedServiceId: string | undefined;
    let documentationId: string | undefined;
    let evidencePackageId: string | undefined;
    if (options.visit) {
      visitId = uuidv7();
      visitServiceId = uuidv7();
      await database.query(
        `INSERT INTO scheduling.visits
           (id, tenant_id, client_id, organization_id, facility_id, origin, status,
            planned_start, planned_end, timezone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed',
                 ($6::date + time '09:00') AT TIME ZONE 'Europe/Berlin',
                 ($6::date + time '10:00') AT TIME ZONE 'Europe/Berlin',
                 'Europe/Berlin', $7, $7)`,
        [visitId, office.tenantId, clientId, organizationId, facilityId, serviceDate, now],
      );
      await database.query(
        `INSERT INTO scheduling.visit_services
           (id, tenant_id, visit_id, service_definition_id, service_code_snapshot,
            service_name_snapshot, unit_snapshot, planned_quantity, planned_duration_minutes,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'occurrence', 1, 60, $7, $7)`,
        [visitServiceId, office.tenantId, visitId, serviceId, serviceCode, serviceName, now],
      );
      await database.query(
        `INSERT INTO scheduling.visit_assignments
           (id, tenant_id, visit_id, employee_id, status, assigned_at, assigned_by)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [uuidv7(), office.tenantId, visitId, employeeId, now, office.platformUserId],
      );
      if (options.visit === 'completed') {
        executionId = uuidv7();
        performedServiceId = uuidv7();
        documentationId = uuidv7();
        evidencePackageId = uuidv7();
        const scheduledTime = await database.query<{ starts_at: Date }>(
          `SELECT ($1::date + time '09:00') AT TIME ZONE 'Europe/Berlin' AS starts_at`,
          [serviceDate],
        );
        const executionStart = scheduledTime.rows[0]?.starts_at;
        if (!executionStart) throw new Error('The test visit did not receive a planned start time');
        const executionEnd = new Date(executionStart.getTime() + 60 * 60 * 1000);
        await database.query(
          `INSERT INTO visit_execution.executions
             (id, tenant_id, visit_id, status, actual_start, actual_end,
              started_by_employee_id, completed_by_employee_id, version, created_at, updated_at)
           VALUES ($1, $2, $3, 'in_progress', $4, NULL, $5, NULL, 1, $6, $6)`,
          [executionId, office.tenantId, visitId, executionStart, employeeId, now],
        );
        await database.query(
          `INSERT INTO visit_execution.performed_services
             (id, tenant_id, execution_id, visit_id, visit_service_id, service_definition_id,
              service_code_snapshot, service_name_snapshot, unit_snapshot, planned_quantity,
              actual_quantity, status, performed_by_employee_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'occurrence', 1, 1, 'performed', $9, $10, $10)`,
          [
            performedServiceId,
            office.tenantId,
            executionId,
            visitId,
            visitServiceId,
            serviceId,
            serviceCode,
            serviceName,
            employeeId,
            now,
          ],
        );
        await database.query(
          `UPDATE visit_execution.executions
           SET status = 'completed', actual_end = $3, completed_by_employee_id = $4,
               version = 2, updated_at = $5
           WHERE tenant_id = $1 AND id = $2`,
          [office.tenantId, executionId, executionEnd, employeeId, now],
        );
        await database.query(
          `INSERT INTO care_documentation.documents
             (id, tenant_id, visit_id, execution_id, status, created_by_employee_id,
              finalized_by_employee_id, finalized_at, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'draft', $5, NULL, NULL, 1, $6, $6)`,
          [documentationId, office.tenantId, visitId, executionId, employeeId, now],
        );
        await database.query(
          `INSERT INTO care_documentation.service_evidence
             (id, tenant_id, documentation_id, execution_id, performed_service_id,
              status, documented_by_employee_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'documented', $6, $7, $7)`,
          [
            uuidv7(),
            office.tenantId,
            documentationId,
            executionId,
            performedServiceId,
            employeeId,
            now,
          ],
        );
        await database.query(
          `UPDATE care_documentation.documents
           SET status = 'finalized', finalized_by_employee_id = $3, finalized_at = $4,
               version = 2, updated_at = $4
           WHERE tenant_id = $1 AND id = $2`,
          [office.tenantId, documentationId, employeeId, now],
        );
        const snapshot = {
          snapshotVersion: 1,
          tenantId: office.tenantId,
          clientId,
          clientName,
          visitId,
          plannedStart: executionStart.toISOString(),
          timezone: 'Europe/Berlin',
          executionId,
          executionVersion: 2,
          actualStart: executionStart.toISOString(),
          actualEnd: executionEnd.toISOString(),
          documentationId,
          documentationVersion: 2,
          amendmentCount: 0,
          items: [
            {
              performedServiceId,
              serviceCode,
              serviceName,
              unit: 'occurrence',
              plannedQuantity: '1.000',
              actualQuantity: '1.000',
              outcome: 'performed',
              reasonCode: null,
              performedByEmployeeId: employeeId,
              evidenceState: 'documented',
            },
          ],
        } as const;
        const snapshotHash = createHash('sha256')
          .update(canonicalSnapshot(snapshot), 'utf8')
          .digest('hex');
        await database.query(
          `INSERT INTO service_evidence.evidence_packages
             (id, tenant_id, documentation_id, version, documentation_version,
              execution_version, amendment_count, snapshot, snapshot_hash,
              generated_at, created_by_user_id)
           VALUES ($1, $2, $3, 1, 2, 2, 0, $4::jsonb, $5, $6, $7)`,
          [
            evidencePackageId,
            office.tenantId,
            documentationId,
            JSON.stringify(snapshot),
            snapshotHash,
            now,
            office.platformUserId,
          ],
        );
        await database.query(
          `INSERT INTO service_evidence.acknowledgements
             (id, tenant_id, evidence_package_id, evidence_package_hash, client_id,
              signatory_type, signatory_name_snapshot, signatory_capacity, status, method,
              statement_version, statement_text_snapshot, captured_by_employee_id,
              idempotency_key, acknowledged_at, created_at)
           VALUES ($1, $2, $3, $4, $5, 'client', $6, 'client', 'acknowledged',
                   'typed_confirmation', 'de-v1', $7, $8, $9, $10, $10)`,
          [
            uuidv7(),
            office.tenantId,
            evidencePackageId,
            snapshotHash,
            clientId,
            clientName,
            'Ich bestätige, dass mir die aufgeführten Leistungen und Angaben wie dokumentiert vorgelegt wurden.',
            employeeId,
            uuidv7(),
            now,
          ],
        );
      }
    }
    await database.query('COMMIT');
    return {
      runId,
      tenantId: office.tenantId,
      organizationId,
      organizationName,
      facilityId,
      facilityName,
      employeeId,
      employeeName,
      clientId,
      clientName,
      representativeContactId: contactId,
      serviceId,
      serviceCode,
      serviceName,
      agreementId,
      agreementServiceId,
      ...(visitId ? { visitId } : {}),
      ...(visitServiceId ? { visitServiceId } : {}),
      ...(executionId ? { executionId } : {}),
      ...(performedServiceId ? { performedServiceId } : {}),
      ...(documentationId ? { documentationId } : {}),
      ...(evidencePackageId ? { evidencePackageId } : {}),
      fundingSourceId,
      entitlementId,
    };
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

function canonicalSnapshot(snapshot: {
  snapshotVersion: number;
  tenantId: string;
  clientId: string;
  clientName: string;
  visitId: string;
  plannedStart: string;
  timezone: string;
  executionId: string;
  executionVersion: number;
  actualStart: string;
  actualEnd: string;
  documentationId: string;
  documentationVersion: number;
  amendmentCount: number;
  items: readonly {
    performedServiceId: string;
    serviceCode: string;
    serviceName: string;
    unit: string;
    plannedQuantity: string | null;
    actualQuantity: string | null;
    outcome: string;
    reasonCode: string | null;
    performedByEmployeeId: string;
    evidenceState: string;
  }[];
}): string {
  const [item] = snapshot.items;
  if (!item) throw new Error('The evidence snapshot requires a performed service');
  return JSON.stringify({
    snapshotVersion: snapshot.snapshotVersion,
    tenantId: snapshot.tenantId,
    clientId: snapshot.clientId,
    clientName: snapshot.clientName,
    visitId: snapshot.visitId,
    plannedStart: snapshot.plannedStart,
    timezone: snapshot.timezone,
    executionId: snapshot.executionId,
    executionVersion: snapshot.executionVersion,
    actualStart: snapshot.actualStart,
    actualEnd: snapshot.actualEnd,
    documentationId: snapshot.documentationId,
    documentationVersion: snapshot.documentationVersion,
    amendmentCount: snapshot.amendmentCount,
    items: [
      {
        performedServiceId: item.performedServiceId,
        serviceCode: item.serviceCode,
        serviceName: item.serviceName,
        unit: item.unit,
        plannedQuantity: item.plannedQuantity,
        actualQuantity: item.actualQuantity,
        outcome: item.outcome,
        reasonCode: item.reasonCode,
        performedByEmployeeId: item.performedByEmployeeId,
        evidenceState: item.evidenceState,
      },
    ],
  });
}
