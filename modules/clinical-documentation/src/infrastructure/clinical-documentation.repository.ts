import { and, asc, count, desc, eq, gte, inArray, isNull, lte, notExists } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DatabaseTransaction } from '@care/database';
import { v7 as uuidv7 } from 'uuid';
import {
  validateAssessment,
  validateMeasurement,
  validateNewClinicalRecord,
  validateRiskAssessment,
  validateStructuredObservation,
  type Assessment,
  type AssessmentInput,
  type ClinicalHistoryFilters,
  type ClinicalHistoryPage,
  type ClinicalRecord,
  type ClinicalRecordDetail,
  type Measurement,
  type MeasurementInput,
  type NewClinicalRecord,
  type RiskAssessment,
  type RiskAssessmentInput,
  type RiskType,
  type StructuredObservation,
  type StructuredObservationInput,
  RISK_TYPES,
} from '../domain/clinical-documentation';
import {
  assessments,
  clinicalRecords,
  measurements,
  riskAssessments,
  structuredObservations,
} from '../schema';

type ClinicalRecordRow = typeof clinicalRecords.$inferSelect;
type HistoryCandidatePage = { ids: string[]; total: number };

export class ClinicalDocumentationRepository {
  async recordForUpdate(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
    recordId: string,
    lock = false,
  ): Promise<ClinicalRecordDetail | null> {
    const query = transaction
      .select()
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.tenantId, tenantId),
          eq(clinicalRecords.documentationId, documentationId),
          eq(clinicalRecords.id, recordId),
        ),
      )
      .limit(1);
    const [record] = lock ? await query.for('update') : await query;
    return record ? this.detailForRecord(transaction, record) : null;
  }

  async recordsForDocumentation(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
  ): Promise<ClinicalRecordDetail[]> {
    const roots = await transaction
      .select()
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.tenantId, tenantId),
          eq(clinicalRecords.documentationId, documentationId),
        ),
      )
      .orderBy(asc(clinicalRecords.createdAt), asc(clinicalRecords.id));
    return this.detailsForRecords(transaction, roots);
  }

  async clientHistory(
    transaction: DatabaseTransaction,
    tenantId: string,
    authorizedDocumentationIds: string[],
    filters: ClinicalHistoryFilters,
  ): Promise<ClinicalHistoryPage> {
    if (authorizedDocumentationIds.length === 0) {
      return { items: [], page: filters.page, pageSize: filters.pageSize, total: 0 };
    }

    const currentRisks = filters.kind === 'risk_assessment' && filters.currentOnly === true;
    const offset = (filters.page - 1) * filters.pageSize;
    let candidateIds: string[];
    let total: number;
    if (currentRisks) {
      candidateIds = await this.currentRiskCandidateIds(
        transaction,
        tenantId,
        authorizedDocumentationIds,
        filters.riskType,
      );
      const roots = candidateIds.length
        ? await transaction
            .select()
            .from(clinicalRecords)
            .where(
              and(
                eq(clinicalRecords.tenantId, tenantId),
                inArray(clinicalRecords.id, candidateIds),
              ),
            )
        : [];
      const candidates = await this.detailsForRecords(transaction, roots);
      const now = Date.now();
      const current = candidates.filter(
        (record): record is RiskAssessment =>
          record.kind === 'risk_assessment' &&
          record.correctedByRecordId === null &&
          (record.validUntil === null || record.validUntil.getTime() >= now),
      );
      current.sort(compareHistory);
      total = current.length;
      return {
        items: current.slice(offset, offset + filters.pageSize),
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      };
    }

    const candidatePage = await this.historyCandidatesForKind(
      transaction,
      tenantId,
      authorizedDocumentationIds,
      filters.kind,
      filters,
      filters.pageSize,
      offset,
    );
    candidateIds = candidatePage.ids;
    total = candidatePage.total;
    const roots = candidateIds.length
      ? await transaction
          .select()
          .from(clinicalRecords)
          .where(
            and(eq(clinicalRecords.tenantId, tenantId), inArray(clinicalRecords.id, candidateIds)),
          )
      : [];
    const records = await this.detailsForRecords(transaction, roots);
    records.sort(compareHistory);
    return {
      items: records,
      page: filters.page,
      pageSize: filters.pageSize,
      total,
    };
  }

  private async historyCandidatesForKind(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationIds: string[],
    kind: ClinicalRecord['kind'],
    filters: ClinicalHistoryFilters,
    limit: number,
    offset: number,
  ): Promise<HistoryCandidatePage> {
    const rootConditions = [
      eq(clinicalRecords.tenantId, tenantId),
      inArray(clinicalRecords.documentationId, documentationIds),
      eq(clinicalRecords.kind, kind),
    ];
    switch (kind) {
      case 'measurement': {
        const conditions: SQL[] = [...rootConditions];
        if (filters.measurementType) {
          conditions.push(eq(measurements.measurementType, filters.measurementType));
        }
        if (filters.from) conditions.push(gte(measurements.measuredAt, filters.from));
        if (filters.until) conditions.push(lte(measurements.measuredAt, filters.until));
        const join = and(
          eq(measurements.tenantId, clinicalRecords.tenantId),
          eq(measurements.recordId, clinicalRecords.id),
        )!;
        const where = and(...conditions)!;
        return this.queryCandidatePage(
          () =>
            transaction
              .select({ id: clinicalRecords.id })
              .from(clinicalRecords)
              .innerJoin(measurements, join)
              .where(where)
              .orderBy(
                desc(measurements.measuredAt),
                desc(clinicalRecords.createdAt),
                desc(clinicalRecords.id),
              )
              .limit(limit)
              .offset(offset),
          () =>
            transaction
              .select({ total: count() })
              .from(clinicalRecords)
              .innerJoin(measurements, join)
              .where(where),
        );
      }
      case 'observation': {
        const conditions: SQL[] = [...rootConditions];
        if (filters.observationCategory) {
          conditions.push(eq(structuredObservations.category, filters.observationCategory));
        }
        if (filters.from) conditions.push(gte(structuredObservations.observedAt, filters.from));
        if (filters.until) conditions.push(lte(structuredObservations.observedAt, filters.until));
        const join = and(
          eq(structuredObservations.tenantId, clinicalRecords.tenantId),
          eq(structuredObservations.recordId, clinicalRecords.id),
        )!;
        const where = and(...conditions)!;
        return this.queryCandidatePage(
          () =>
            transaction
              .select({ id: clinicalRecords.id })
              .from(clinicalRecords)
              .innerJoin(structuredObservations, join)
              .where(where)
              .orderBy(
                desc(structuredObservations.observedAt),
                desc(clinicalRecords.createdAt),
                desc(clinicalRecords.id),
              )
              .limit(limit)
              .offset(offset),
          () =>
            transaction
              .select({ total: count() })
              .from(clinicalRecords)
              .innerJoin(structuredObservations, join)
              .where(where),
        );
      }
      case 'assessment': {
        const conditions: SQL[] = [...rootConditions];
        if (filters.assessmentType) {
          conditions.push(eq(assessments.assessmentType, filters.assessmentType));
        }
        if (filters.from) conditions.push(gte(assessments.assessedAt, filters.from));
        if (filters.until) conditions.push(lte(assessments.assessedAt, filters.until));
        const join = and(
          eq(assessments.tenantId, clinicalRecords.tenantId),
          eq(assessments.recordId, clinicalRecords.id),
        )!;
        const where = and(...conditions)!;
        return this.queryCandidatePage(
          () =>
            transaction
              .select({ id: clinicalRecords.id })
              .from(clinicalRecords)
              .innerJoin(assessments, join)
              .where(where)
              .orderBy(
                desc(assessments.assessedAt),
                desc(clinicalRecords.createdAt),
                desc(clinicalRecords.id),
              )
              .limit(limit)
              .offset(offset),
          () =>
            transaction
              .select({ total: count() })
              .from(clinicalRecords)
              .innerJoin(assessments, join)
              .where(where),
        );
      }
      case 'risk_assessment': {
        const conditions: SQL[] = [...rootConditions];
        if (filters.riskType) conditions.push(eq(riskAssessments.riskType, filters.riskType));
        if (filters.from) conditions.push(gte(riskAssessments.assessedAt, filters.from));
        if (filters.until) conditions.push(lte(riskAssessments.assessedAt, filters.until));
        const join = and(
          eq(riskAssessments.tenantId, clinicalRecords.tenantId),
          eq(riskAssessments.recordId, clinicalRecords.id),
        )!;
        const where = and(...conditions)!;
        return this.queryCandidatePage(
          () =>
            transaction
              .select({ id: clinicalRecords.id })
              .from(clinicalRecords)
              .innerJoin(riskAssessments, join)
              .where(where)
              .orderBy(
                desc(riskAssessments.assessedAt),
                desc(clinicalRecords.createdAt),
                desc(clinicalRecords.id),
              )
              .limit(limit)
              .offset(offset),
          () =>
            transaction
              .select({ total: count() })
              .from(clinicalRecords)
              .innerJoin(riskAssessments, join)
              .where(where),
        );
      }
    }
  }

  private async queryCandidatePage(
    selectCandidates: () => Promise<{ id: string }[]>,
    selectTotal: () => Promise<{ total: number }[]>,
  ): Promise<HistoryCandidatePage> {
    const candidates = await selectCandidates();
    const totals = await selectTotal();
    return {
      ids: candidates.map((candidate) => candidate.id),
      total: Number(totals[0]?.total ?? 0),
    };
  }

  private async currentRiskCandidateIds(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationIds: string[],
    riskType?: RiskType,
  ): Promise<string[]> {
    const correctingRecords = alias(clinicalRecords, 'clinical_correctors');
    const notCorrected = notExists(
      transaction
        .select({ id: correctingRecords.id })
        .from(correctingRecords)
        .where(
          and(
            eq(correctingRecords.tenantId, clinicalRecords.tenantId),
            eq(correctingRecords.correctsRecordId, clinicalRecords.id),
          ),
        ),
    );
    const riskTypes = riskType ? [riskType] : RISK_TYPES;
    const result: Array<string | undefined> = [];
    // A transaction owns one PostgreSQL connection, so risk-type reads must stay sequential.
    // oxlint-disable no-await-in-loop
    for (const type of riskTypes) {
      const [record] = await transaction
        .select({ id: clinicalRecords.id })
        .from(clinicalRecords)
        .innerJoin(
          riskAssessments,
          and(
            eq(riskAssessments.tenantId, clinicalRecords.tenantId),
            eq(riskAssessments.recordId, clinicalRecords.id),
          ),
        )
        .where(
          and(
            eq(clinicalRecords.tenantId, tenantId),
            inArray(clinicalRecords.documentationId, documentationIds),
            eq(clinicalRecords.kind, 'risk_assessment'),
            eq(riskAssessments.riskType, type),
            notCorrected,
          ),
        )
        .orderBy(
          desc(riskAssessments.assessedAt),
          desc(clinicalRecords.createdAt),
          desc(clinicalRecords.id),
        )
        .limit(1);
      result.push(record?.id);
    }
    // oxlint-enable no-await-in-loop
    return result.filter((id): id is string => id !== undefined);
  }

  async insertMeasurement(
    transaction: DatabaseTransaction,
    root: NewClinicalRecord & { kind: 'measurement' },
    input: MeasurementInput,
  ): Promise<Measurement> {
    validateMeasurement(input);
    return this.insertTyped(transaction, root, async (record) => {
      await transaction.insert(measurements).values({
        tenantId: record.tenantId,
        recordId: record.id,
        measurementType: input.measurementType,
        value: input.value,
        integerValue: input.integerValue,
        systolic: input.systolic,
        diastolic: input.diastolic,
        unit: input.unit,
        measuredAt: input.measuredAt,
        source: input.source,
        note: input.note ?? null,
      });
    });
  }

  async insertObservation(
    transaction: DatabaseTransaction,
    root: NewClinicalRecord & { kind: 'observation' },
    input: StructuredObservationInput,
  ): Promise<StructuredObservation> {
    validateStructuredObservation(input);
    return this.insertTyped(transaction, root, async (record) => {
      await transaction.insert(structuredObservations).values({
        tenantId: record.tenantId,
        recordId: record.id,
        category: input.category,
        valueCode: input.valueCode ?? null,
        painScore: input.painScore ?? null,
        location: input.location?.trim() || null,
        severity: input.severity ?? null,
        note: input.note ?? null,
        observedAt: input.observedAt,
      });
    });
  }

  async insertAssessment(
    transaction: DatabaseTransaction,
    root: NewClinicalRecord & { kind: 'assessment' },
    input: AssessmentInput,
  ): Promise<Assessment> {
    validateAssessment(input);
    return this.insertTyped(transaction, root, async (record) => {
      await transaction.insert(assessments).values({
        tenantId: record.tenantId,
        recordId: record.id,
        assessmentType: input.assessmentType,
        resultCode: input.resultCode ?? null,
        score: input.score ?? null,
        assessedAt: input.assessedAt,
        validUntil: input.validUntil ?? null,
        note: input.note ?? null,
      });
    });
  }

  async insertRiskAssessment(
    transaction: DatabaseTransaction,
    root: NewClinicalRecord & { kind: 'risk_assessment' },
    input: RiskAssessmentInput,
  ): Promise<RiskAssessment> {
    validateRiskAssessment(input);
    return this.insertTyped(transaction, root, async (record) => {
      await transaction.insert(riskAssessments).values({
        tenantId: record.tenantId,
        recordId: record.id,
        riskType: input.riskType,
        level: input.level,
        assessedAt: input.assessedAt,
        validUntil: input.validUntil ?? null,
        source: input.source,
        note: input.note ?? null,
      });
    });
  }

  async updateMeasurement(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
    recordId: string,
    expectedRecordVersion: number,
    input: MeasurementInput,
  ): Promise<Measurement | null> {
    validateMeasurement(input);
    const record = await this.updateRoot(
      transaction,
      tenantId,
      documentationId,
      recordId,
      expectedRecordVersion,
      'measurement',
    );
    if (!record) return null;
    const [updated] = await transaction
      .update(measurements)
      .set({
        measurementType: input.measurementType,
        value: input.value,
        integerValue: input.integerValue,
        systolic: input.systolic,
        diastolic: input.diastolic,
        unit: input.unit,
        measuredAt: input.measuredAt,
        source: input.source,
        note: input.note ?? null,
      })
      .where(and(eq(measurements.tenantId, tenantId), eq(measurements.recordId, recordId)))
      .returning({ recordId: measurements.recordId });
    return updated ? ((await this.detailForRecord(transaction, record)) as Measurement) : null;
  }

  async updateObservation(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
    recordId: string,
    expectedRecordVersion: number,
    input: StructuredObservationInput,
  ): Promise<StructuredObservation | null> {
    validateStructuredObservation(input);
    const record = await this.updateRoot(
      transaction,
      tenantId,
      documentationId,
      recordId,
      expectedRecordVersion,
      'observation',
    );
    if (!record) return null;
    const [updated] = await transaction
      .update(structuredObservations)
      .set({
        category: input.category,
        valueCode: input.valueCode ?? null,
        painScore: input.painScore ?? null,
        location: input.location?.trim() || null,
        severity: input.severity ?? null,
        note: input.note ?? null,
        observedAt: input.observedAt,
      })
      .where(
        and(
          eq(structuredObservations.tenantId, tenantId),
          eq(structuredObservations.recordId, recordId),
        ),
      )
      .returning({ recordId: structuredObservations.recordId });
    return updated
      ? ((await this.detailForRecord(transaction, record)) as StructuredObservation)
      : null;
  }

  async updateAssessment(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
    recordId: string,
    expectedRecordVersion: number,
    input: AssessmentInput,
  ): Promise<Assessment | null> {
    validateAssessment(input);
    const record = await this.updateRoot(
      transaction,
      tenantId,
      documentationId,
      recordId,
      expectedRecordVersion,
      'assessment',
    );
    if (!record) return null;
    const [updated] = await transaction
      .update(assessments)
      .set({
        assessmentType: input.assessmentType,
        resultCode: input.resultCode ?? null,
        score: input.score ?? null,
        assessedAt: input.assessedAt,
        validUntil: input.validUntil ?? null,
        note: input.note ?? null,
      })
      .where(and(eq(assessments.tenantId, tenantId), eq(assessments.recordId, recordId)))
      .returning({ recordId: assessments.recordId });
    return updated ? ((await this.detailForRecord(transaction, record)) as Assessment) : null;
  }

  async updateRiskAssessment(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
    recordId: string,
    expectedRecordVersion: number,
    input: RiskAssessmentInput,
  ): Promise<RiskAssessment | null> {
    validateRiskAssessment(input);
    const record = await this.updateRoot(
      transaction,
      tenantId,
      documentationId,
      recordId,
      expectedRecordVersion,
      'risk_assessment',
    );
    if (!record) return null;
    const [updated] = await transaction
      .update(riskAssessments)
      .set({
        riskType: input.riskType,
        level: input.level,
        assessedAt: input.assessedAt,
        validUntil: input.validUntil ?? null,
        source: input.source,
        note: input.note ?? null,
      })
      .where(and(eq(riskAssessments.tenantId, tenantId), eq(riskAssessments.recordId, recordId)))
      .returning({ recordId: riskAssessments.recordId });
    return updated ? ((await this.detailForRecord(transaction, record)) as RiskAssessment) : null;
  }

  async delete(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
    recordId: string,
    expectedRecordVersion: number,
  ): Promise<boolean> {
    const [record] = await transaction
      .select()
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.tenantId, tenantId),
          eq(clinicalRecords.documentationId, documentationId),
          eq(clinicalRecords.id, recordId),
          eq(clinicalRecords.version, expectedRecordVersion),
          isNull(clinicalRecords.correctsRecordId),
        ),
      )
      .limit(1)
      .for('update');
    if (!record) return false;

    const childDeleted = await this.deleteTypedRow(transaction, record);
    if (!childDeleted) return false;
    const [deleted] = await transaction
      .delete(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.tenantId, tenantId),
          eq(clinicalRecords.documentationId, documentationId),
          eq(clinicalRecords.id, recordId),
          eq(clinicalRecords.version, expectedRecordVersion),
          isNull(clinicalRecords.correctsRecordId),
        ),
      )
      .returning({ id: clinicalRecords.id });
    return deleted !== undefined;
  }

  private async insertTyped<T extends ClinicalRecordDetail>(
    transaction: DatabaseTransaction,
    root: NewClinicalRecord,
    insertDetail: (record: ClinicalRecordRow) => Promise<unknown>,
  ): Promise<T> {
    validateNewClinicalRecord(root);
    const record = await this.insertRoot(transaction, root);
    await insertDetail(record);
    return (await this.detailForRecord(transaction, record)) as T;
  }

  private async insertRoot(
    transaction: DatabaseTransaction,
    root: NewClinicalRecord,
  ): Promise<ClinicalRecordRow> {
    const now = new Date();
    const [record] = await transaction
      .insert(clinicalRecords)
      .values({
        id: root.id ?? uuidv7(),
        tenantId: root.tenantId,
        clientId: root.clientId,
        documentationId: root.documentationId,
        executionId: root.executionId,
        kind: root.kind,
        recordedByUserId: root.recordedByUserId,
        recordedByEmployeeId: root.recordedByEmployeeId,
        version: 1,
        correctsRecordId: root.correctsRecordId ?? null,
        correctionReason: root.correctionReason ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!record) throw new Error('Clinical record insert returned no row');
    return record;
  }

  private async updateRoot(
    transaction: DatabaseTransaction,
    tenantId: string,
    documentationId: string,
    recordId: string,
    expectedRecordVersion: number,
    kind: ClinicalRecord['kind'],
  ): Promise<ClinicalRecordRow | null> {
    const [record] = await transaction
      .update(clinicalRecords)
      .set({ version: expectedRecordVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(clinicalRecords.tenantId, tenantId),
          eq(clinicalRecords.documentationId, documentationId),
          eq(clinicalRecords.id, recordId),
          eq(clinicalRecords.kind, kind),
          eq(clinicalRecords.version, expectedRecordVersion),
        ),
      )
      .returning();
    return record ?? null;
  }

  private async deleteTypedRow(
    transaction: DatabaseTransaction,
    record: ClinicalRecordRow,
  ): Promise<boolean> {
    let deleted: { recordId: string } | undefined;
    switch (record.kind) {
      case 'measurement':
        [deleted] = await transaction
          .delete(measurements)
          .where(
            and(eq(measurements.tenantId, record.tenantId), eq(measurements.recordId, record.id)),
          )
          .returning({ recordId: measurements.recordId });
        break;
      case 'observation':
        [deleted] = await transaction
          .delete(structuredObservations)
          .where(
            and(
              eq(structuredObservations.tenantId, record.tenantId),
              eq(structuredObservations.recordId, record.id),
            ),
          )
          .returning({ recordId: structuredObservations.recordId });
        break;
      case 'assessment':
        [deleted] = await transaction
          .delete(assessments)
          .where(
            and(eq(assessments.tenantId, record.tenantId), eq(assessments.recordId, record.id)),
          )
          .returning({ recordId: assessments.recordId });
        break;
      case 'risk_assessment':
        [deleted] = await transaction
          .delete(riskAssessments)
          .where(
            and(
              eq(riskAssessments.tenantId, record.tenantId),
              eq(riskAssessments.recordId, record.id),
            ),
          )
          .returning({ recordId: riskAssessments.recordId });
        break;
    }
    return deleted !== undefined;
  }

  private async detailForRecord(
    transaction: DatabaseTransaction,
    record: ClinicalRecordRow,
  ): Promise<ClinicalRecordDetail> {
    const [correction] = await transaction
      .select({ id: clinicalRecords.id })
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.tenantId, record.tenantId),
          eq(clinicalRecords.correctsRecordId, record.id),
        ),
      )
      .limit(1);
    const base = toClinicalRecord(record, correction?.id ?? null);
    switch (record.kind) {
      case 'measurement': {
        const [detail] = await transaction
          .select()
          .from(measurements)
          .where(
            and(eq(measurements.tenantId, record.tenantId), eq(measurements.recordId, record.id)),
          )
          .limit(1);
        if (!detail) throw new Error('Clinical measurement typed row is missing');
        return {
          ...base,
          kind: 'measurement',
          measurementType: detail.measurementType,
          value: detail.value,
          integerValue: detail.integerValue,
          systolic: detail.systolic,
          diastolic: detail.diastolic,
          unit: detail.unit,
          measuredAt: detail.measuredAt,
          source: detail.source,
          note: detail.note,
        };
      }
      case 'observation': {
        const [detail] = await transaction
          .select()
          .from(structuredObservations)
          .where(
            and(
              eq(structuredObservations.tenantId, record.tenantId),
              eq(structuredObservations.recordId, record.id),
            ),
          )
          .limit(1);
        if (!detail) throw new Error('Clinical observation typed row is missing');
        return {
          ...base,
          kind: 'observation',
          category: detail.category,
          valueCode: detail.valueCode as StructuredObservation['valueCode'],
          painScore: detail.painScore,
          location: detail.location,
          severity: detail.severity,
          note: detail.note,
          observedAt: detail.observedAt,
        };
      }
      case 'assessment': {
        const [detail] = await transaction
          .select()
          .from(assessments)
          .where(
            and(eq(assessments.tenantId, record.tenantId), eq(assessments.recordId, record.id)),
          )
          .limit(1);
        if (!detail) throw new Error('Clinical assessment typed row is missing');
        return {
          ...base,
          kind: 'assessment',
          assessmentType: detail.assessmentType,
          resultCode: detail.resultCode,
          score: detail.score,
          assessedAt: detail.assessedAt,
          validUntil: detail.validUntil,
          note: detail.note,
        };
      }
      case 'risk_assessment': {
        const [detail] = await transaction
          .select()
          .from(riskAssessments)
          .where(
            and(
              eq(riskAssessments.tenantId, record.tenantId),
              eq(riskAssessments.recordId, record.id),
            ),
          )
          .limit(1);
        if (!detail) throw new Error('Clinical risk assessment typed row is missing');
        return {
          ...base,
          kind: 'risk_assessment',
          riskType: detail.riskType,
          level: detail.level,
          assessedAt: detail.assessedAt,
          validUntil: detail.validUntil,
          source: detail.source,
          note: detail.note,
        };
      }
    }
  }

  private async detailsForRecords(
    transaction: DatabaseTransaction,
    records: ClinicalRecordRow[],
  ): Promise<ClinicalRecordDetail[]> {
    if (records.length === 0) return [];
    const recordIds = records.map((record) => record.id);
    const measurementRows = await transaction
      .select()
      .from(measurements)
      .where(
        and(
          eq(measurements.tenantId, records[0]!.tenantId),
          inArray(measurements.recordId, recordIds),
        ),
      );
    const observationRows = await transaction
      .select()
      .from(structuredObservations)
      .where(
        and(
          eq(structuredObservations.tenantId, records[0]!.tenantId),
          inArray(structuredObservations.recordId, recordIds),
        ),
      );
    const assessmentRows = await transaction
      .select()
      .from(assessments)
      .where(
        and(
          eq(assessments.tenantId, records[0]!.tenantId),
          inArray(assessments.recordId, recordIds),
        ),
      );
    const riskRows = await transaction
      .select()
      .from(riskAssessments)
      .where(
        and(
          eq(riskAssessments.tenantId, records[0]!.tenantId),
          inArray(riskAssessments.recordId, recordIds),
        ),
      );
    const correctionRows = await transaction
      .select({ id: clinicalRecords.id, correctsRecordId: clinicalRecords.correctsRecordId })
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.tenantId, records[0]!.tenantId),
          inArray(clinicalRecords.correctsRecordId, recordIds),
        ),
      );
    const roots = new Map(records.map((record) => [record.id, record]));
    const correctedBy = new Map(
      correctionRows.map((correction) => [correction.correctsRecordId!, correction.id]),
    );
    const details = new Map<string, ClinicalRecordDetail>();
    for (const detail of measurementRows) {
      const root = roots.get(detail.recordId);
      if (root?.kind !== 'measurement') continue;
      details.set(detail.recordId, {
        ...toClinicalRecord(root, correctedBy.get(root.id) ?? null),
        kind: 'measurement',
        measurementType: detail.measurementType,
        value: detail.value,
        integerValue: detail.integerValue,
        systolic: detail.systolic,
        diastolic: detail.diastolic,
        unit: detail.unit,
        measuredAt: detail.measuredAt,
        source: detail.source,
        note: detail.note,
      });
    }
    for (const detail of observationRows) {
      const root = roots.get(detail.recordId);
      if (root?.kind !== 'observation') continue;
      details.set(detail.recordId, {
        ...toClinicalRecord(root, correctedBy.get(root.id) ?? null),
        kind: 'observation',
        category: detail.category,
        valueCode: detail.valueCode as StructuredObservation['valueCode'],
        painScore: detail.painScore,
        location: detail.location,
        severity: detail.severity,
        note: detail.note,
        observedAt: detail.observedAt,
      });
    }
    for (const detail of assessmentRows) {
      const root = roots.get(detail.recordId);
      if (root?.kind !== 'assessment') continue;
      details.set(detail.recordId, {
        ...toClinicalRecord(root, correctedBy.get(root.id) ?? null),
        kind: 'assessment',
        assessmentType: detail.assessmentType,
        resultCode: detail.resultCode,
        score: detail.score,
        assessedAt: detail.assessedAt,
        validUntil: detail.validUntil,
        note: detail.note,
      });
    }
    for (const detail of riskRows) {
      const root = roots.get(detail.recordId);
      if (root?.kind !== 'risk_assessment') continue;
      details.set(detail.recordId, {
        ...toClinicalRecord(root, correctedBy.get(root.id) ?? null),
        kind: 'risk_assessment',
        riskType: detail.riskType,
        level: detail.level,
        assessedAt: detail.assessedAt,
        validUntil: detail.validUntil,
        source: detail.source,
        note: detail.note,
      });
    }
    return records.map((record) => {
      const detail = details.get(record.id);
      if (!detail) throw new Error(`Clinical record ${record.id} has no typed row`);
      return detail;
    });
  }
}

function toClinicalRecord(
  record: ClinicalRecordRow,
  correctedByRecordId: string | null,
): ClinicalRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    documentationId: record.documentationId,
    executionId: record.executionId,
    kind: record.kind,
    recordedByUserId: record.recordedByUserId,
    recordedByEmployeeId: record.recordedByEmployeeId,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    correctsRecordId: record.correctsRecordId,
    correctionReason: record.correctionReason,
    correctedByRecordId,
  };
}

function clinicalTimestamp(record: ClinicalRecordDetail): Date {
  switch (record.kind) {
    case 'measurement':
      return record.measuredAt;
    case 'observation':
      return record.observedAt;
    case 'assessment':
    case 'risk_assessment':
      return record.assessedAt;
  }
}

function compareHistory(left: ClinicalRecordDetail, right: ClinicalRecordDetail): number {
  return (
    clinicalTimestamp(right).getTime() - clinicalTimestamp(left).getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id.localeCompare(left.id)
  );
}
