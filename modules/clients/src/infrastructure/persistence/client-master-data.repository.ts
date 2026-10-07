import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '@care/database';
import { auditEntries } from '@care/audit';
import {
  clientAddresses,
  clientContactRoles,
  clientContacts,
  clientInsurances,
  pflegegradRecords,
} from '../../schema';
import type {
  ClientAddressSnapshot,
  ClientContactRole,
  ClientContactSnapshot,
  ClientInsuranceSnapshot,
  PflegegradSnapshot,
} from '../../domain/client-master-data';

export interface ClientTimelineRecord {
  id: string;
  actorId: string;
  action: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export class ClientMasterDataRepository {
  async listAddresses(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<ClientAddressSnapshot[]> {
    const rows = await transaction
      .select()
      .from(clientAddresses)
      .where(and(eq(clientAddresses.tenantId, tenantId), eq(clientAddresses.clientId, clientId)))
      .orderBy(
        desc(clientAddresses.isPrimary),
        desc(clientAddresses.validFrom),
        asc(clientAddresses.id),
      );
    return rows.map(toAddress);
  }

  async findAddress(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    addressId: string,
  ): Promise<ClientAddressSnapshot | null> {
    const [row] = await transaction
      .select()
      .from(clientAddresses)
      .where(
        and(
          eq(clientAddresses.tenantId, tenantId),
          eq(clientAddresses.clientId, clientId),
          eq(clientAddresses.id, addressId),
        ),
      )
      .limit(1);
    return row ? toAddress(row) : null;
  }

  async insertAddress(
    transaction: DatabaseTransaction,
    address: ClientAddressSnapshot,
  ): Promise<void> {
    await transaction.insert(clientAddresses).values(toAddressRow(address));
  }

  async updateAddress(
    transaction: DatabaseTransaction,
    address: ClientAddressSnapshot,
  ): Promise<void> {
    await transaction
      .update(clientAddresses)
      .set(toAddressRow(address))
      .where(
        and(
          eq(clientAddresses.tenantId, address.tenantId),
          eq(clientAddresses.clientId, address.clientId),
          eq(clientAddresses.id, address.id),
        ),
      );
  }

  async clearPrimaryAddress(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    exceptId?: string,
  ): Promise<string[]> {
    const filters = [
      eq(clientAddresses.tenantId, tenantId),
      eq(clientAddresses.clientId, clientId),
      eq(clientAddresses.isPrimary, true),
    ];
    if (exceptId) filters.push(ne(clientAddresses.id, exceptId));
    const rows = await transaction
      .update(clientAddresses)
      .set({ isPrimary: false })
      .where(and(...filters))
      .returning({ id: clientAddresses.id });
    return rows.map((row) => row.id);
  }

  async deleteAddress(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    addressId: string,
  ): Promise<void> {
    await transaction
      .delete(clientAddresses)
      .where(
        and(
          eq(clientAddresses.tenantId, tenantId),
          eq(clientAddresses.clientId, clientId),
          eq(clientAddresses.id, addressId),
        ),
      );
  }

  async listContacts(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<ClientContactSnapshot[]> {
    const rows = await transaction
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.tenantId, tenantId), eq(clientContacts.clientId, clientId)))
      .orderBy(asc(clientContacts.lastName), asc(clientContacts.firstName), asc(clientContacts.id));
    if (rows.length === 0) return [];
    const roles = await transaction
      .select()
      .from(clientContactRoles)
      .where(
        and(eq(clientContactRoles.tenantId, tenantId), eq(clientContactRoles.clientId, clientId)),
      );
    const byContact = new Map<string, ClientContactRole[]>();
    for (const role of roles) {
      const current = byContact.get(role.contactId) ?? [];
      current.push(role.role);
      byContact.set(role.contactId, current);
    }
    return rows.map((row) => toContact(row, byContact.get(row.id) ?? []));
  }

  async findContact(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    contactId: string,
  ): Promise<ClientContactSnapshot | null> {
    const contact = await this.listContacts(transaction, tenantId, clientId);
    return contact.find((item) => item.id === contactId) ?? null;
  }

  async insertContact(
    transaction: DatabaseTransaction,
    contact: ClientContactSnapshot,
  ): Promise<Array<{ contactId: string; role: ClientContactRole }>> {
    await transaction.insert(clientContacts).values(toContactRow(contact));
    return this.replaceContactRoles(transaction, contact, []);
  }

  async updateContact(
    transaction: DatabaseTransaction,
    contact: ClientContactSnapshot,
  ): Promise<void> {
    await transaction
      .update(clientContacts)
      .set(toContactRow(contact))
      .where(
        and(
          eq(clientContacts.tenantId, contact.tenantId),
          eq(clientContacts.clientId, contact.clientId),
          eq(clientContacts.id, contact.id),
        ),
      );
  }

