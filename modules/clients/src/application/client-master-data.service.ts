import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { Client } from '../domain/client';
import {
  validateClientAddress,
  validateClientContact,
  validateClientInsurance,
  validatePflegegrad,
  type ClientAddressData,
  type ClientAddressSnapshot,
  type ClientContactData,
  type ClientContactSnapshot,
  type ClientInsuranceData,
  type ClientInsuranceSnapshot,
  type PflegegradData,
  type PflegegradSnapshot,
} from '../domain/client-master-data';
import { authorizeClientResource } from './client-access';
import { appendClientChange } from './client-change';
import { ClientNotFoundError, PflegegradRecordImmutableError } from './errors';
import {
  ClientAddressNotFoundError,
  ClientContactNotFoundError,
  ClientInsuranceNotFoundError,
  OverlappingPflegegradPeriodError,
  PflegegradNotFoundError,
} from '../domain/client-master-data';
import { ClientMasterDataRepository } from '../infrastructure/persistence/client-master-data.repository';
import { ClientRepository } from '../infrastructure/persistence/client.repository';

type AuditContext = { ip?: string; userAgent?: string };

export interface ClientTimelineEntry {
  id: string;
  occurredAt: string;
  actorId: string;
  action: string;
  summary: string;
}

export class ClientMasterDataApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clients: ClientRepository,
    private readonly masterData: ClientMasterDataRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async listAddresses(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'client.read');
      return this.masterData.listAddresses(transaction, principal.tenantId, clientId);
    });
  }

  async addAddress(
    principal: AuthorizationPrincipal,
    clientId: string,
    data: ClientAddressData,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ClientAddressSnapshot> {
    validateClientAddress(data);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const address = this.addressSnapshot(principal.tenantId, clientId, data, now);
      const displaced = data.isPrimary
        ? await this.masterData.clearPrimaryAddress(transaction, principal.tenantId, clientId)
        : [];
      await this.masterData.insertAddress(transaction, address);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.address_added',
        metadata: {
          addressId: address.id,
          isPrimary: address.isPrimary,
          displacedAddressIds: displaced,
        },
        event: createDomainEvent({
          type: 'client.address_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, addressId: address.id, operation: 'added' },
        }),
      });
      return address;
    });
  }

  async updateAddress(
    principal: AuthorizationPrincipal,
    clientId: string,
    addressId: string,
    changes: Partial<ClientAddressData>,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ClientAddressSnapshot> {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const current = await this.masterData.findAddress(
        transaction,
        principal.tenantId,
        clientId,
        addressId,
      );
      if (!current) throw new ClientAddressNotFoundError();
      const address = this.mergeAddress(current, changes, now);
      validateClientAddress(address);
      const changedFields = changedFieldsOf(current, address);
      if (changedFields.length === 0) return current;
      const displaced = address.isPrimary
        ? await this.masterData.clearPrimaryAddress(
            transaction,
            principal.tenantId,
            clientId,
            addressId,
          )
        : [];
      await this.masterData.updateAddress(transaction, address);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.address_updated',
        metadata: { addressId, changedFields, displacedAddressIds: displaced },
        event: createDomainEvent({
          type: 'client.address_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, addressId, operation: 'updated' },
        }),
      });
      return address;
    });
  }

  async removeAddress(
    principal: AuthorizationPrincipal,
    clientId: string,
    addressId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<void> {
    const now = new Date();
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const address = await this.masterData.findAddress(
        transaction,
        principal.tenantId,
        clientId,
        addressId,
      );
      if (!address) throw new ClientAddressNotFoundError();
      await this.masterData.deleteAddress(transaction, principal.tenantId, clientId, addressId);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.address_removed',
        metadata: { addressId, wasPrimary: address.isPrimary },
        event: createDomainEvent({
          type: 'client.address_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, addressId, operation: 'removed' },
        }),
      });
    });
  }

  async listContacts(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'client.read');
      return this.masterData.listContacts(transaction, principal.tenantId, clientId);
    });
  }

  async addContact(
    principal: AuthorizationPrincipal,
    clientId: string,
    data: ClientContactData,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ClientContactSnapshot> {
    validateClientContact(data);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const contact = this.contactSnapshot(principal.tenantId, clientId, data, now);
      const displaced = await this.masterData.insertContact(transaction, contact);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.contact_added',
        metadata: {
          contactId: contact.id,
          roles: contact.roles,
          displacedRoles: displaced,
        },
        event: createDomainEvent({
          type: 'client.contact_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, contactId: contact.id, operation: 'added' },
        }),
      });
      return contact;
    });
  }

  async updateContact(
    principal: AuthorizationPrincipal,
    clientId: string,
    contactId: string,
    changes: Partial<ClientContactData>,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ClientContactSnapshot> {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const current = await this.masterData.findContact(
        transaction,
        principal.tenantId,
        clientId,
        contactId,
      );
      if (!current) throw new ClientContactNotFoundError();
      const contact = this.mergeContact(current, changes, now);
      validateClientContact(contact);
      const changedFields = changedFieldsOf(current, contact);
      if (changedFields.length === 0) return current;
      await this.masterData.updateContact(transaction, contact);
      const displaced = await this.masterData.replaceContactRoles(
        transaction,
        contact,
        current.roles,
      );
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.contact_updated',
        metadata: { contactId, changedFields, displacedRoles: displaced },
        event: createDomainEvent({
          type: 'client.contact_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, contactId, operation: 'updated' },
        }),
      });
      return contact;
    });
  }

  async removeContact(
    principal: AuthorizationPrincipal,
    clientId: string,
    contactId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<void> {
    const now = new Date();
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const contact = await this.masterData.findContact(
        transaction,
        principal.tenantId,
        clientId,
        contactId,
      );
      if (!contact) throw new ClientContactNotFoundError();
      await this.masterData.deleteContact(transaction, principal.tenantId, clientId, contactId);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.contact_removed',
        metadata: { contactId, roles: contact.roles },
        event: createDomainEvent({
          type: 'client.contact_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, contactId, operation: 'removed' },
        }),
      });
    });
  }

  async listInsurances(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'client.read');
      return this.masterData.listInsurances(transaction, principal.tenantId, clientId);
    });
  }

  async addInsurance(
    principal: AuthorizationPrincipal,
    clientId: string,
    data: ClientInsuranceData,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ClientInsuranceSnapshot> {
    validateClientInsurance(data);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const insurance = this.insuranceSnapshot(principal.tenantId, clientId, data, now);
      const previousPrimaryIds = data.isPrimary
        ? await this.masterData.clearPrimaryInsurance(transaction, principal.tenantId, clientId)
        : [];
      await this.masterData.insertInsurance(transaction, insurance);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.insurance_added',
        metadata: { insuranceId: insurance.id, isPrimary: insurance.isPrimary, previousPrimaryIds },
        event: createDomainEvent({
          type: 'client.insurance_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, insuranceId: insurance.id, operation: 'added' },
        }),
      });
      return insurance;
    });
  }

  async updateInsurance(
    principal: AuthorizationPrincipal,
    clientId: string,
    insuranceId: string,
    changes: Partial<ClientInsuranceData>,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<ClientInsuranceSnapshot> {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const current = await this.masterData.findInsurance(
        transaction,
        principal.tenantId,
        clientId,
        insuranceId,
      );
      if (!current) throw new ClientInsuranceNotFoundError();
      const insurance = this.mergeInsurance(current, changes, now);
      validateClientInsurance(insurance);
      const changedFields = changedFieldsOf(current, insurance);
      if (changedFields.length === 0) return current;
      const previousPrimaryIds = insurance.isPrimary
        ? await this.masterData.clearPrimaryInsurance(
            transaction,
            principal.tenantId,
            clientId,
            insuranceId,
          )
        : [];
      await this.masterData.updateInsurance(transaction, insurance);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.insurance_updated',
        metadata: { insuranceId, changedFields, previousPrimaryIds },
        event: createDomainEvent({
          type: 'client.insurance_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, insuranceId, operation: 'updated' },
        }),
      });
      return insurance;
    });
  }

  async listPflegegrade(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'client.read');
      return this.masterData.listPflegegrade(transaction, principal.tenantId, clientId);
    });
  }

  async addPflegegrad(
    principal: AuthorizationPrincipal,
    clientId: string,
    data: PflegegradData,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<PflegegradSnapshot> {
    validatePflegegrad(data);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const record = this.pflegegradSnapshot(principal.tenantId, clientId, data, now);
      const closed = await this.closeOverlappingCurrentPflegegrad(
        transaction,
        principal,
        clientId,
        record,
        now,
        context,
        auditContext,
      );
      await this.masterData.insertPflegegrad(transaction, record);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.pflegegrad_added',
        metadata: { recordId: record.id, closedRecordId: closed?.id },
        event: createDomainEvent({
          type: 'client.pflegegrad_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, recordId: record.id, operation: 'added' },
        }),
      });
      return record;
    });
  }

  async updatePflegegrad(
    principal: AuthorizationPrincipal,
    clientId: string,
    recordId: string,
    changes: Partial<PflegegradData>,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<PflegegradSnapshot> {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireMutableClient(transaction, principal, clientId);
      const current = await this.masterData.findPflegegrad(
        transaction,
        principal.tenantId,
        clientId,
        recordId,
      );
      if (!current) throw new PflegegradNotFoundError();
      if (current.status !== 'pending' || current.validFrom <= today(now)) {
        throw new PflegegradRecordImmutableError();
      }
      const record = this.mergePflegegrad(current, changes, now);
      validatePflegegrad(record);
      const closed = await this.closeOverlappingCurrentPflegegrad(
        transaction,
        principal,
        clientId,
        record,
        now,
        context,
        auditContext,
        recordId,
      );
      const changedFields = changedFieldsOf(current, record);
      if (changedFields.length === 0 && !closed) return current;
      await this.masterData.updatePflegegrad(transaction, record);
      client.touch(now);
      await this.clients.update(transaction, client.snapshot);
      await this.recordChange({
        transaction,
        principal,
        context,
        auditContext,
        clientId,
        occurredAt: now,
        action: 'client.pflegegrad_updated',
        metadata: { recordId, changedFields },
        event: createDomainEvent({
          type: 'client.pflegegrad_changed',
          tenantId: principal.tenantId,
          aggregateType: 'client',
          aggregateId: clientId,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { clientId, recordId, operation: 'updated' },
        }),
      });
      return record;
    });
  }

  async timeline(
    principal: AuthorizationPrincipal,
    clientId: string,
  ): Promise<ClientTimelineEntry[]> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'client.read');
      const records = await this.masterData.listTimeline(
        transaction,
        principal.tenantId,
        clientId,
        100,
      );
      return records.reverse().map((record) => ({
        id: record.id,
        occurredAt: record.timestamp.toISOString(),
        actorId: record.actorId,
        action: record.action,
        summary: timelineSummary(record.action),
      }));
    });
  }

  private async requireClient(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    clientId: string,
    action: 'client.read' | 'client.update',
    lock = false,
  ) {
    const client = await this.clients.findById(transaction, principal.tenantId, clientId, lock);
    if (!client) throw new ClientNotFoundError();
    authorizeClientResource(principal, action, client);
    return client;
  }

  private async requireMutableClient(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    clientId: string,
  ): Promise<Client> {
    return Client.reconstitute(
      await this.requireClient(transaction, principal, clientId, 'client.update', true),
    );
  }

  private addressSnapshot(
    tenantId: string,
    clientId: string,
    data: ClientAddressData,
    now: Date,
  ): ClientAddressSnapshot {
    return {
      id: uuidv7(),
      tenantId,
      clientId,
      addressType: data.addressType,
      street: data.street,
      houseNumber: data.houseNumber ?? null,
      addressAddition: data.addressAddition ?? null,
      postalCode: data.postalCode ?? null,
      city: data.city,
      countryCode: data.countryCode ?? 'DE',
      validFrom: data.validFrom ?? null,
      validUntil: data.validUntil ?? null,
      isPrimary: data.isPrimary,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mergeAddress(
    current: ClientAddressSnapshot,
    changes: Partial<ClientAddressData>,
    now: Date,
  ): ClientAddressSnapshot {
    return {
      ...current,
      ...changes,
      addressType: changes.addressType ?? current.addressType,
      street: changes.street ?? current.street,
      houseNumber: changes.houseNumber === undefined ? current.houseNumber : changes.houseNumber,
      addressAddition:
        changes.addressAddition === undefined ? current.addressAddition : changes.addressAddition,
      postalCode: changes.postalCode === undefined ? current.postalCode : changes.postalCode,
      city: changes.city ?? current.city,
      countryCode: changes.countryCode ?? current.countryCode,
      validFrom: changes.validFrom === undefined ? current.validFrom : changes.validFrom,
      validUntil: changes.validUntil === undefined ? current.validUntil : changes.validUntil,
      isPrimary: changes.isPrimary ?? current.isPrimary,
      updatedAt: now,
    };
  }

  private contactSnapshot(
    tenantId: string,
    clientId: string,
    data: ClientContactData,
    now: Date,
  ): ClientContactSnapshot {
    return {
      id: uuidv7(),
      tenantId,
      clientId,
      firstName: data.firstName,
      lastName: data.lastName,
      relationshipType: data.relationshipType,
      phone: data.phone ?? null,
      mobile: data.mobile ?? null,
      email: data.email ?? null,
      addressStreet: data.addressStreet ?? null,
      addressHouseNumber: data.addressHouseNumber ?? null,
      addressAddition: data.addressAddition ?? null,
      addressPostalCode: data.addressPostalCode ?? null,
      addressCity: data.addressCity ?? null,
      addressCountryCode: data.addressCountryCode ?? null,
      representationType: data.representationType ?? null,
      representationValidFrom: data.representationValidFrom ?? null,
      representationValidUntil: data.representationValidUntil ?? null,
      representationReference: data.representationReference ?? null,
      roles: data.roles,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mergeContact(
    current: ClientContactSnapshot,
    changes: Partial<ClientContactData>,
    now: Date,
  ): ClientContactSnapshot {
    return {
      ...current,
      ...changes,
      firstName: changes.firstName ?? current.firstName,
      lastName: changes.lastName ?? current.lastName,
      relationshipType: changes.relationshipType ?? current.relationshipType,
      phone: changes.phone === undefined ? current.phone : changes.phone,
      mobile: changes.mobile === undefined ? current.mobile : changes.mobile,
      email: changes.email === undefined ? current.email : changes.email,
      addressStreet:
        changes.addressStreet === undefined ? current.addressStreet : changes.addressStreet,
      addressHouseNumber:
        changes.addressHouseNumber === undefined
          ? current.addressHouseNumber
          : changes.addressHouseNumber,
      addressAddition:
        changes.addressAddition === undefined ? current.addressAddition : changes.addressAddition,
      addressPostalCode:
        changes.addressPostalCode === undefined
          ? current.addressPostalCode
          : changes.addressPostalCode,
      addressCity: changes.addressCity === undefined ? current.addressCity : changes.addressCity,
      addressCountryCode:
        changes.addressCountryCode === undefined
          ? current.addressCountryCode
          : changes.addressCountryCode,
      representationType:
        changes.representationType === undefined
          ? current.representationType
          : changes.representationType,
      representationValidFrom:
        changes.representationValidFrom === undefined
          ? current.representationValidFrom
          : changes.representationValidFrom,
      representationValidUntil:
        changes.representationValidUntil === undefined
          ? current.representationValidUntil
          : changes.representationValidUntil,
      representationReference:
        changes.representationReference === undefined
          ? current.representationReference
          : changes.representationReference,
      roles: changes.roles ?? current.roles,
      notes: changes.notes === undefined ? current.notes : changes.notes,
      updatedAt: now,
    };
  }

  private insuranceSnapshot(
    tenantId: string,
    clientId: string,
    data: ClientInsuranceData,
    now: Date,
  ): ClientInsuranceSnapshot {
    return {
      id: uuidv7(),
      tenantId,
      clientId,
      insuranceType: data.insuranceType,
      insurerName: data.insurerName,
      insuranceNumber: data.insuranceNumber ?? null,
      memberNumber: data.memberNumber ?? null,
      validFrom: data.validFrom ?? null,
      validUntil: data.validUntil ?? null,
      isPrimary: data.isPrimary,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mergeInsurance(
    current: ClientInsuranceSnapshot,
    changes: Partial<ClientInsuranceData>,
    now: Date,
  ): ClientInsuranceSnapshot {
    return {
      ...current,
      ...changes,
      insuranceType: changes.insuranceType ?? current.insuranceType,
      insurerName: changes.insurerName ?? current.insurerName,
      insuranceNumber:
        changes.insuranceNumber === undefined ? current.insuranceNumber : changes.insuranceNumber,
      memberNumber:
        changes.memberNumber === undefined ? current.memberNumber : changes.memberNumber,
      validFrom: changes.validFrom === undefined ? current.validFrom : changes.validFrom,
      validUntil: changes.validUntil === undefined ? current.validUntil : changes.validUntil,
      isPrimary: changes.isPrimary ?? current.isPrimary,
      notes: changes.notes === undefined ? current.notes : changes.notes,
      updatedAt: now,
    };
  }

  private pflegegradSnapshot(
    tenantId: string,
    clientId: string,
    data: PflegegradData,
    now: Date,
  ): PflegegradSnapshot {
    return {
      id: uuidv7(),
      tenantId,
      clientId,
      grade: data.grade,
      validFrom: data.validFrom,
      validUntil: data.validUntil ?? null,
      decisionDate: data.decisionDate ?? null,
      insurerReference: data.insurerReference ?? null,
      status: data.status,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mergePflegegrad(
    current: PflegegradSnapshot,
    changes: Partial<PflegegradData>,
    now: Date,
  ): PflegegradSnapshot {
    return {
      ...current,
      ...changes,
      grade: changes.grade ?? current.grade,
      validFrom: changes.validFrom ?? current.validFrom,
      validUntil: changes.validUntil === undefined ? current.validUntil : changes.validUntil,
      decisionDate:
        changes.decisionDate === undefined ? current.decisionDate : changes.decisionDate,
      insurerReference:
        changes.insurerReference === undefined
          ? current.insurerReference
          : changes.insurerReference,
      status: changes.status ?? current.status,
      updatedAt: now,
    };
  }

  private async closeOverlappingCurrentPflegegrad(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    clientId: string,
    candidate: PflegegradSnapshot,
    now: Date,
    context: RequestContext,
    auditContext: AuditContext,
    exceptId?: string,
  ): Promise<PflegegradSnapshot | null> {
    const records = await this.masterData.listPflegegrade(
      transaction,
      principal.tenantId,
      clientId,
    );
    const overlapping =
      candidate.status === 'confirmed'
        ? records.filter(
            (record) =>
              record.id !== exceptId &&
              record.status === 'confirmed' &&
              periodsOverlap(record, candidate),
          )
        : [];
    if (overlapping.length === 0) return null;
    const closeable = overlapping.filter(
      (record) =>
        candidate.status === 'confirmed' &&
        record.status === 'confirmed' &&
        record.validUntil === null &&
        record.validFrom < candidate.validFrom,
    );
    if (overlapping.length !== 1 || closeable.length !== 1) {
      throw new OverlappingPflegegradPeriodError();
    }
    const existing = closeable[0]!;
    const closed = { ...existing, validUntil: candidate.validFrom, updatedAt: now };
    await this.masterData.updatePflegegrad(transaction, closed);
    await this.recordChange({
      transaction,
      principal,
      context,
      auditContext,
      clientId,
      occurredAt: now,
      action: 'client.pflegegrad_updated',
      metadata: { recordId: closed.id, changedFields: ['validUntil'] },
      event: createDomainEvent({
        type: 'client.pflegegrad_changed',
        tenantId: principal.tenantId,
        aggregateType: 'client',
        aggregateId: clientId,
        actor: { type: 'user', id: principal.userId },
        correlationId: context.correlationId,
        payload: { clientId, recordId: closed.id, operation: 'updated' },
      }),
    });
    return closed;
  }

  private async recordChange(input: {
    transaction: DatabaseTransaction;
    principal: AuthorizationPrincipal;
    context: RequestContext;
    auditContext: AuditContext;
    clientId: string;
    occurredAt: Date;
    action: string;
    metadata: Record<string, unknown>;
    event: ReturnType<typeof createDomainEvent>;
  }): Promise<void> {
    await appendClientChange({
      transaction: input.transaction,
      audit: this.audit,
      outbox: this.outbox,
      principal: input.principal,
      context: input.context,
      auditContext: input.auditContext,
      clientId: input.clientId,
      occurredAt: input.occurredAt,
      action: input.action,
      metadata: input.metadata,
      event: input.event,
    });
  }
}

function changedFieldsOf(before: object, after: object): string[] {
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  return Object.keys(next).filter((key) => {
    if (key === 'updatedAt') return false;
    const left = previous[key];
    const right = next[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length !== right.length || left.some((value, index) => value !== right[index]);
    }
    return left !== right;
  });
}

function periodsOverlap(left: PflegegradSnapshot, right: PflegegradSnapshot): boolean {
  const leftEnd = left.validUntil ?? '9999-12-31';
  const rightEnd = right.validUntil ?? '9999-12-31';
  return left.validFrom < rightEnd && right.validFrom < leftEnd;
}

function today(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function timelineSummary(action: string): string {
  const summaries: Record<string, string> = {
    'client.created': 'Klient angelegt',
    'client.updated': 'Stammdaten aktualisiert',
    'client.activated': 'Klient aktiviert',
    'client.archived': 'Klient archiviert',
    'client.provider_context_changed': 'Versorgerkontext geändert',
    'client.address_added': 'Adresse hinzugefügt',
    'client.address_updated': 'Adresse geändert',
    'client.address_removed': 'Adresse entfernt',
    'client.contact_added': 'Kontakt hinzugefügt',
    'client.contact_updated': 'Kontakt geändert',
    'client.contact_removed': 'Kontakt entfernt',
    'client.insurance_added': 'Versicherungsverhältnis hinzugefügt',
    'client.insurance_updated': 'Versicherungsverhältnis geändert',
    'client.pflegegrad_added': 'Pflegegradverlauf ergänzt',
    'client.pflegegrad_updated': 'Pflegegradverlauf aktualisiert',
    'service_agreement.created': 'Leistungsplanung angelegt',
    'service_agreement.updated': 'Leistungsplanung geändert',
    'service_agreement.activated': 'Leistungsplanung aktiviert',
    'service_agreement.suspended': 'Leistungsplanung pausiert',
    'service_agreement.resumed': 'Leistungsplanung fortgesetzt',
    'service_agreement.ended': 'Leistungsplanung beendet',
    'service_agreement.service_added': 'Leistung zur Planung hinzugefügt',
    'service_agreement.service_updated': 'Geplante Leistung geändert',
    'service_agreement.service_ended': 'Geplante Leistung beendet',
  };
  return summaries[action] ?? 'Klientenstammdaten geändert';
}

export function createClientMasterDataApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
): ClientMasterDataApplicationService {
  return new ClientMasterDataApplicationService(
    unitOfWork,
    new ClientRepository(),
    new ClientMasterDataRepository(),
    audit,
    outbox,
  );
}
