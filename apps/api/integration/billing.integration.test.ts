import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, test } from 'bun:test';
import { asUUID } from '@care/contracts';
import { DrizzleAuditWriter } from '@care/audit';
import { createDatabase, createUnitOfWork } from '@care/database';
import { createBenefitsApplicationService } from '@care/benefits';
import {
  ClaimAmountReservedError,
  ClaimNotFoundError,
  ClaimNotReadyError,
  createBillingApplicationService,
  createBillingClaimsApplicationService,
  InvoiceIssuerIncompleteError,
  InvoiceRecipientInvalidError,
} from '@care/billing';
import { createDocumentsApplicationService } from '@care/documents';
import { DrizzleOutboxRepository } from '@care/platform';
import { AuthorizationDeniedError, type AuthorizationPrincipal } from '@care/permissions';
import type { ObjectStorage } from '@care/storage';
import { createServiceEvidenceApplicationService } from '@care/service-evidence';
import { ServicePriceApplicationService } from '@care/services';
import { startCareTestDatabase } from '@care/testing';
import { databaseSchema } from '@app/api/database/schema';

describe('billing PostgreSQL integration', () => {
  test('protects billing scope and preserves reservations, funding, issuance, documents, and payment history', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const applicationDatabase = createDatabase(testDatabase.appUrl, databaseSchema);
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const userId = uuidv7();
    const organizationId = uuidv7();
    const otherOrganizationId = uuidv7();
    const facilityId = uuidv7();
    const otherFacilityId = uuidv7();
    const clientId = uuidv7();
    const otherClientId = uuidv7();
    const employeeId = uuidv7();
    const categoryId = uuidv7();
    const serviceDate = new Date().toISOString().slice(0, 10);
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
          'billing.read',
          'billing.manage',
          'billing.issue',
          'billing.correct',
          'billing.payments.read',
          'billing.payments.manage',
          'billing.settings.manage',
          'service_evidence.read',
          'service_evidence.prepare',
          'documents.generate',
          'documents.read',
          'claims.read',
          'claims.manage',
          'claims.submit',
          'claims.record_decision',
          'claims.reconcile',
          'claims.settings.manage',
        ] as const
      ).map((permission) => ({ permission, scopeType: 'tenant', scopeId: tenantId })),
    };
    const objects = new Map<string, Uint8Array>();
    const storage: ObjectStorage = {
      async put({ key, body }) {
        objects.set(key, new Uint8Array(body));
      },
      async get(key) {
        return objects.get(key) ?? null;
      },
      async delete(key) {
        objects.delete(key);
      },
      async createSignedUrl(key) {
        return `memory://${key}`;
      },
    };
    const audit = new DrizzleAuditWriter();
    const outbox = new DrizzleOutboxRepository(applicationDatabase.db);
    const unitOfWork = createUnitOfWork(applicationDatabase.db);
    const benefits = createBenefitsApplicationService(unitOfWork, audit, outbox);
    const evidence = createServiceEvidenceApplicationService(unitOfWork, audit, outbox, storage);
    const prices = new ServicePriceApplicationService(unitOfWork, audit, outbox);
    const billing = createBillingApplicationService(
      unitOfWork,
      audit,
      outbox,
      storage,
      prices,
      benefits,
      evidence,
    );
    const documents = createDocumentsApplicationService(unitOfWork, audit, outbox, storage);
    const claims = createBillingClaimsApplicationService(
      unitOfWork,
      audit,
      outbox,
      evidence,
      documents,
      storage,
    );

    try {
      await owner.connect();
      await appRole.connect();
      await insertProviderAndClients(owner, {
        tenantId,
        otherTenantId,
        organizationId,
        otherOrganizationId,
        facilityId,
        otherFacilityId,
        clientId,
        otherClientId,
        employeeId,
        categoryId,
        userId,
        now,
      });

      const fixtures: Array<{ key: string; fixture: BillableFixture }> = [];
      for (const item of [
        { key: 'main', amountCents: 10_000 },
        { key: 'small', amountCents: 25_000 },
        { key: 'concurrent', amountCents: 10_000 },
        { key: 'large', amountCents: 25_001 },
      ]) {
        fixtures.push({
          key: item.key,
          fixture: await insertBillableService(owner, {
            tenantId,
            organizationId,
            facilityId,
            clientId,
            employeeId,
            categoryId,
            userId,
            serviceDate,
            amountCents: item.amountCents,
            code: `SERVICE-${item.key.toUpperCase()}`,
            now,
          }),
        });
      }
      const service = Object.fromEntries(
        fixtures.map((item) => [item.key, item.fixture]),
      ) as Record<'main' | 'small' | 'concurrent' | 'large', BillableFixture>;
      for (const { fixture } of fixtures) {
        await evidence.prepare(principal, fixture.visitId, request, {});
      }

      const profileInput = {
        organizationId,
        bankAccountHolder: 'Care Example GmbH',
        iban: 'DE89370400440532013000',
        paymentTermsDays: 14,
        invoiceNumberPrefix: 'CARE',
        defaultCurrency: 'EUR' as const,
        taxTreatment: 'tax_exempt' as const,
        taxExemptionBasis: 'Configured provider tax treatment',
        requireAcknowledgement: false,
        requiredInvoiceFormat: 'pdf' as const,
      };
      const profile = await billing.saveSettings(principal, profileInput, request, {});
      if (!profile) throw new Error('Billing profile was not saved');

      const mainCandidates = await billing.candidates(principal, {
        from: serviceDate,
        until: serviceDate,
        clientId,
      });
      expect(candidateFor(mainCandidates, service.main.performedServiceId)).toMatchObject({
        ready: true,
        remainingBillableAmountCents: 10_000,
      });

      const abandonedDraft = await billing.createDraft(
        principal,
        draftInput(service.main, 6_000),
        request,
        {},
      );
      const reservedCandidates = await billing.candidates(principal, {
        from: serviceDate,
        until: serviceDate,
        clientId,
      });
      expect(candidateFor(reservedCandidates, service.main.performedServiceId)).toMatchObject({
        amountReservedCents: 6_000,
        remainingBillableAmountCents: 4_000,
      });
      await billing.cancelDraft(principal, abandonedDraft.id, request, {});
      const releasedCandidates = await billing.candidates(principal, {
        from: serviceDate,
        until: serviceDate,
        clientId,
      });
      expect(
        candidateFor(releasedCandidates, service.main.performedServiceId)
          .remainingBillableAmountCents,
      ).toBe(10_000);

      const mainDraft = await billing.createDraft(
        principal,
        draftInput(service.main, 6_000),
        request,
        {},
      );
      const mainInvoice = await billing.issueInvoice(
        principal,
        mainDraft.id,
        { expectedVersion: mainDraft.version },
        request,
        {},
      );
      expect(mainInvoice).toMatchObject({ status: 'issued', grandTotalCents: 6_000 });
      const mainInvoiceNumber = mainInvoice.invoiceNumber;
      if (!mainInvoiceNumber) throw new Error('Issued invoice number is missing');
      expect(mainInvoiceNumber).toMatch(/^CARE\d{4}-\d{6}$/);

      const pdf = await billing.getInvoicePdf(principal, mainInvoice.id);
      const storedDocument = await owner.query<{ sha256: string }>(
        `SELECT sha256 FROM billing.invoice_documents
         WHERE tenant_id = $1 AND invoice_id = $2 AND correction_id IS NULL AND status = 'ready'`,
        [tenantId, mainInvoice.id],
      );
      const storedSha256 = storedDocument.rows[0]?.sha256;
      if (!storedSha256) throw new Error('Issued invoice document hash is missing');
      expect(createHash('sha256').update(pdf.bytes).digest('hex')).toBe(storedSha256);
      const deniedPrincipal: AuthorizationPrincipal = {
        userId: uuidv7(),
        tenantId,
        grants: [],
      };
      await expect(billing.getInvoicePdf(deniedPrincipal, mainInvoice.id)).rejects.toBeInstanceOf(
        AuthorizationDeniedError,
      );

      const fundingSourceId = uuidv7();
      const fundingAllocationId = uuidv7();
      await owner.query(
        `INSERT INTO benefits.funding_sources
           (id, tenant_id, client_id, source_type, label, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'other', 'Integration payer source', 'active', $4, $5, $5)`,
        [fundingSourceId, tenantId, clientId, userId, now],
      );
      await owner.query(
        `INSERT INTO benefits.service_allocations
           (id, tenant_id, client_id, performed_service_id, funding_source_id, idempotency_key,
            service_amount_cents, amount_cents, price_cents_snapshot, pricing_unit_snapshot,
            actual_quantity_snapshot, status, recorded_by, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, 10000, 10000, 10000, 'hour', '1', 'confirmed', $7, $8)`,
        [
          fundingAllocationId,
          tenantId,
          clientId,
          service.main.performedServiceId,
          fundingSourceId,
          uuidv7(),
          userId,
          now,
        ],
      );

      const postAllocationCandidates = await billing.candidates(principal, {
        from: serviceDate,
        until: serviceDate,
        clientId,
      });
      expect(candidateFor(postAllocationCandidates, service.main.performedServiceId)).toMatchObject(
        {
          sourceKey: `allocation:${fundingAllocationId}`,
          amountCents: 10_000,
          remainingBillableAmountCents: 4_000,
          recommendedRecipient: 'client',
        },
      );
      await expect(
        billing.createDraft(
          principal,
          {
            ...draftInput(service.main, 3_000, fundingAllocationId),
            recipientType: 'payer',
            payerArrangementId: uuidv7(),
          },
          request,
          {},
        ),
      ).rejects.toBeInstanceOf(InvoiceRecipientInvalidError);

      const payer = await claims.createPayer(
        principal,
        {
          organizationId,
          payerType: 'other',
          name: 'Integration payer',
          status: 'active',
          validFrom: serviceDate,
        },
        request,
        {},
      );
      const payerProfile = await claims.savePayerProfile(
        principal,
        {
          organizationId,
          payerId: payer.id,
          channel: 'manual_portal',
          fundingSourceType: 'other',
          validFrom: serviceDate,
          sourceName: 'Integration requirements',
          sourceVersion: '1.0',
          sourceEffectiveDate: serviceDate,
          requiresClientInsuranceNumber: false,
          requiresPayerIdentifier: false,
          requiresAcknowledgement: false,
          requiresMandate: true,
          requiresInvoicePdf: true,
          requiresEvidencePdf: true,
          requiresMandateDocument: false,
          requiresExternalReference: true,
          requiresProviderRecognition: false,
          expectedVersion: 0,
        },
        request,
        {},
      );

      const arrangement = await billing.createPayerArrangement(
        principal,
        {
          organizationId,
          clientId,
          payerId: payer.id,
          fundingSourceId,
          payerType: 'other',
          payerReference: 'PAYER-REF',
          arrangementType: 'direct_payer_billing',
          recipientType: 'other',
          recipientName: 'Authorized Payer',
          recipientAddress: 'Payer Street 2, 12345 City',
          mandateStatus: 'authorized',
          documentedSource: 'Signed mandate',
          documentedReference: 'MANDATE-1',
          validFrom: serviceDate,
        },
        request,
        {},
      );
      if (!arrangement) throw new Error('Payer arrangement was not saved');
      const payerDraft = await billing.createDraft(
        principal,
        {
          ...draftInput(service.main, 3_000, fundingAllocationId),
          recipientType: 'payer',
          payerArrangementId: arrangement.id,
        },
        request,
        {},
      );
      const payerInvoice = await billing.issueInvoice(
        principal,
        payerDraft.id,
        { expectedVersion: payerDraft.version },
        request,
        {},
      );
      expect(payerInvoice.recipientName).toBe('Authorized Payer');

      const claimInput = {
        invoiceId: payerInvoice.id,
        expectedInvoiceVersion: payerInvoice.version,
        payerArrangementId: arrangement.id,
        payerBillingProfileId: payerProfile.id,
        lines: [{ invoiceLineId: payerInvoice.lines[0]!.id, amountCents: 3_000 }],
      };
      const claim = await claims.createClaim(principal, claimInput, request, {});
      expect(claim.claim).toMatchObject({ status: 'draft', amountCents: 3_000 });
      const deniedClaimPrincipal: AuthorizationPrincipal = {
        userId: uuidv7(),
        tenantId,
        grants: [],
      };
      await expect(claims.getClaim(deniedClaimPrincipal, claim.claim.id)).rejects.toBeInstanceOf(
        AuthorizationDeniedError,
      );
      const otherTenantPrincipal: AuthorizationPrincipal = {
        userId: uuidv7(),
        tenantId: otherTenantId,
        grants: [{ permission: 'claims.read', scopeType: 'tenant', scopeId: otherTenantId }],
      };
      await expect(claims.getClaim(otherTenantPrincipal, claim.claim.id)).rejects.toBeInstanceOf(
        ClaimNotFoundError,
      );

      await owner.query(
        "UPDATE billing.payer_arrangements SET mandate_status = 'pending' WHERE tenant_id = $1 AND id = $2",
        [tenantId, arrangement.id],
      );
      const missingMandate = await claims.readiness(principal, claim.claim.id);
      expect(missingMandate.blockers.map((finding) => finding.code)).toContain('mandate_missing');
      await expect(
        claims.prepare(principal, claim.claim.id, claim.claim.version, request, {}),
      ).rejects.toBeInstanceOf(ClaimNotReadyError);
      await owner.query(
        "UPDATE billing.payer_arrangements SET mandate_status = 'authorized' WHERE tenant_id = $1 AND id = $2",
        [tenantId, arrangement.id],
      );

      const readiness = await claims.readiness(principal, claim.claim.id);
      expect(readiness).toMatchObject({ ready: true, blockers: [] });
      const prepared = await claims.prepare(
        principal,
        claim.claim.id,
        claim.claim.version,
        request,
        {},
      );
      expect(prepared.claim).toMatchObject({ status: 'ready', packageVersion: 1 });
      expect(prepared.packageDocuments.map((document) => document.documentKind)).toEqual(
        expect.arrayContaining(['invoice_pdf', 'evidence_pdf', 'claim_summary']),
      );
      const packageDocument = prepared.packageDocuments[0];
      if (!packageDocument) throw new Error('Claim package document was not generated');
      const downloadedPackageDocument = await claims.downloadPackageDocument(
        principal,
        claim.claim.id,
        packageDocument.id,
        request,
        {},
      );
      expect(createHash('sha256').update(downloadedPackageDocument.bytes).digest('hex')).toBe(
        packageDocument.sha256,
      );

      const submitted = await claims.submit(
        principal,
        claim.claim.id,
        { expectedVersion: prepared.claim.version, externalReference: 'EXTERNAL-CLAIM-1' },
        request,
        {},
      );
      expect(submitted.claim.status).toBe('submitted');
      const claimLine = submitted.lines[0];
      if (!claimLine) throw new Error('Claim line was not persisted');
      const decided = await claims.recordDecision(
        principal,
        claim.claim.id,
        {
          expectedVersion: submitted.claim.version,
          decision: 'partially_accepted',
          decisionDate: serviceDate,
          acceptedCents: 2_000,
          rejectedCents: 1_000,
          reasonCode: 'PARTIAL',
          lines: [{ claimLineId: claimLine.id, acceptedCents: 2_000, rejectedCents: 1_000 }],
        },
        request,
        {},
      );
      expect(decided.claim.status).toBe('partially_accepted');
      const resubmitted = await claims.resubmit(
        principal,
        claim.claim.id,
        decided.claim.version,
        request,
        {},
      );
      expect(resubmitted.claim).toMatchObject({
        status: 'draft',
        amountCents: 1_000,
        supersedesClaimId: claim.claim.id,
      });
      const claimHistory = await claims.history(principal, claim.claim.id);
      expect(claimHistory.entries.map((entry) => entry.type)).toEqual(
        expect.arrayContaining(['submitted', 'decision', 'resubmitted']),
      );

      const claimPaymentRecord = await billing.recordPayment(
        principal,
        {
          organizationId,
          amountCents: 2_000,
          receivedAt: now.toISOString(),
          method: 'bank_transfer',
          reference: 'CLAIM-PAYMENT-1',
        },
        request,
        {},
      );
      const nonReconciler: AuthorizationPrincipal = {
        ...principal,
        grants: principal.grants.filter((grant) => grant.permission !== 'claims.reconcile'),
      };
      await expect(
        billing.allocatePayment(
          nonReconciler,
          {
            paymentId: claimPaymentRecord.id,
            invoiceId: payerInvoice.id,
            claimId: claim.claim.id,
            amountCents: 2_000,
          },
          request,
          {},
        ),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      const claimPayment = await billing.allocatePayment(
        principal,
        {
          paymentId: claimPaymentRecord.id,
          invoiceId: payerInvoice.id,
          claimId: claim.claim.id,
          amountCents: 2_000,
        },
        request,
        {},
      );
      expect(claimPayment.claimId).toBe(claim.claim.id);
      expect(await claims.paymentSummary(principal, claim.claim.id)).toMatchObject({
        acceptedCents: 2_000,
        paidCents: 2_000,
        unpaidCents: 0,
      });
      await expect(
        billing.reversePaymentAllocation(
          nonReconciler,
          claimPayment.id,
          'Reversal requires claim reconciliation scope',
          request,
          {},
        ),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);

      const splitCandidates = await billing.candidates(principal, {
        from: serviceDate,
        until: serviceDate,
        clientId,
      });
      expect(
        candidateFor(splitCandidates, service.main.performedServiceId).remainingBillableAmountCents,
      ).toBe(1_000);

      const smallDraft = await billing.createDraft(
        principal,
        draftInput(service.small, 25_000),
        request,
        {},
      );
      const concurrentDraft = await billing.createDraft(
        principal,
        draftInput(service.concurrent, 10_000),
        request,
        {},
      );
      const concurrentlyIssued = await Promise.all([
        billing.issueInvoice(
          principal,
          smallDraft.id,
          { expectedVersion: smallDraft.version },
          request,
          {},
        ),
        billing.issueInvoice(
          principal,
          concurrentDraft.id,
          { expectedVersion: concurrentDraft.version },
          request,
          {},
        ),
      ]);
      expect(concurrentlyIssued[0]?.grandTotalCents).toBe(25_000);
      expect(new Set(concurrentlyIssued.map((invoice) => invoice.invoiceNumber)).size).toBe(2);

      const largeDraft = await billing.createDraft(
        principal,
        draftInput(service.large, 25_001),
        request,
        {},
      );
      await expect(
        billing.issueInvoice(
          principal,
          largeDraft.id,
          { expectedVersion: largeDraft.version },
          request,
          {},
        ),
      ).rejects.toBeInstanceOf(InvoiceIssuerIncompleteError);
      const taxedProfile = await billing.saveSettings(
        principal,
        {
          ...profileInput,
          taxNumber: '12/345/67890',
          expectedVersion: profile.version,
        },
        request,
        {},
      );
      if (!taxedProfile) throw new Error('Tax profile update failed');
      expect(taxedProfile.version).toBe(profile.version + 1);
      const largeInvoice = await billing.issueInvoice(
        principal,
        largeDraft.id,
        { expectedVersion: largeDraft.version },
        request,
        {},
      );
      expect(largeInvoice.issuerSnapshot).toMatchObject({ taxNumber: '12/345/67890' });

      const payment = await billing.recordPayment(
        principal,
        {
          organizationId,
          amountCents: 3_000,
          receivedAt: now.toISOString(),
          method: 'bank_transfer',
          reference: 'PAYMENT-1',
        },
        request,
        {},
      );
      const allocation = await billing.allocatePayment(
        principal,
        { paymentId: payment.id, invoiceId: mainInvoice.id, amountCents: 3_000 },
        request,
        {},
      );
      expect((await billing.getInvoice(principal, mainInvoice.id)).receivableStatus).toBe(
        'partially_paid',
      );
      await billing.reversePaymentAllocation(
        principal,
        allocation.id,
        'Recorded against the wrong invoice',
        request,
        {},
      );
      expect((await billing.getInvoice(principal, mainInvoice.id)).receivableStatus).toBe('unpaid');

      const correction = await billing.correctInvoice(
        principal,
        mainInvoice.id,
        {
          reason: 'Service amount corrected to zero',
          lines: [{ invoiceLineId: mainInvoice.lines[0]!.id, amountCents: 6_000 }],
        },
        request,
        {},
      );
      expect(correction.correction.correctionNumber).toMatch(/^CARE-RK-\d{4}-\d{6}$/);
      expect(correction.invoice).toMatchObject({
        status: 'issued',
        receivableStatus: 'corrected',
        outstandingCents: 0,
      });
      const originalPdfAfterCorrection = await billing.getInvoicePdf(principal, mainInvoice.id);
      expect(originalPdfAfterCorrection.bytes).toEqual(pdf.bytes);
      await expect(
        owner.query(
          'UPDATE billing.invoices SET grand_total_cents = grand_total_cents + 1 WHERE id = $1',
          [mainInvoice.id],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        owner.query(
          'UPDATE billing.invoice_lines SET amount_cents = amount_cents + 1 WHERE invoice_id = $1',
          [mainInvoice.id],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      const correctedCandidates = await billing.candidates(principal, {
        from: serviceDate,
        until: serviceDate,
        clientId,
      });
      expect(
        candidateFor(correctedCandidates, service.main.performedServiceId)
          .remainingBillableAmountCents,
      ).toBe(7_000);

      const additionalPayerDraft = await billing.createDraft(
        principal,
        {
          ...draftInput(service.main, 1_000, fundingAllocationId),
          recipientType: 'payer',
          payerArrangementId: arrangement.id,
        },
        request,
        {},
      );
      const additionalPayerInvoice = await billing.issueInvoice(
        principal,
        additionalPayerDraft.id,
        { expectedVersion: additionalPayerDraft.version },
        request,
        {},
      );
      const unconfiguredClaim = await claims.createClaim(
        principal,
        {
          ...claimInput,
          invoiceId: additionalPayerInvoice.id,
          expectedInvoiceVersion: additionalPayerInvoice.version,
          payerBillingProfileId: null,
          lines: [{ invoiceLineId: additionalPayerInvoice.lines[0]!.id, amountCents: 1_000 }],
        },
        request,
        {},
      );
      expect(
        (await claims.readiness(principal, unconfiguredClaim.claim.id)).blockers.map(
          (finding) => finding.code,
        ),
      ).toContain('payer_requirements_unconfigured');
      await claims.cancel(
        principal,
        unconfiguredClaim.claim.id,
        unconfiguredClaim.claim.version,
        request,
        {},
      );
      const concurrentClaims = await Promise.allSettled([
        claims.createClaim(
          principal,
          {
            ...claimInput,
            invoiceId: additionalPayerInvoice.id,
            expectedInvoiceVersion: additionalPayerInvoice.version,
            lines: [{ invoiceLineId: additionalPayerInvoice.lines[0]!.id, amountCents: 1_000 }],
          },
          request,
          {},
        ),
        claims.createClaim(
          principal,
          {
            ...claimInput,
            invoiceId: additionalPayerInvoice.id,
            expectedInvoiceVersion: additionalPayerInvoice.version,
            lines: [{ invoiceLineId: additionalPayerInvoice.lines[0]!.id, amountCents: 1_000 }],
          },
          request,
          {},
        ),
      ]);
      expect(concurrentClaims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failedConcurrentClaim = concurrentClaims.find((result) => result.status === 'rejected');
      expect(failedConcurrentClaim?.status).toBe('rejected');
      if (failedConcurrentClaim?.status !== 'rejected')
        throw new Error('Expected one reserved claim to fail');
      expect(failedConcurrentClaim.reason).toBeInstanceOf(ClaimAmountReservedError);
      const reservedClaim = concurrentClaims.find((result) => result.status === 'fulfilled');
      if (reservedClaim?.status !== 'fulfilled')
        throw new Error('Expected one concurrent claim to succeed');
      await claims.cancel(
        principal,
        reservedClaim.value.claim.id,
        reservedClaim.value.claim.version,
        request,
        {},
      );

      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const visibleInvoices = await appRole.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM billing.invoices',
      );
      expect(visibleInvoices.rows.length).toBeGreaterThan(0);
      expect(visibleInvoices.rows.every((row) => row.tenant_id === tenantId)).toBe(true);
      const visibleClaims = await appRole.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM billing.claims',
      );
      expect(visibleClaims.rows.every((row) => row.tenant_id === tenantId)).toBe(true);
      const hiddenOtherTenantInvoice = await appRole.query(
        'SELECT id FROM billing.invoices WHERE id = $1',
        [
          await insertOtherTenantDraft(owner, {
            otherTenantId,
            otherOrganizationId,
            otherFacilityId,
            otherClientId,
            userId,
            now,
          }),
        ],
      );
      expect(hiddenOtherTenantInvoice.rows).toHaveLength(0);
      await appRole.query('ROLLBACK');

      const auditActions = await owner.query<{ action: string }>(
        'SELECT action FROM audit.audit_entries WHERE tenant_id = $1',
        [tenantId],
      );
      expect(auditActions.rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'billing.profile_updated',
          'invoice.created',
          'invoice.issued',
          'invoice.corrected',
          'payment.recorded',
          'payment.allocated',
          'payment.allocation_reversed',
          'claim.payer_created',
          'claim.payer_profile_versioned',
          'claim.created',
          'claim.prepared',
          'claim.submitted',
          'claim.decision_recorded',
          'claim.resubmitted',
          'claim.cancelled',
          'claim.payment_linked',
        ]),
      );
      const outboxEvents = await owner.query<{ event_type: string }>(
        'SELECT event_type FROM platform.outbox_messages WHERE tenant_id = $1',
        [tenantId],
      );
      expect(outboxEvents.rows.map((row) => row.event_type)).toEqual(
        expect.arrayContaining([
          'claim.payer_created',
          'claim.payer_profile_versioned',
          'claim.created',
          'claim.prepared',
          'claim.submitted',
          'claim.decision_recorded',
          'claim.resubmitted',
          'claim.cancelled',
          'claim.payment_linked',
        ]),
      );
    } finally {
      await appRole.end().catch(() => undefined);
      await applicationDatabase.close();
      await owner.end().catch(() => undefined);
      await testDatabase.container.stop();
    }
  }, 300_000);
});

