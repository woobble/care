import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { qualificationDefinitions } from '@care/employees';
import type { CompetencyOperation } from '@care/permissions';
import {
  professionalCompetencyPolicies,
  professionalCompetencyPolicyRequirements,
  professionalCompetencyPolicyVersions,
} from '../schema';

export type CompetencyPolicyRequirementSnapshot = {
  qualificationDefinitionId: string;
  code: string | null;
  name: string;
  status: 'active' | 'archived';
};

export type CompetencyPolicyVersionSnapshot = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  requirementMode: 'ANY' | 'ALL';
  status: 'draft' | 'active' | 'inactive';
  createdAt: Date;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  requirements: CompetencyPolicyRequirementSnapshot[];
};

export type CompetencyPolicySnapshot = {
  id: string;
  operationKey: CompetencyOperation;
  latestVersion: number;
  versions: CompetencyPolicyVersionSnapshot[];
};

export class CompetencyPolicyRepository {
  async list(
    transaction: DatabaseTransaction,
    tenantId: string,
  ): Promise<CompetencyPolicySnapshot[]> {
    const policies = await transaction
      .select({
        id: professionalCompetencyPolicies.id,
        operationKey: professionalCompetencyPolicies.operationKey,
        latestVersion: professionalCompetencyPolicies.latestVersion,
      })
      .from(professionalCompetencyPolicies)
      .where(eq(professionalCompetencyPolicies.tenantId, tenantId))
      .orderBy(asc(professionalCompetencyPolicies.operationKey));

    if (policies.length === 0) return [];
    const versions = await transaction
      .select({
        id: professionalCompetencyPolicyVersions.id,
        policyId: professionalCompetencyPolicyVersions.policyId,
        version: professionalCompetencyPolicyVersions.version,
        name: professionalCompetencyPolicyVersions.name,
        description: professionalCompetencyPolicyVersions.description,
        requirementMode: professionalCompetencyPolicyVersions.requirementMode,
        status: professionalCompetencyPolicyVersions.status,
        createdAt: professionalCompetencyPolicyVersions.createdAt,
        activatedAt: professionalCompetencyPolicyVersions.activatedAt,
        deactivatedAt: professionalCompetencyPolicyVersions.deactivatedAt,
      })
      .from(professionalCompetencyPolicyVersions)
      .where(
        and(
          eq(professionalCompetencyPolicyVersions.tenantId, tenantId),
          inArray(
            professionalCompetencyPolicyVersions.policyId,
            policies.map((policy) => policy.id),
          ),
        ),
      )
      .orderBy(
        asc(professionalCompetencyPolicyVersions.policyId),
        desc(professionalCompetencyPolicyVersions.version),
      );

    const requirements =
      versions.length === 0
        ? []
        : await transaction
            .select({
              policyVersionId: professionalCompetencyPolicyRequirements.policyVersionId,
              qualificationDefinitionId:
                professionalCompetencyPolicyRequirements.qualificationDefinitionId,
              code: qualificationDefinitions.code,
              name: qualificationDefinitions.name,
              status: qualificationDefinitions.status,
            })
            .from(professionalCompetencyPolicyRequirements)
            .innerJoin(
              qualificationDefinitions,
              and(
                eq(
                  qualificationDefinitions.tenantId,
                  professionalCompetencyPolicyRequirements.tenantId,
                ),
                eq(
                  qualificationDefinitions.id,
                  professionalCompetencyPolicyRequirements.qualificationDefinitionId,
                ),
              ),
            )
            .where(
              and(
                eq(professionalCompetencyPolicyRequirements.tenantId, tenantId),
                inArray(
                  professionalCompetencyPolicyRequirements.policyVersionId,
                  versions.map((version) => version.id),
                ),
              ),
            )
            .orderBy(asc(qualificationDefinitions.name));

    const requirementsByVersion = new Map<string, CompetencyPolicyRequirementSnapshot[]>();
    for (const requirement of requirements) {
      const current = requirementsByVersion.get(requirement.policyVersionId) ?? [];
      current.push({
        qualificationDefinitionId: requirement.qualificationDefinitionId,
        code: requirement.code,
        name: requirement.name,
        status: requirement.status,
      });
      requirementsByVersion.set(requirement.policyVersionId, current);
    }

    return policies.map((policy) => ({
      ...policy,
      versions: versions
        .filter((version) => version.policyId === policy.id)
        .map((version) => ({
          id: version.id,
          version: version.version,
          name: version.name,
          description: version.description,
          requirementMode: version.requirementMode,
          status: version.status,
          createdAt: version.createdAt,
          activatedAt: version.activatedAt,
          deactivatedAt: version.deactivatedAt,
          requirements: requirementsByVersion.get(version.id) ?? [],
        })),
    }));
  }