  async replaceContactRoles(
    transaction: DatabaseTransaction,
    contact: ClientContactSnapshot,
    previousRoles: readonly ClientContactRole[],
  ): Promise<Array<{ contactId: string; role: ClientContactRole }>> {
    const exclusiveRoles = contact.roles.filter(
      (role) => role === 'primary_contact' || role === 'emergency_contact',
    );
    const displaced = exclusiveRoles.length
      ? await transaction
          .delete(clientContactRoles)
          .where(
            and(
              eq(clientContactRoles.tenantId, contact.tenantId),
              eq(clientContactRoles.clientId, contact.clientId),
              inArray(clientContactRoles.role, exclusiveRoles),
              ne(clientContactRoles.contactId, contact.id),
            ),
          )
          .returning({ contactId: clientContactRoles.contactId, role: clientContactRoles.role })
      : [];
    await transaction
      .delete(clientContactRoles)
      .where(
        and(
          eq(clientContactRoles.tenantId, contact.tenantId),
          eq(clientContactRoles.clientId, contact.clientId),
          eq(clientContactRoles.contactId, contact.id),
        ),
      );
    if (contact.roles.length > 0) {
      await transaction.insert(clientContactRoles).values(
        contact.roles.map((role) => ({
          tenantId: contact.tenantId,
          clientId: contact.clientId,
          contactId: contact.id,
          role,
        })),
      );
    }
    return displaced
      .map((item) => ({ contactId: item.contactId, role: item.role as ClientContactRole }))
      .filter((item) => !previousRoles.includes(item.role));
  }

  async deleteContact(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    contactId: string,
  ): Promise<void> {
    await transaction
      .delete(clientContacts)
      .where(
        and(
          eq(clientContacts.tenantId, tenantId),
          eq(clientContacts.clientId, clientId),
          eq(clientContacts.id, contactId),
        ),
      );
  }

  async listInsurances(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<ClientInsuranceSnapshot[]> {
    const rows = await transaction
      .select()
      .from(clientInsurances)
      .where(and(eq(clientInsurances.tenantId, tenantId), eq(clientInsurances.clientId, clientId)))
      .orderBy(
        desc(clientInsurances.isPrimary),
        desc(clientInsurances.validFrom),
        asc(clientInsurances.id),
      );
    return rows.map(toInsurance);
  }

  async findInsurance(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    insuranceId: string,
  ): Promise<ClientInsuranceSnapshot | null> {
    const [row] = await transaction
      .select()
      .from(clientInsurances)
      .where(
        and(
          eq(clientInsurances.tenantId, tenantId),
          eq(clientInsurances.clientId, clientId),
          eq(clientInsurances.id, insuranceId),
        ),
      )
      .limit(1);
    return row ? toInsurance(row) : null;
  }

  async insertInsurance(
    transaction: DatabaseTransaction,
    insurance: ClientInsuranceSnapshot,
  ): Promise<void> {
    await transaction.insert(clientInsurances).values(toInsuranceRow(insurance));
  }

  async updateInsurance(
    transaction: DatabaseTransaction,
    insurance: ClientInsuranceSnapshot,
  ): Promise<void> {
    await transaction
      .update(clientInsurances)
      .set(toInsuranceRow(insurance))
      .where(
        and(
          eq(clientInsurances.tenantId, insurance.tenantId),
          eq(clientInsurances.clientId, insurance.clientId),
          eq(clientInsurances.id, insurance.id),
        ),
      );
  }

  async clearPrimaryInsurance(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    exceptId?: string,
  ): Promise<string[]> {
    const filters = [
      eq(clientInsurances.tenantId, tenantId),
      eq(clientInsurances.clientId, clientId),
      eq(clientInsurances.isPrimary, true),
    ];
    if (exceptId) filters.push(ne(clientInsurances.id, exceptId));
    const rows = await transaction
      .update(clientInsurances)
      .set({ isPrimary: false })
      .where(and(...filters))
      .returning({ id: clientInsurances.id });
    return rows.map((row) => row.id);
  }

  async listPflegegrade(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ): Promise<PflegegradSnapshot[]> {
    const rows = await transaction
      .select()
      .from(pflegegradRecords)
      .where(
        and(eq(pflegegradRecords.tenantId, tenantId), eq(pflegegradRecords.clientId, clientId)),
      )
      .orderBy(desc(pflegegradRecords.validFrom), asc(pflegegradRecords.id));
    return rows.map(toPflegegrad);
  }

  async findPflegegrad(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    recordId: string,
  ): Promise<PflegegradSnapshot | null> {
    const [row] = await transaction
      .select()
      .from(pflegegradRecords)
      .where(
        and(
          eq(pflegegradRecords.tenantId, tenantId),
          eq(pflegegradRecords.clientId, clientId),
          eq(pflegegradRecords.id, recordId),
        ),
      )
      .limit(1);
    return row ? toPflegegrad(row) : null;
  }

  async insertPflegegrad(
    transaction: DatabaseTransaction,
    record: PflegegradSnapshot,
  ): Promise<void> {
    await transaction.insert(pflegegradRecords).values(toPflegegradRow(record));
  }

  async updatePflegegrad(
    transaction: DatabaseTransaction,
    record: PflegegradSnapshot,
  ): Promise<void> {
    await transaction
      .update(pflegegradRecords)
      .set(toPflegegradRow(record))
      .where(
        and(
          eq(pflegegradRecords.tenantId, record.tenantId),
          eq(pflegegradRecords.clientId, record.clientId),
          eq(pflegegradRecords.id, record.id),
        ),
      );
  }

  async listTimeline(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    limit: number,
  ): Promise<ClientTimelineRecord[]> {
    return transaction
      .select({
        id: auditEntries.id,
        actorId: auditEntries.actorId,
        action: auditEntries.action,
        timestamp: auditEntries.timestamp,
        metadata: auditEntries.metadata,
      })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.tenantId, tenantId),
          or(
            and(eq(auditEntries.resourceType, 'client'), eq(auditEntries.resourceId, clientId)),
            and(
              eq(auditEntries.resourceType, 'service_agreement'),
              sql`${auditEntries.metadata}->>'clientId' = ${clientId}`,
            ),
            and(
              eq(auditEntries.resourceType, 'visit'),
              sql`${auditEntries.metadata}->>'clientId' = ${clientId}`,
              inArray(auditEntries.action, [
                'visit.created',
                'visit.generated',
                'visit.rescheduled',
                'visit.confirmed',
                'visit.unconfirmed',
                'visit.cancelled',
              ]),
            ),
          ),
        ),
      )
      .orderBy(desc(auditEntries.timestamp), desc(auditEntries.id))
      .limit(limit);
  }
}

