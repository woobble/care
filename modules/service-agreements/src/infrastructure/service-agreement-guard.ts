import { and, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { agreementServices, agreements } from '../schema';

export interface ServiceAgreementGuards {
  hasActiveForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean>;
  hasActiveForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<boolean>;
  hasActiveForFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean>;
  hasActiveForService(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceDefinitionId: string,
  ): Promise<boolean>;
  hasFutureVisitsForAgreement?(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    after?: Date,
  ): Promise<boolean>;
  hasFutureVisitsOutsideAgreementValidity?(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementId: string,
    validFrom: string,
    validUntil: string | null,
  ): Promise<boolean>;
  hasFutureVisitsForAgreementService?(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementServiceId: string,
  ): Promise<boolean>;
  hasFutureVisitsOutsideAgreementServiceValidity?(
    transaction: DatabaseTransaction,
    tenantId: string,
    agreementServiceId: string,
    validFrom: string | null,
    validUntil: string | null,
  ): Promise<boolean>;
}

export class DrizzleServiceAgreementGuards implements ServiceAgreementGuards {
  async hasActiveForClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: agreements.id })
      .from(agreements)
      .where(
        and(
          eq(agreements.tenantId, tenantId),
          eq(agreements.clientId, clientId),
          eq(agreements.status, 'active'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasActiveForOrganization(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: agreements.id })
      .from(agreements)
      .where(
        and(
          eq(agreements.tenantId, tenantId),
          eq(agreements.organizationId, organizationId),
          eq(agreements.status, 'active'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasActiveForFacility(
    transaction: DatabaseTransaction,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: agreements.id })
      .from(agreements)
      .where(
        and(
          eq(agreements.tenantId, tenantId),
          eq(agreements.facilityId, facilityId),
          eq(agreements.status, 'active'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async hasActiveForService(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceDefinitionId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: agreementServices.id })
      .from(agreementServices)
      .innerJoin(
        agreements,
        and(
          eq(agreements.tenantId, agreementServices.tenantId),
          eq(agreements.id, agreementServices.agreementId),
        ),
      )
      .where(
        and(
          eq(agreementServices.tenantId, tenantId),
          eq(agreementServices.serviceDefinitionId, serviceDefinitionId),
          eq(agreementServices.status, 'active'),
          eq(agreements.status, 'active'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}

export function createServiceAgreementGuards(): ServiceAgreementGuards {
  return new DrizzleServiceAgreementGuards();
}