interface BillableFixture {
  serviceId: string;
  priceId: string;
  visitId: string;
  performedServiceId: string;
  organizationId: string;
  facilityId: string;
  clientId: string;
}

function draftInput(fixture: BillableFixture, amountCents: number, fundingAllocationId?: string) {
  return {
    organizationId: fixture.organizationId,
    facilityId: fixture.facilityId,
    clientId: fixture.clientId,
    recipientType: 'client' as const,
    lines: [
      {
        performedServiceId: fixture.performedServiceId,
        amountCents,
        ...(fundingAllocationId ? { fundingAllocationId } : {}),
      },
    ],
  };
}

function candidateFor<T extends { performedServiceId: string }>(
  items: T[],
  performedServiceId: string,
): T {
  const result = items.find((item) => item.performedServiceId === performedServiceId);
  if (!result) throw new Error(`Missing billing candidate for ${performedServiceId}`);
  return result;
}

async function insertProviderAndClients(
  owner: Client,
  input: {
    tenantId: string;
    otherTenantId: string;
    organizationId: string;
    otherOrganizationId: string;
    facilityId: string;
    otherFacilityId: string;
    clientId: string;
    otherClientId: string;
    employeeId: string;
    categoryId: string;
    userId: string;
    now: Date;
  },
) {
  await owner.query(
    `INSERT INTO organizations.tenants (id, name, slug)
     VALUES ($1, 'Billing tenant', $2), ($3, 'Other billing tenant', $4)`,
    [
      input.tenantId,
      `billing-${input.tenantId}`,
      input.otherTenantId,
      `billing-${input.otherTenantId}`,
    ],
  );
  await owner.query(
    `INSERT INTO organizations.organizations
       (id, tenant_id, name, legal_name, address, created_at, updated_at)
     VALUES
       ($1, $2, 'Care Example', 'Care Example GmbH', 'Example Street 1, 12345 City', $3, $3),
       ($4, $5, 'Other Care Example', 'Other Care Example GmbH', 'Other Street 2, 12345 City', $3, $3)`,
    [
      input.organizationId,
      input.tenantId,
      input.now,
      input.otherOrganizationId,
      input.otherTenantId,
    ],
  );
  await owner.query(
    `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Billing facility', $4, $4), ($5, $6, $7, 'Other facility', $4, $4)`,
    [
      input.facilityId,
      input.tenantId,
      input.organizationId,
      input.now,
      input.otherFacilityId,
      input.otherTenantId,
      input.otherOrganizationId,
    ],
  );
  await owner.query(
    `INSERT INTO clients.clients
       (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, 'Ada', 'Example', 'active', $5, $5),
       ($6, $7, $8, $9, 'Other', 'Client', 'active', $5, $5)`,
    [
      input.clientId,
      input.tenantId,
      input.organizationId,
      input.facilityId,
      input.now,
      input.otherClientId,
      input.otherTenantId,
      input.otherOrganizationId,
      input.otherFacilityId,
    ],
  );
  await owner.query(
    `INSERT INTO clients.client_addresses
       (id, tenant_id, client_id, address_type, street, house_number, postal_code, city,
        country_code, is_primary, created_at, updated_at)
     VALUES ($1, $2, $3, 'billing', 'Example Street', '1', '12345', 'City', 'DE', true, $4, $4)`,
    [uuidv7(), input.tenantId, input.clientId, input.now],
  );
  await owner.query(
    `INSERT INTO employees.employees (id, tenant_id, first_name, last_name, status, created_at)
     VALUES ($1, $2, 'Integration', 'Caregiver', 'active', $3)`,
    [input.employeeId, input.tenantId, input.now],
  );
  await owner.query(
    `INSERT INTO services.service_categories (id, tenant_id, name, status, created_at, updated_at)
     VALUES ($1, $2, 'Betreuung', 'active', $3, $3)`,
    [input.categoryId, input.tenantId, input.now],
  );
}