  async policy(
    transaction: DatabaseTransaction,
    tenantId: string,
    operationKey: CompetencyOperation,
    lock = false,
  ) {
    const query = transaction
      .select({
        id: professionalCompetencyPolicies.id,
        operationKey: professionalCompetencyPolicies.operationKey,
        latestVersion: professionalCompetencyPolicies.latestVersion,
      })
      .from(professionalCompetencyPolicies)
      .where(
        and(
          eq(professionalCompetencyPolicies.tenantId, tenantId),
          eq(professionalCompetencyPolicies.operationKey, operationKey),
        ),
      );
    const [policy] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return policy ?? null;
  }

  async version(
    transaction: DatabaseTransaction,
    tenantId: string,
    policyId: string,
    version: number,
    lock: false | 'share' | 'update' = false,
  ) {
    const query = transaction
      .select({
        id: professionalCompetencyPolicyVersions.id,
        policyId: professionalCompetencyPolicyVersions.policyId,
        operationKey: professionalCompetencyPolicyVersions.operationKey,
        version: professionalCompetencyPolicyVersions.version,
        name: professionalCompetencyPolicyVersions.name,
        description: professionalCompetencyPolicyVersions.description,
        requirementMode: professionalCompetencyPolicyVersions.requirementMode,
        requirementCount: professionalCompetencyPolicyVersions.requirementCount,
        status: professionalCompetencyPolicyVersions.status,
        createdAt: professionalCompetencyPolicyVersions.createdAt,
        activatedAt: professionalCompetencyPolicyVersions.activatedAt,
        deactivatedAt: professionalCompetencyPolicyVersions.deactivatedAt,
      })
      .from(professionalCompetencyPolicyVersions)
      .where(
        and(
          eq(professionalCompetencyPolicyVersions.tenantId, tenantId),
          eq(professionalCompetencyPolicyVersions.policyId, policyId),
          eq(professionalCompetencyPolicyVersions.version, version),
        ),
      );
    if (lock === 'share') return (await query.for('share').limit(1))[0] ?? null;
    if (lock === 'update') return (await query.for('update').limit(1))[0] ?? null;
    return (await query.limit(1))[0] ?? null;
  }

  async activeVersion(
    transaction: DatabaseTransaction,
    tenantId: string,
    operationKey: CompetencyOperation,
  ) {
    const [version] = await transaction
      .select({
        id: professionalCompetencyPolicyVersions.id,
        policyId: professionalCompetencyPolicyVersions.policyId,
        operationKey: professionalCompetencyPolicyVersions.operationKey,
        version: professionalCompetencyPolicyVersions.version,
        requirementMode: professionalCompetencyPolicyVersions.requirementMode,
        requirementCount: professionalCompetencyPolicyVersions.requirementCount,
      })
      .from(professionalCompetencyPolicyVersions)
      .where(
        and(
          eq(professionalCompetencyPolicyVersions.tenantId, tenantId),
          eq(professionalCompetencyPolicyVersions.operationKey, operationKey),
          eq(professionalCompetencyPolicyVersions.status, 'active'),
        ),
      )
      .for('share')
      .limit(1);
    return version ?? null;
  }

  async requirements(transaction: DatabaseTransaction, tenantId: string, policyVersionId: string) {
    return transaction
      .select({
        qualificationDefinitionId:
          professionalCompetencyPolicyRequirements.qualificationDefinitionId,
      })
      .from(professionalCompetencyPolicyRequirements)
      .where(
        and(
          eq(professionalCompetencyPolicyRequirements.tenantId, tenantId),
          eq(professionalCompetencyPolicyRequirements.policyVersionId, policyVersionId),
        ),
      )
      .orderBy(asc(professionalCompetencyPolicyRequirements.qualificationDefinitionId));
  }
}
