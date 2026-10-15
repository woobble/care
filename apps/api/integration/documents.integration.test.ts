import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, test } from 'bun:test';
import { asUUID } from '@care/contracts';
import { DrizzleAuditWriter } from '@care/audit';
import { createDatabase, createUnitOfWork } from '@care/database';
import {
  createDocumentsApplicationService,
  DocumentAccessDeniedError,
  DocumentArtifactIntegrityError,
  DocumentArtifactNotFoundError,
  DocumentGenerationFailedError,
  DocumentLogoInvalidError,
  DocumentTemplateVersionConflictError,
} from '@care/documents';
import { DrizzleOutboxRepository } from '@care/platform';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { ObjectStorage } from '@care/storage';
import { startCareTestDatabase } from '@care/testing';
import { databaseSchema } from '@app/api/database/schema';
import { DocumentsController } from '@app/api/presentation/http/documents.controller';
import type { ApiRequest } from '@app/api/http/request';
import type { FastifyReply } from 'fastify';

describe('documents PostgreSQL integration', () => {
  test('versions templates and stores, scopes, and verifies immutable document artifacts', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const applicationDatabase = createDatabase(testDatabase.appUrl, databaseSchema);
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const organizationId = uuidv7();
    const facilityId = uuidv7();
    const clientId = uuidv7();
    const userId = uuidv7();
    const now = new Date();
    const request = {
      requestId: asUUID(uuidv7()),
      correlationId: asUUID(uuidv7()),
      userId: asUUID(userId),
      tenantId: asUUID(tenantId),
      organizationId: asUUID(organizationId),
    };
    const principal: AuthorizationPrincipal = {
      userId,
      tenantId,
      grants: (
        [
          'documents.generate',
          'documents.read',
          'documents.exports.read',
          'documents.templates.manage',
          'client.read',
          'billing.read',
          'benefits.read',
          'service_evidence.read',
        ] as const
      ).map((permission) => ({ permission, scopeType: 'tenant', scopeId: tenantId })),
    };
    const otherPrincipal: AuthorizationPrincipal = {
      userId: uuidv7(),
      tenantId: otherTenantId,
      grants: (['documents.read', 'service_evidence.read'] as const).map((permission) => ({
        permission,
        scopeType: 'tenant',
        scopeId: otherTenantId,
      })),
    };
    const objects = new Map<string, Uint8Array>();
    let corruptNextReadback = false;
    let corruptedObjectKey: string | null = null;
    const serviceDate = now.toISOString().slice(0, 10);
    const allocationId = uuidv7();
    const invoice = {
      invoiceNumber: 'CARE-2026-001',
      issueDate: serviceDate,
      clientId,
      recipientName: 'Ada Example',
      clientName: 'Ada Example',
      servicePeriodFrom: serviceDate,
      servicePeriodUntil: serviceDate,
      grandTotalCents: 5_200,
      taxTotalCents: 0,
      currency: 'EUR',
      dueDate: serviceDate,
      status: 'issued',
      receivableStatus: 'unpaid',
      outstandingCents: 5_200,
      recipientSnapshot: { payerReference: 'PAYER-1' },
      paymentHistory: [{ reversedAt: null, amountCents: 0 }],
    };
    const invoiceLine = {
      id: uuidv7(),
      serviceDate,
      serviceCodeSnapshot: 'BETREUUNG',
      serviceNameSnapshot: 'Alltagsbegleitung',
      quantity: '1.5',
      unit: 'hour',
      unitPriceCents: 2_000,
      grossCents: 3_000,
      fundingLabelSnapshot: 'Entlastungsbetrag',
      sourceKey: 'private',
    };
    const allocation = {
      allocationId,
      clientId,
      benefitType: 'private',
      fundingSourceId: uuidv7(),
      fundingSourceType: 'self_pay',
      fundingSourceLabel: 'Privat',
      serviceDate,
      performedServiceId: uuidv7(),
      serviceCode: 'BETREUUNG',
      serviceName: 'Alltagsbegleitung',
      amountCents: 4_200,
      verificationStatus: 'confirmed',
      organizationId,
      facilityId,
    };
    const storage: ObjectStorage = {
      async put({ key, body }) {
        objects.set(key, new Uint8Array(body));
        if (corruptNextReadback) {
          corruptNextReadback = false;
          corruptedObjectKey = key;
        }
      },
      async get(key) {
        if (key === corruptedObjectKey) return new Uint8Array([0, 1, 2]);
        return objects.get(key) ?? null;
      },
      async delete(key) {
        objects.delete(key);
      },
      async check() {},
      async createSignedUrl(key) {
        return `memory://${key}`;
      },
    };
    const documents = createDocumentsApplicationService(
      createUnitOfWork(applicationDatabase.db),
      new DrizzleAuditWriter(),
      new DrizzleOutboxRepository(applicationDatabase.db),
      storage,
    );
    const controller = new DocumentsController(
      documents,
      { getPackage: async () => ({ snapshot: { clientId } }) } as never,
      {} as never,
      {
        getBudget: async () => undefined,
        exportAllocations: async () => [allocation],
      } as never,
      {
        exportInvoices: async () => [invoice],
        exportInvoiceLines: async () => [{ invoice, line: invoiceLine }],
        exportReceivables: async () => [invoice],
        invoiceReferencesForAllocations: async () => new Map([[allocationId, 'CARE-2026-001']]),
      } as never,
      { getClaim: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const apiRequest = { principal, context: request, headers: {} } as unknown as ApiRequest;

    try {
      await owner.connect();
      await appRole.connect();
      await owner.query(
        `INSERT INTO organizations.tenants (id, name, slug)
         VALUES ($1, 'Documents tenant', $2), ($3, 'Other documents tenant', $4)`,
        [tenantId, `documents-${tenantId}`, otherTenantId, `documents-${otherTenantId}`],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name, created_at, updated_at)
         VALUES ($1, $2, 'Documents provider', $3, $3)`,
        [organizationId, tenantId, now],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name, created_at, updated_at)
         VALUES ($1, $2, $3, 'Documents facility', $4, $4)`,
        [facilityId, tenantId, organizationId, now],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Ada', 'Example', 'active', $5, $5)`,
        [clientId, tenantId, organizationId, facilityId, now],
      );

      await expect(
        documents.uploadLogo(principal, organizationId, new Uint8Array([0, 1, 2, 3]), request, {}),
      ).rejects.toBeInstanceOf(DocumentLogoInvalidError);
      expect(objects.size).toBe(0);

      const firstTemplate = await documents.saveTemplate(
        principal,
        organizationId,
        'service_evidence',
        { expectedVersion: 0, headerText: 'Provider header', defaultLocale: 'de' },
        request,
        {},
      );
      expect(firstTemplate).toMatchObject({ version: 1, headerText: 'Provider header' });
      const secondTemplate = await documents.saveTemplate(
        principal,
        organizationId,
        'service_evidence',
        { expectedVersion: 1, footerText: 'Provider footer' },
        request,
        {},
      );
      expect(secondTemplate).toMatchObject({ version: 2, headerText: 'Provider header' });
      await expect(
        documents.saveTemplate(
          principal,
          organizationId,
          'service_evidence',
          { expectedVersion: 1, headerText: 'stale update' },
          request,
          {},
        ),
      ).rejects.toBeInstanceOf(DocumentTemplateVersionConflictError);

      const sourceEntityId = uuidv7();
      const input = {
        idempotencyKey: uuidv7(),
        organizationId,
        facilityId,
        clientId,
        documentType: 'service_evidence' as const,
        sourceEntityType: 'evidence_package',
        sourceEntityId,
        sourceReference: 'EVIDENCE-APR-2026',
        sourceVersion: 'v1',
        expectedTemplateVersion: 2,
        locale: 'en' as const,
        payload: {
          documentType: 'service_evidence' as const,
          locale: 'en' as const,
          title: 'Service evidence',
          provider: { name: 'Documents provider', addressLines: ['Example Street 1'] },
          recipient: { name: 'Ada Example', addressLines: ['Example Way 1'] },
          sections: [
            {
              title: 'Performed services',
              columns: ['Date', 'Service'],
              rows: [['2026-10-01', 'Daily support']],
            },
          ],
        },
      };
      const firstArtifact = await documents.generate(principal, input, request, {});
      expect(firstArtifact).toMatchObject({
        title: 'Service evidence',
        sourceReference: 'EVIDENCE-APR-2026',
        status: 'ready',
        documentType: 'service_evidence',
        templateVersion: 2,
        locale: 'en',
      });
      expect(firstArtifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(firstArtifact.sizeBytes).toBeGreaterThan(0);
      expect(await documents.generate(principal, input, request, {})).toEqual(firstArtifact);
      expect((await documents.listArtifacts(principal, { clientId })).items).toHaveLength(1);
      expect(
        (await documents.listArtifacts(principal, { clientId, documentType: 'service_evidence' }))
          .items,
      ).toHaveLength(1);
      expect(await documents.listArtifacts(principal, {})).toMatchObject({
        items: [
          {
            title: 'Service evidence',
            sourceReference: 'EVIDENCE-APR-2026',
            clientName: 'Ada Example',
          },
        ],
        total: 1,
      });
      expect(await documents.listArtifacts(principal, { search: 'Ada Example' })).toMatchObject({
        items: [{ id: firstArtifact.id, clientName: 'Ada Example' }],
        total: 1,
      });
      expect(
        await documents.listArtifacts(principal, {
          search: 'EVIDENCE-APR-2026',
          status: 'ready',
          sourceEntityType: 'evidence_package',
          sourceEntityId,
        }),
      ).toMatchObject({ items: [{ id: firstArtifact.id }], total: 1 });
      const documentsOnlyPrincipal: AuthorizationPrincipal = {
        userId: uuidv7(),
        tenantId,
        grants: [{ permission: 'documents.read', scopeType: 'tenant', scopeId: tenantId }],
      };
      expect(await documents.listArtifacts(documentsOnlyPrincipal, { clientId })).toMatchObject({
        items: [],
        total: 0,
      });

      const downloadable = await documents.download(principal, firstArtifact.id, request, {});
      expect(new TextDecoder().decode(downloadable.bytes.slice(0, 4))).toBe('%PDF');
      expect(downloadable.fileName).toMatch(/^service-evidence-\d{8}\.pdf$/);
      expect(downloadable.fileName).not.toContain(firstArtifact.id);
      const apiList = await controller.list(apiRequest, {
        clientId,
        documentType: 'service_evidence',
        page: '1',
        pageSize: '25',
      });
      expect(apiList.items).toHaveLength(1);
      const responseState: { statusCode?: number; headers: Record<string, string>; body?: Buffer } =
        {
          headers: {},
        };
      const response = {
        code(status: number) {
          responseState.statusCode = status;
          return this;
        },
        type(value: string) {
          responseState.headers['Content-Type'] = value;
          return this;
        },
        header(name: string, value: string) {
          responseState.headers[name] = value;
          return this;
        },
        send(value: Buffer) {
          responseState.body = value;
          return this;
        },
      } as unknown as FastifyReply;
      await controller.download(apiRequest, firstArtifact.id, response);
      expect(responseState.statusCode).toBe(200);
      expect(responseState.headers['Content-Type']).toBe('application/pdf');
      expect(responseState.body?.subarray(0, 4).toString()).toBe('%PDF');

      const exportFilters = {
        from: serviceDate,
        until: serviceDate,
        organizationId,
        facilityId,
        clientId,
      };
      const invoiceCsv = responseCapture();
      await controller.exportInvoices(apiRequest, exportFilters, invoiceCsv.response);
      expect(invoiceCsv.state.headers['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(invoiceCsv.state.headers['Content-Disposition']).toContain('billing_invoices_v1');
      expect(invoiceCsv.state.body?.toString()).toContain('CARE-2026-001');
      expect(invoiceCsv.state.body?.toString()).toContain('52.00');

      const lineCsv = responseCapture();
      await controller.exportInvoiceLines(apiRequest, exportFilters, lineCsv.response);
      expect(lineCsv.state.body?.toString()).toContain('BETREUUNG');
      expect(lineCsv.state.body?.toString()).toContain('20.00');
      expect(lineCsv.state.body?.toString()).toContain('30.00');

      const receivableCsv = responseCapture();
      await controller.exportReceivables(apiRequest, exportFilters, receivableCsv.response);
      expect(receivableCsv.state.headers['Content-Disposition']).toContain(
        'billing_receivables_v1',
      );
      expect(receivableCsv.state.body?.toString()).toContain('unpaid');

      const allocationCsv = responseCapture();
      await controller.exportBenefitAllocations(apiRequest, exportFilters, allocationCsv.response);
      expect(allocationCsv.state.headers['Content-Disposition']).toContain(
        'benefit_allocations_v1',
      );
      expect(allocationCsv.state.body?.toString()).toContain('42.00');
      expect(allocationCsv.state.body?.toString()).toContain('CARE-2026-001');

      const exportAudit = await owner.query<{ action: string }>(
        "SELECT action FROM audit.audit_entries WHERE tenant_id = $1 AND resource_type = 'data_export'",
        [tenantId],
      );
      expect(exportAudit.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining(['billing.export_generated', 'benefits.export_generated']),
      );
      const noSourcePermission: AuthorizationPrincipal = {
        ...principal,
        grants: principal.grants.filter((grant) => grant.permission !== 'service_evidence.read'),
      };
      await expect(
        documents.download(noSourcePermission, firstArtifact.id, request, {}),
      ).rejects.toBeInstanceOf(DocumentAccessDeniedError);
      await expect(
        documents.artifactForSourceAuthorization(otherPrincipal, firstArtifact.id),
      ).rejects.toBeInstanceOf(DocumentArtifactNotFoundError);

      const secondArtifact = await documents.generate(
        principal,
        { ...input, idempotencyKey: uuidv7(), sourceVersion: 'v2' },
        request,
        {},
      );
      expect(secondArtifact.status).toBe('ready');
      expect(
        (await documents.artifactForSourceAuthorization(principal, firstArtifact.id)).status,
      ).toBe('superseded');

      const secondObjectKey = [...objects.keys()].find((key) =>
        key.endsWith(`${secondArtifact.id}.pdf`),
      );
      if (!secondObjectKey) throw new Error('Generated PDF object is missing');
      objects.set(secondObjectKey, new Uint8Array([0, 1, 2]));
      await expect(
        documents.download(principal, secondArtifact.id, request, {}),
      ).rejects.toBeInstanceOf(DocumentArtifactIntegrityError);

      corruptNextReadback = true;
      await expect(
        documents.generate(
          principal,
          { ...input, idempotencyKey: uuidv7(), sourceVersion: 'v3' },
          request,
          {},
        ),
      ).rejects.toBeInstanceOf(DocumentGenerationFailedError);
      expect(corruptedObjectKey).not.toBeNull();
      expect(objects.has(corruptedObjectKey!)).toBe(false);
      expect(
        await documents.listArtifacts(principal, {
          clientId,
          status: 'failed',
          sourceEntityId,
        }),
      ).toMatchObject({ items: [{ status: 'failed' }], total: 1 });

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const tenantArtifacts = await appRole.query<{ id: string }>(
        'SELECT id FROM documents.artifacts WHERE tenant_id = $1',
        [tenantId],
      );
      expect(tenantArtifacts.rows.length).toBe(3);
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      const otherTenantArtifacts = await appRole.query<{ id: string }>(
        'SELECT id FROM documents.artifacts WHERE tenant_id = $1',
        [tenantId],
      );
      expect(otherTenantArtifacts.rows).toEqual([]);
      await appRole.query('COMMIT');
    } finally {
      await appRole.end().catch(() => undefined);
      await applicationDatabase.close();
      await owner.end().catch(() => undefined);
      await testDatabase.container.stop();
    }
  }, 240_000);
});

function responseCapture() {
  const state: { statusCode?: number; headers: Record<string, string>; body?: Buffer } = {
    headers: {},
  };
  const response = {
    code(statusCode: number) {
      state.statusCode = statusCode;
      return this;
    },
    type(value: string) {
      state.headers['Content-Type'] = value;
      return this;
    },
    header(name: string, value: string) {
      state.headers[name] = value;
      return this;
    },
    send(body: Buffer) {
      state.body = body;
      return this;
    },
  } as unknown as FastifyReply;
  return { state, response };
}