async function insertBillableService(
  owner: Client,
  input: {
    tenantId: string;
    organizationId: string;
    facilityId: string;
    clientId: string;
    employeeId: string;
    categoryId: string;
    userId: string;
    serviceDate: string;
    amountCents: number;
    code: string;
    now: Date;
  },
): Promise<BillableFixture> {
  const serviceId = uuidv7();
  const priceId = uuidv7();
  const visitId = uuidv7();
  const executionId = uuidv7();
  const performedServiceId = uuidv7();
  const documentationId = uuidv7();
  const actualStart = `${input.serviceDate}T10:00:00.000Z`;
  const actualEnd = `${input.serviceDate}T11:00:00.000Z`;
  await owner.query(
    `INSERT INTO services.service_definitions
       (id, tenant_id, code, name, category_id, unit, benefit_category, status, valid_from, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'hour', 'other', 'active', $6, $7, $7)`,
    [
      serviceId,
      input.tenantId,
      input.code,
      `Service ${input.code}`,
      input.categoryId,
      input.serviceDate,
      input.now,
    ],
  );
  await owner.query(
    `INSERT INTO services.service_prices
       (id, tenant_id, service_id, organization_id, facility_id, price_cents, pricing_unit, valid_from, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'hour', $7, $8, $9)`,
    [
      priceId,
      input.tenantId,
      serviceId,
      input.organizationId,
      input.facilityId,
      input.amountCents,
      input.serviceDate,
      input.userId,
      input.now,
    ],
  );
  await owner.query(
    `INSERT INTO scheduling.visits
       (id, tenant_id, client_id, organization_id, facility_id, origin, status,
        planned_start, planned_end, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed', $6, $7, 'Europe/Berlin', $8, $8)`,
    [
      visitId,
      input.tenantId,
      input.clientId,
      input.organizationId,
      input.facilityId,
      actualStart,
      actualEnd,
      input.now,
    ],
  );
  await owner.query(
    `INSERT INTO visit_execution.executions
       (id, tenant_id, visit_id, status, actual_start, actual_end,
        started_by_employee_id, completed_by_employee_id, version, created_at, updated_at)
     VALUES ($1, $2, $3, 'in_progress', $4, NULL, $5, NULL, 1, $6, $6)`,
    [executionId, input.tenantId, visitId, actualStart, input.employeeId, input.now],
  );
  await owner.query(
    `INSERT INTO visit_execution.performed_services
       (id, tenant_id, execution_id, visit_id, service_definition_id,
        service_code_snapshot, service_name_snapshot, unit_snapshot,
        actual_quantity, status, performed_by_employee_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'hour', '1.000', 'performed', $8, $9, $9)`,
    [
      performedServiceId,
      input.tenantId,
      executionId,
      visitId,
      serviceId,
      input.code,
      `Service ${input.code}`,
      input.employeeId,
      input.now,
    ],
  );
  await owner.query(
    `INSERT INTO care_documentation.documents
       (id, tenant_id, visit_id, execution_id, status, created_by_employee_id,
        finalized_by_employee_id, finalized_at, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'draft', $5, NULL, NULL, 1, $6, $6)`,
    [documentationId, input.tenantId, visitId, executionId, input.employeeId, input.now],
  );
  await owner.query(
    `INSERT INTO care_documentation.service_evidence
       (id, tenant_id, documentation_id, execution_id, performed_service_id,
        status, documented_by_employee_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'documented', $6, $7, $7)`,
    [
      uuidv7(),
      input.tenantId,
      documentationId,
      executionId,
      performedServiceId,
      input.employeeId,
      input.now,
    ],
  );
  await owner.query(
    `UPDATE visit_execution.executions
     SET status = 'completed', actual_end = $3, completed_by_employee_id = $4,
         version = 2, updated_at = $5
     WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, executionId, actualEnd, input.employeeId, input.now],
  );
  await owner.query(
    `UPDATE care_documentation.documents
     SET status = 'finalized', finalized_by_employee_id = $3, finalized_at = $4,
         version = 2, updated_at = $4
     WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, documentationId, input.employeeId, input.now],
  );
  return {
    serviceId,
    priceId,
    visitId,
    performedServiceId,
    organizationId: input.organizationId,
    facilityId: input.facilityId,
    clientId: input.clientId,
  };
}

async function insertOtherTenantDraft(
  owner: Client,
  input: {
    otherTenantId: string;
    otherOrganizationId: string;
    otherFacilityId: string;
    otherClientId: string;
    userId: string;
    now: Date;
  },
): Promise<string> {
  const invoiceId = uuidv7();
  await owner.query(
    `INSERT INTO billing.invoices
       (id, tenant_id, organization_id, facility_id, client_id, recipient_type, currency,
        subtotal_cents, tax_total_cents, grand_total_cents, status, version, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'client', 'EUR', 0, 0, 0, 'draft', 1, $6, $7, $7)`,
    [
      invoiceId,
      input.otherTenantId,
      input.otherOrganizationId,
      input.otherFacilityId,
      input.otherClientId,
      input.userId,
      input.now,
    ],
  );
  return invoiceId;
}