function toAddress(row: typeof clientAddresses.$inferSelect): ClientAddressSnapshot {
  return {
    ...row,
    addressType: row.addressType,
    countryCode: row.countryCode,
    houseNumber: row.houseNumber,
    addressAddition: row.addressAddition,
    postalCode: row.postalCode,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  };
}

function toAddressRow(address: ClientAddressSnapshot) {
  return {
    id: address.id,
    tenantId: address.tenantId,
    clientId: address.clientId,
    addressType: address.addressType,
    street: address.street,
    houseNumber: address.houseNumber ?? null,
    addressAddition: address.addressAddition ?? null,
    postalCode: address.postalCode ?? null,
    city: address.city,
    countryCode: address.countryCode,
    validFrom: address.validFrom ?? null,
    validUntil: address.validUntil ?? null,
    isPrimary: address.isPrimary,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}

function toContact(
  row: typeof clientContacts.$inferSelect,
  roles: ClientContactRole[],
): ClientContactSnapshot {
  return { ...row, roles };
}

function toContactRow(contact: ClientContactSnapshot) {
  return {
    id: contact.id,
    tenantId: contact.tenantId,
    clientId: contact.clientId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    relationshipType: contact.relationshipType,
    phone: contact.phone ?? null,
    mobile: contact.mobile ?? null,
    email: contact.email ?? null,
    addressStreet: contact.addressStreet ?? null,
    addressHouseNumber: contact.addressHouseNumber ?? null,
    addressAddition: contact.addressAddition ?? null,
    addressPostalCode: contact.addressPostalCode ?? null,
    addressCity: contact.addressCity ?? null,
    addressCountryCode: contact.addressCountryCode ?? null,
    representationType: contact.representationType ?? null,
    representationValidFrom: contact.representationValidFrom ?? null,
    representationValidUntil: contact.representationValidUntil ?? null,
    representationReference: contact.representationReference ?? null,
    notes: contact.notes ?? null,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function toInsurance(row: typeof clientInsurances.$inferSelect): ClientInsuranceSnapshot {
  return { ...row };
}

function toInsuranceRow(insurance: ClientInsuranceSnapshot) {
  return {
    id: insurance.id,
    tenantId: insurance.tenantId,
    clientId: insurance.clientId,
    insuranceType: insurance.insuranceType,
    insurerName: insurance.insurerName,
    insuranceNumber: insurance.insuranceNumber ?? null,
    memberNumber: insurance.memberNumber ?? null,
    validFrom: insurance.validFrom ?? null,
    validUntil: insurance.validUntil ?? null,
    isPrimary: insurance.isPrimary,
    notes: insurance.notes ?? null,
    createdAt: insurance.createdAt,
    updatedAt: insurance.updatedAt,
  };
}

function toPflegegrad(row: typeof pflegegradRecords.$inferSelect): PflegegradSnapshot {
  return { ...row, grade: Number(row.grade) };
}

function toPflegegradRow(record: PflegegradSnapshot) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    clientId: record.clientId,
    grade: record.grade,
    validFrom: record.validFrom,
    validUntil: record.validUntil ?? null,
    decisionDate: record.decisionDate ?? null,
    insurerReference: record.insurerReference ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
