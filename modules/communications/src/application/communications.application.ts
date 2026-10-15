import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import {
  assertCan,
  can,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { clientContactRoles, clientContacts, clientRecords } from '@care/clients';
import { claims, invoices } from '@care/billing';
import { documentArtifacts } from '@care/documents';
import { users } from '@care/identity';
import { tasks } from '@care/operations';
import { visits } from '@care/scheduling';
import { agreements } from '@care/service-agreements';
import { contactAuthorizationFor } from '@module/communications/domain/contact-authorization';
import {
  clientCommunicationPreferences,
  interactionAmendments,
  interactions,
  prospectInteractions,
} from '@module/communications/schema';

type AuditContext = { ip?: string; userAgent?: string };
type InteractionDirection = (typeof interactions.$inferSelect)['direction'];
type InteractionChannel = (typeof interactions.$inferSelect)['channel'];
type InteractionCategory = (typeof interactions.$inferSelect)['category'];
type InteractionOutcome = (typeof interactions.$inferSelect)['outcome'];
type ContactAuthorization = (typeof interactions.$inferSelect)['contactAuthorization'];
type CommunicationSourceType = NonNullable<(typeof interactions.$inferSelect)['sourceType']>;

export interface CommunicationSourceReference {
  type: CommunicationSourceType;
  id: string;
}

export interface CommunicationInput {
  direction: InteractionDirection;
  channel: InteractionChannel;
  category: InteractionCategory;
  subject: string;
  summary?: string | null;
  outcome: InteractionOutcome;
  occurredAt: Date;
  contactId?: string | null;
  contactLabel?: string | null;
  source?: CommunicationSourceReference | null;
}

export interface ProspectCommunicationCaseContext {
  caseId: string;
  tenantId: string;
  organizationId: string;
  facilityId: string | null;
}

export interface CommunicationAmendmentInput {
  expectedVersion: number;
  reason: string;
  direction?: InteractionDirection;
  channel?: InteractionChannel;
  category?: InteractionCategory;
  subject?: string;
  summary?: string | null;
  outcome?: InteractionOutcome;
  occurredAt?: Date;
  contactId?: string | null;
  contactLabel?: string | null;
}

export interface CommunicationListQuery {
  clientId?: string;
  organizationId?: string;
  facilityId?: string;
  clientSearch?: string;
  recordedByUserId?: string;
  channel?: InteractionChannel;
  direction?: InteractionDirection;
  category?: InteractionCategory;
  outcome?: InteractionOutcome;
  from?: Date;
  until?: Date;
  followUpStatus?: 'needs_task' | 'open' | 'overdue' | 'completed';
  search?: string;
  sort?: 'occurredAt' | 'client' | 'subject' | 'channel';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface CommunicationPreferencesInput {
  expectedVersion: number;
  preferredChannel?: InteractionChannel | null;
  preferredLanguage?: 'de' | 'en' | null;
  preferredContactId?: string | null;
  preferredContactTimes?: string | null;
  correspondencePreference: 'unspecified' | 'postal' | 'electronic';
  contactRestrictions?: string | null;
}

export class CommunicationsApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async createInteraction(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: CommunicationInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    validateInteractionInput(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(
        transaction,
        principal,
        clientId,
        'communications.create',
      );
      const contact = await this.resolveContact(
        transaction,
        principal.tenantId,
        clientId,
        input.contactId ?? null,
        input.contactLabel ?? null,
      );
      if (input.source) await this.validateSource(transaction, principal, clientId, input.source);
      const now = new Date();
      const id = uuidv7();
      const [row] = await transaction
        .insert(interactions)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId: client.organizationId,
          facilityId: client.primaryFacilityId,
          clientId,
          contactId: contact.contactId,
          contactLabelSnapshot: contact.label,
          contactAuthorization: contact.authorization,
          direction: input.direction,
          channel: input.channel,
          category: input.category,
          subject: input.subject.trim(),
          summary: normalizeOptional(input.summary),
          outcome: input.outcome,
          occurredAt: input.occurredAt,
          recordedByUserId: principal.userId,
          sourceType: input.source?.type ?? null,
          ...sourceColumns(input.source ?? null),
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const event = createDomainEvent({
        type: 'communication.recorded',
        tenantId: principal.tenantId,
        aggregateType: 'client',
        aggregateId: clientId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: { interactionId: id, clientId },
      });
      await this.recordChange(transaction, principal, request, auditContext, event, clientId, {
        interactionId: id,
        direction: input.direction,
        channel: input.channel,
        category: input.category,
        outcome: input.outcome,
        sourceType: input.source?.type ?? null,
        contactAuthorization: contact.authorization,
      });
      return interactionView(row!, principal);
    });
  }

  async recordProspectInteractionWithinTransaction(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    admission: ProspectCommunicationCaseContext,
    input: CommunicationInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    validateInteractionInput(input);
    if (
      input.contactId ||
      input.contactLabel ||
      input.source ||
      admission.tenantId !== principal.tenantId
    ) {
      throw new InvalidCommunicationInputError();
    }
    const resource: ResourceContext = {
      tenantId: principal.tenantId,
      organizationId: admission.organizationId,
      ...(admission.facilityId ? { facilityId: admission.facilityId } : {}),
    };
    assertCan(principal, { action: 'onboarding.manage', resource });
    assertCan(principal, { action: 'communications.create', resource });
    const now = new Date();
    const id = uuidv7();
    const [row] = await transaction
      .insert(prospectInteractions)
      .values({
        id,
        tenantId: principal.tenantId,
        caseId: admission.caseId,
        organizationId: admission.organizationId,
        facilityId: admission.facilityId,
        direction: input.direction,
        channel: input.channel,
        category: input.category,
        subject: input.subject.trim(),
        summary: normalizeOptional(input.summary),
        outcome: input.outcome,
        occurredAt: input.occurredAt,
        recordedByUserId: principal.userId,
        createdAt: now,
      })
      .returning();
    const event = createDomainEvent({
      type: 'communication.prospect_recorded',
      tenantId: principal.tenantId,
      aggregateType: 'onboarding',
      aggregateId: admission.caseId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload: { interactionId: id, caseId: admission.caseId },
    });
    await this.recordChange(
      transaction,
      principal,
      request,
      auditContext,
      event,
      admission.caseId,
      {
        interactionId: id,
        direction: input.direction,
        channel: input.channel,
        category: input.category,
        outcome: input.outcome,
        sourceType: 'admission_case',
        contactAuthorization: 'not_applicable',
      },
      'communication.prospect_recorded',
      'admission_communication',
    );
    return row!;
  }

  async listClientInteractions(
    principal: AuthorizationPrincipal,
    clientId: string,
    query: CommunicationListQuery = {},
  ) {
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 25, 1, 100);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(
        transaction,
        principal,
        clientId,
        'communications.read',
      );
      const conditions = this.interactionFilters(principal, query, clientId);
      const where = and(...conditions);
      const [totalRow] = await transaction
        .select({ count: count() })
        .from(interactions)
        .innerJoin(
          clientRecords,
          and(
            eq(clientRecords.tenantId, interactions.tenantId),
            eq(clientRecords.id, interactions.clientId),
          ),
        )
        .where(where);
      const rows = await transaction
        .select({ interaction: interactions, recordedByName: users.displayName })
        .from(interactions)
        .leftJoin(users, eq(users.id, interactions.recordedByUserId))
        .where(where)
        .orderBy(...interactionOrder(query))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows
          .filter(() => canReadCommunication(principal, resourceFor(client)))
          .map(({ interaction, recordedByName }) => ({
            ...interactionView(interaction, principal),
            recordedByName,
          })),
        page,
        pageSize,
        total: Number(totalRow?.count ?? 0),
      };
    });
  }

  async listInteractions(principal: AuthorizationPrincipal, query: CommunicationListQuery = {}) {
    this.requireAnyPermission(principal, 'communications.read');
    if (query.followUpStatus) this.requireAnyPermission(principal, 'operations.read');
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 25, 1, 100);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const conditions = this.interactionFilters(principal, query);
      const where = and(...conditions);
      const [totalRow] = await transaction
        .select({ count: count() })
        .from(interactions)
        .innerJoin(
          clientRecords,
          and(
            eq(clientRecords.tenantId, interactions.tenantId),
            eq(clientRecords.id, interactions.clientId),
          ),
        )
        .where(where);
      const rows = await transaction
        .select({
          interaction: interactions,
          clientFirstName: clientRecords.firstName,
          clientLastName: clientRecords.lastName,
          clientPreferredName: clientRecords.preferredName,
          organizationId: clientRecords.organizationId,
          primaryFacilityId: clientRecords.primaryFacilityId,
          recordedByName: users.displayName,
        })
        .from(interactions)
        .innerJoin(
          clientRecords,
          and(
            eq(clientRecords.tenantId, interactions.tenantId),
            eq(clientRecords.id, interactions.clientId),
          ),
        )
        .leftJoin(users, eq(users.id, interactions.recordedByUserId))
        .where(where)
        .orderBy(...interactionOrder(query, true))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const operationReadableRows = rows.filter((row) =>
        can(principal, {
          action: 'operations.read',
          resource: {
            tenantId: principal.tenantId,
            ...(row.organizationId ? { organizationId: row.organizationId } : {}),
            ...(row.primaryFacilityId ? { facilityId: row.primaryFacilityId } : {}),
            clientId: row.interaction.clientId,
          },
        }),
      );
      const taskStatusByInteraction = new Map<
        string,
        { hasOpen: boolean; hasOverdue: boolean; hasCompleted: boolean }
      >();
      if (operationReadableRows.length) {
        const taskStatusRows = await transaction
          .select({
            sourceCommunicationId: tasks.sourceCommunicationId,
            hasOpen: sql<boolean>`coalesce(bool_or(${tasks.status} IN ('open', 'in_progress')), false)`,
            hasOverdue: sql<boolean>`coalesce(bool_or(${tasks.status} IN ('open', 'in_progress') AND ${tasks.dueAt} < now()), false)`,
            hasCompleted: sql<boolean>`coalesce(bool_or(${tasks.status} = 'completed'), false)`,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.tenantId, principal.tenantId),
              inArray(
                tasks.sourceCommunicationId,
                operationReadableRows.map((row) => row.interaction.id),
              ),
            ),
          )
          .groupBy(tasks.sourceCommunicationId);
        for (const row of taskStatusRows) {
          if (row.sourceCommunicationId) {
            taskStatusByInteraction.set(row.sourceCommunicationId, {
              hasOpen: row.hasOpen,
              hasOverdue: row.hasOverdue,
              hasCompleted: row.hasCompleted,
            });
          }
        }
      }
      const items = rows
        .filter((row) =>
          canReadCommunication(principal, {
            tenantId: principal.tenantId,
            ...(row.organizationId ? { organizationId: row.organizationId } : {}),
            ...(row.primaryFacilityId ? { facilityId: row.primaryFacilityId } : {}),
            clientId: row.interaction.clientId,
          }),
        )
        .map((row) => {
          const resource = {
            tenantId: principal.tenantId,
            ...(row.organizationId ? { organizationId: row.organizationId } : {}),
            ...(row.primaryFacilityId ? { facilityId: row.primaryFacilityId } : {}),
            clientId: row.interaction.clientId,
          };
          const canReadTasks = can(principal, { action: 'operations.read', resource });
          const followUpStatus = canReadTasks
            ? followUpStatusFor(
                row.interaction.outcome,
                taskStatusByInteraction.get(row.interaction.id),
              )
            : undefined;
          return {
            ...interactionView(row.interaction, principal),
            summary: null,
            clientName: `${row.clientPreferredName || row.clientFirstName} ${row.clientLastName}`,
            recordedByName: row.recordedByName,
            ...(followUpStatus === undefined ? {} : { followUpStatus }),
          };
        });
      return { items, page, pageSize, total: Number(totalRow?.count ?? 0) };
    });
  }

  async getInteraction(principal: AuthorizationPrincipal, interactionId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const row = await this.requireInteraction(
        transaction,
        principal,
        interactionId,
        'communications.read',
      );
      const [recorder] = await transaction
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, row.recordedByUserId))
        .limit(1);
      const amendments = await transaction
        .select({ amendment: interactionAmendments, recordedByName: users.displayName })
        .from(interactionAmendments)
        .leftJoin(users, eq(users.id, interactionAmendments.recordedByUserId))
        .where(
          and(
            eq(interactionAmendments.tenantId, principal.tenantId),
            eq(interactionAmendments.interactionId, row.id),
          ),
        )
        .orderBy(asc(interactionAmendments.version));
      return {
        ...interactionView(row, principal),
        recordedByName: recorder?.displayName ?? null,
        amendments: amendments.map(({ amendment, recordedByName }) => ({
          id: amendment.id,
          version: amendment.version,
          reason: amendment.reason,
          direction: amendment.direction,
          channel: amendment.channel,
          category: amendment.category,
          subject: amendment.subject,
          summary: amendment.summary,
          outcome: amendment.outcome,
          contactId: amendment.contactId,
          contactLabel: amendment.contactLabelSnapshot,
          contactAuthorization: amendment.contactAuthorization,
          recordedByUserId: amendment.recordedByUserId,
          recordedByName,
          recordedAt: amendment.recordedAt.toISOString(),
        })),
      };
    });
  }

  async amendInteraction(
    principal: AuthorizationPrincipal,
    interactionId: string,
    input: CommunicationAmendmentInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !input.reason?.trim() ||
      input.reason.trim().length > 500 ||
      !hasPatchValue(input)
    ) {
      throw new InvalidCommunicationInputError();
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const current = await this.requireInteraction(
        transaction,
        principal,
        interactionId,
        'communications.update',
        true,
      );
      assertCan(principal, {
        action: 'communications.amend',
        resource: this.interactionResource(current),
      });
      if (current.version !== input.expectedVersion) throw new CommunicationVersionConflictError();
      await this.requireClient(transaction, principal, current.clientId, 'communications.update');
      const nextContactId = input.contactId === undefined ? current.contactId : input.contactId;
      const nextContactLabel =
        input.contactLabel === undefined
          ? nextContactId
            ? null
            : current.contactLabelSnapshot
          : input.contactLabel;
      const contact = await this.resolveContact(
        transaction,
        principal.tenantId,
        current.clientId,
        nextContactId,
        nextContactLabel,
      );
      const snapshot = {
        direction: input.direction ?? current.direction,
        channel: input.channel ?? current.channel,
        category: input.category ?? current.category,
        subject: input.subject === undefined ? current.subject : input.subject.trim(),
        summary: input.summary === undefined ? current.summary : normalizeOptional(input.summary),
        outcome: input.outcome ?? current.outcome,
        occurredAt: input.occurredAt ?? current.occurredAt,
        contactId: contact.contactId,
        contactLabelSnapshot: contact.label,
        contactAuthorization: contact.authorization,
      };
      validateInteractionInput({ ...snapshot, contactLabel: snapshot.contactLabelSnapshot });
      const now = new Date();
      const version = current.version + 1;
      await transaction.insert(interactionAmendments).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        clientId: current.clientId,
        interactionId: current.id,
        version: current.version,
        reason: input.reason.trim(),
        direction: current.direction,
        channel: current.channel,
        category: current.category,
        subject: current.subject,
        summary: current.summary,
        outcome: current.outcome,
        contactId: current.contactId,
        contactLabelSnapshot: current.contactLabelSnapshot,
        contactAuthorization: current.contactAuthorization,
        recordedByUserId: principal.userId,
        recordedAt: now,
      });
      const [updated] = await transaction
        .update(interactions)
        .set({ ...snapshot, version, updatedAt: now })
        .where(
          and(
            eq(interactions.tenantId, principal.tenantId),
            eq(interactions.id, current.id),
            eq(interactions.version, current.version),
          ),
        )
        .returning();
      if (!updated) throw new CommunicationVersionConflictError();
      const event = createDomainEvent({
        type: 'communication.amended',
        tenantId: principal.tenantId,
        aggregateType: 'client',
        aggregateId: current.clientId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: { interactionId: current.id, clientId: current.clientId, version },
      });
      await this.recordChange(
        transaction,
        principal,
        request,
        auditContext,
        event,
        current.clientId,
        {
          interactionId: current.id,
          version,
          changedFields: Object.keys(input).filter(
            (field) => field !== 'expectedVersion' && field !== 'reason',
          ),
          contactAuthorization: contact.authorization,
        },
      );
      return interactionView(updated, principal);
    });
  }

  async clientSummary(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(
        transaction,
        principal,
        clientId,
        'communications.read',
      );
      const [mostRecentInteraction] = await transaction
        .select({
          subject: interactions.subject,
          occurredAt: interactions.occurredAt,
        })
        .from(interactions)
        .where(
          and(eq(interactions.tenantId, principal.tenantId), eq(interactions.clientId, clientId)),
        )
        .orderBy(desc(interactions.occurredAt), desc(interactions.id))
        .limit(1);
      const [preferences] = await transaction
        .select()
        .from(clientCommunicationPreferences)
        .where(
          and(
            eq(clientCommunicationPreferences.tenantId, principal.tenantId),
            eq(clientCommunicationPreferences.clientId, clientId),
          ),
        )
        .limit(1);
      const contactRows = await transaction
        .select({
          id: clientContacts.id,
          firstName: clientContacts.firstName,
          lastName: clientContacts.lastName,
          representationType: clientContacts.representationType,
          representationValidFrom: clientContacts.representationValidFrom,
          representationValidUntil: clientContacts.representationValidUntil,
          role: clientContactRoles.role,
        })
        .from(clientContacts)
        .leftJoin(
          clientContactRoles,
          and(
            eq(clientContactRoles.tenantId, clientContacts.tenantId),
            eq(clientContactRoles.clientId, clientContacts.clientId),
            eq(clientContactRoles.contactId, clientContacts.id),
          ),
        )
        .where(
          and(
            eq(clientContacts.tenantId, principal.tenantId),
            eq(clientContacts.clientId, clientId),
          ),
        );
      const contactsById = new Map<
        string,
        {
          contact: {
            id: string;
            firstName: string;
            lastName: string;
            representationType: string | null;
            representationValidFrom: string | null;
            representationValidUntil: string | null;
          };
          roles: Set<string>;
        }
      >();
      for (const row of contactRows) {
        const entry = contactsById.get(row.id) ?? {
          contact: {
            id: row.id,
            firstName: row.firstName,
            lastName: row.lastName,
            representationType: row.representationType,
            representationValidFrom: row.representationValidFrom,
            representationValidUntil: row.representationValidUntil,
          },
          roles: new Set<string>(),
        };
        if (row.role) entry.roles.add(row.role);
        contactsById.set(row.id, entry);
      }
      const today = new Date().toISOString().slice(0, 10);
      const authorizedContacts = [...contactsById.values()]
        .map(({ contact, roles }) => ({
          contact,
          roles,
          authorization: contactAuthorizationFor({
            roles: [...roles],
            representationType: contact.representationType,
            validFrom: contact.representationValidFrom,
            validUntil: contact.representationValidUntil,
            today,
          }),
        }))
        .filter((entry) => entry.authorization !== 'not_confirmed')
        .sort((left, right) => {
          const leftPrimary = left.roles.has('primary_contact') ? 0 : 1;
          const rightPrimary = right.roles.has('primary_contact') ? 0 : 1;
          if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;
          return left.authorization === 'legal_representative' ? -1 : 1;
        });
      const preferredContact = preferences?.preferredContactId
        ? contactsById.get(preferences.preferredContactId)?.contact
        : undefined;
      const canReadTasks = can(principal, {
        action: 'operations.read',
        resource: resourceFor(client),
      });
      const linkedTasks = canReadTasks
        ? await transaction
            .select({
              id: tasks.id,
              title: tasks.title,
              status: tasks.status,
              dueAt: tasks.dueAt,
            })
            .from(tasks)
            .where(
              and(
                eq(tasks.tenantId, principal.tenantId),
                eq(tasks.clientId, clientId),
                inArray(tasks.status, ['open', 'in_progress']),
                sql`${tasks.sourceCommunicationId} IS NOT NULL`,
              ),
            )
            .orderBy(asc(tasks.dueAt), desc(tasks.createdAt))
            .limit(3)
        : [];
      return {
        mostRecentInteraction: mostRecentInteraction
          ? {
              subject: mostRecentInteraction.subject,
              occurredAt: mostRecentInteraction.occurredAt.toISOString(),
            }
          : null,
        openFollowUps: linkedTasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          dueAt: task.dueAt?.toISOString() ?? null,
        })),
        preferredChannel: preferences?.preferredChannel ?? null,
        preferredContactName: preferredContact
          ? `${preferredContact.firstName} ${preferredContact.lastName}`.trim()
          : null,
        primaryAuthorizedContact: authorizedContacts[0]
          ? {
              name: `${authorizedContacts[0].contact.firstName} ${authorizedContacts[0].contact.lastName}`.trim(),
              authorization: authorizedContacts[0].authorization,
            }
          : null,
      };
    });
  }

  async getPreferences(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal, clientId, 'client.read');
      const resource = resourceFor(client);
      if (!can(principal, { action: 'communications.read', resource })) {
        assertCan(principal, { action: 'communications.preferences.manage', resource });
      }
      const [row] = await transaction
        .select()
        .from(clientCommunicationPreferences)
        .where(
          and(
            eq(clientCommunicationPreferences.tenantId, principal.tenantId),
            eq(clientCommunicationPreferences.clientId, clientId),
          ),
        )
        .limit(1);
      return row ? preferenceView(row) : defaultPreferences(clientId);
    });
  }

  async updatePreferences(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: CommunicationPreferencesInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    validatePreferences(input);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(
        transaction,
        principal,
        clientId,
        'communications.preferences.manage',
      );
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${principal.tenantId}:${clientId}`}, 0))`,
      );
      const [current] = await transaction
        .select()
        .from(clientCommunicationPreferences)
        .where(
          and(
            eq(clientCommunicationPreferences.tenantId, principal.tenantId),
            eq(clientCommunicationPreferences.clientId, clientId),
          ),
        )
        .for('update')
        .limit(1);
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new CommunicationVersionConflictError();
      if (input.preferredContactId) {
        const contact = await this.resolveContact(
          transaction,
          principal.tenantId,
          clientId,
          input.preferredContactId,
          null,
        );
        if (!contact.contactId) throw new InvalidCommunicationInputError();
      }
      const now = new Date();
      const version = (current?.version ?? 0) + 1;
      const values = {
        id: current?.id ?? uuidv7(),
        tenantId: principal.tenantId,
        clientId,
        preferredChannel: input.preferredChannel ?? null,
        preferredLanguage: input.preferredLanguage ?? null,
        preferredContactId: input.preferredContactId ?? null,
        preferredContactTimes: normalizeOptional(input.preferredContactTimes),
        correspondencePreference: input.correspondencePreference,
        contactRestrictions: normalizeOptional(input.contactRestrictions),
        version,
        updatedByUserId: principal.userId,
        updatedAt: now,
      };
      const [row] = current
        ? await transaction
            .update(clientCommunicationPreferences)
            .set(values)
            .where(
              and(
                eq(clientCommunicationPreferences.tenantId, principal.tenantId),
                eq(clientCommunicationPreferences.clientId, clientId),
                eq(clientCommunicationPreferences.version, current.version),
              ),
            )
            .returning()
        : await transaction.insert(clientCommunicationPreferences).values(values).returning();
      if (!row) throw new CommunicationVersionConflictError();
      const event = createDomainEvent({
        type: 'communication.preferences_updated',
        tenantId: principal.tenantId,
        aggregateType: 'client',
        aggregateId: clientId,
        actor: { type: 'user', id: principal.userId },
        correlationId: request.correlationId,
        payload: { clientId, version },
      });
      await this.recordChange(
        transaction,
        principal,
        request,
        auditContext,
        event,
        clientId,
        {
          version,
          changedFields: Object.keys(input).filter((field) => field !== 'expectedVersion'),
        },
        'communication.preferences_updated',
        'client_communication_preferences',
      );
      return preferenceView(row);
    });
  }

  private interactionFilters(
    principal: AuthorizationPrincipal,
    query: CommunicationListQuery,
    clientId?: string,
  ): SQL[] {
    const conditions: SQL[] = [eq(interactions.tenantId, principal.tenantId)];
    if (clientId) conditions.push(eq(interactions.clientId, clientId));
    if (query.clientId) conditions.push(eq(interactions.clientId, query.clientId));
    if (query.channel) conditions.push(eq(interactions.channel, query.channel));
    if (query.direction) conditions.push(eq(interactions.direction, query.direction));
    if (query.category) conditions.push(eq(interactions.category, query.category));
    if (query.outcome) conditions.push(eq(interactions.outcome, query.outcome));
    if (query.recordedByUserId)
      conditions.push(eq(interactions.recordedByUserId, query.recordedByUserId));
    if (query.from) conditions.push(gte(interactions.occurredAt, query.from));
    if (query.until) conditions.push(lte(interactions.occurredAt, query.until));
    if (query.search?.trim()) {
      const pattern = `%${escapeLike(query.search.trim())}%`;
      conditions.push(
        or(ilike(interactions.subject, pattern), ilike(interactions.summary, pattern))!,
      );
    }
    if (!clientId) {
      if (query.organizationId)
        conditions.push(eq(clientRecords.organizationId, query.organizationId));
      if (query.facilityId) conditions.push(eq(clientRecords.primaryFacilityId, query.facilityId));
      if (query.clientSearch?.trim()) {
        const pattern = `%${escapeLike(query.clientSearch.trim())}%`;
        conditions.push(
          or(
            ilike(clientRecords.firstName, pattern),
            ilike(clientRecords.preferredName, pattern),
            ilike(clientRecords.lastName, pattern),
          )!,
        );
      }
      if (query.followUpStatus) {
        const operationsScopes = permissionScopes(principal, 'operations.read');
        if (!operationsScopes) return [sql`false`];
        const scopedConditions = operationsScopes.filter(
          (condition): condition is SQL => condition !== undefined,
        );
        if (scopedConditions.length) conditions.push(or(...scopedConditions)!);
        const activeTask = sql`EXISTS (
          SELECT 1 FROM operations.tasks AS follow_up
          WHERE follow_up.tenant_id = ${interactions.tenantId}
            AND follow_up.client_id = ${interactions.clientId}
            AND follow_up.source_communication_id = ${interactions.id}
            AND follow_up.status IN ('open', 'in_progress')
        )`;
        const overdueTask = sql`EXISTS (
          SELECT 1 FROM operations.tasks AS follow_up
          WHERE follow_up.tenant_id = ${interactions.tenantId}
            AND follow_up.client_id = ${interactions.clientId}
            AND follow_up.source_communication_id = ${interactions.id}
            AND follow_up.status IN ('open', 'in_progress')
            AND follow_up.due_at IS NOT NULL
            AND follow_up.due_at < now()
        )`;
        const completedTask = sql`EXISTS (
          SELECT 1 FROM operations.tasks AS follow_up
          WHERE follow_up.tenant_id = ${interactions.tenantId}
            AND follow_up.client_id = ${interactions.clientId}
            AND follow_up.source_communication_id = ${interactions.id}
            AND follow_up.status = 'completed'
        )`;
        switch (query.followUpStatus) {
          case 'needs_task':
            conditions.push(
              eq(interactions.outcome, 'action_required'),
              sql`NOT ${activeTask}`,
              sql`NOT ${completedTask}`,
            );
            break;
          case 'open':
            conditions.push(activeTask, sql`NOT ${overdueTask}`);
            break;
          case 'overdue':
            conditions.push(overdueTask);
            break;
          case 'completed':
            conditions.push(completedTask, sql`NOT ${activeTask}`);
            break;
        }
      }
      const communicationScopes = permissionScopes(principal, 'communications.read');
      const clientScopes = permissionScopes(principal, 'client.read');
      if (!communicationScopes || !clientScopes) return [sql`false`];
      const pairs: SQL[] = [];
      for (const communicationScope of communicationScopes) {
        for (const clientScope of clientScopes) {
          pairs.push(
            and(
              ...[communicationScope, clientScope].filter(
                (condition): condition is SQL => condition !== undefined,
              ),
            ) ?? sql`true`,
          );
        }
      }
      conditions.push(or(...pairs) ?? sql`false`);
    }
    return conditions;
  }

  private async requireClient(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    clientId: string,
    permission: Permission,
  ) {
    const [client] = await transaction
      .select()
      .from(clientRecords)
      .where(and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, clientId)))
      .limit(1);
    if (!client) throw new CommunicationNotFoundError();
    const resource = resourceFor(client);
    assertCan(principal, { action: 'client.read', resource });
    assertCan(principal, { action: permission, resource });
    return client;
  }

  private async requireInteraction(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    interactionId: string,
    permission: Permission,
    forUpdate = false,
  ) {
    let query = transaction
      .select()
      .from(interactions)
      .where(and(eq(interactions.tenantId, principal.tenantId), eq(interactions.id, interactionId)))
      .limit(1);
    if (forUpdate) query = query.for('update') as typeof query;
    const [row] = await query;
    if (!row) throw new CommunicationNotFoundError();
    const client = await this.requireClient(transaction, principal, row.clientId, permission);
    if (!canReadCommunication(principal, resourceFor(client)))
      throw new CommunicationNotFoundError();
    return row;
  }

  private interactionResource(row: typeof interactions.$inferSelect): ResourceContext {
    return {
      tenantId: row.tenantId,
      ...(row.organizationId ? { organizationId: row.organizationId } : {}),
      ...(row.facilityId ? { facilityId: row.facilityId } : {}),
      clientId: row.clientId,
    };
  }

  private async resolveContact(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    contactId: string | null,
    contactLabel: string | null,
  ): Promise<{
    contactId: string | null;
    label: string | null;
    authorization: ContactAuthorization;
  }> {
    if (contactId && contactLabel?.trim()) throw new InvalidCommunicationInputError();
    if (!contactId) {
      const label = normalizeOptional(contactLabel);
      if (label && label.length > 120) throw new InvalidCommunicationInputError();
      return { contactId: null, label, authorization: label ? 'not_confirmed' : 'not_applicable' };
    }
    const rows = await transaction
      .select({
        contact: clientContacts,
        role: clientContactRoles.role,
      })
      .from(clientContacts)
      .leftJoin(
        clientContactRoles,
        and(
          eq(clientContactRoles.tenantId, clientContacts.tenantId),
          eq(clientContactRoles.clientId, clientContacts.clientId),
          eq(clientContactRoles.contactId, clientContacts.id),
        ),
      )
      .where(
        and(
          eq(clientContacts.tenantId, tenantId),
          eq(clientContacts.clientId, clientId),
          eq(clientContacts.id, contactId),
        ),
      );
    if (!rows.length) throw new CommunicationNotFoundError();
    const contact = rows[0]!.contact;
    const roles = new Set(
      rows.map((row) => row.role).filter((role): role is NonNullable<typeof role> => role !== null),
    );
    const authorization: ContactAuthorization = contactAuthorizationFor({
      roles: [...roles],
      representationType: contact.representationType,
      validFrom: contact.representationValidFrom,
      validUntil: contact.representationValidUntil,
      today: new Date().toISOString().slice(0, 10),
    });
    const label = `${contact.firstName} ${contact.lastName}`.trim();
    if (!label || label.length > 120) throw new InvalidCommunicationInputError();
    return {
      contactId,
      label,
      authorization,
    };
  }

  private async validateSource(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    clientId: string,
    source: CommunicationSourceReference,
  ) {
    let context: {
      clientId: string | null;
      organizationId: string | null;
      facilityId: string | null;
    } | null = null;
    switch (source.type) {
      case 'visit': {
        const [row] = await transaction
          .select()
          .from(visits)
          .where(and(eq(visits.tenantId, principal.tenantId), eq(visits.id, source.id)))
          .limit(1);
        context = row ? row : null;
        break;
      }
      case 'service_agreement': {
        const [row] = await transaction
          .select()
          .from(agreements)
          .where(and(eq(agreements.tenantId, principal.tenantId), eq(agreements.id, source.id)))
          .limit(1);
        context = row ? row : null;
        break;
      }
      case 'operations_task': {
        const [row] = await transaction
          .select()
          .from(tasks)
          .where(and(eq(tasks.tenantId, principal.tenantId), eq(tasks.id, source.id)))
          .limit(1);
        context = row ? row : null;
        break;
      }
      case 'invoice': {
        const [row] = await transaction
          .select()
          .from(invoices)
          .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, source.id)))
          .limit(1);
        context = row ? row : null;
        break;
      }
      case 'claim': {
        const [row] = await transaction
          .select()
          .from(claims)
          .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, source.id)))
          .limit(1);
        context = row ? row : null;
        break;
      }
      case 'document': {
        const [row] = await transaction
          .select()
          .from(documentArtifacts)
          .where(
            and(
              eq(documentArtifacts.tenantId, principal.tenantId),
              eq(documentArtifacts.id, source.id),
            ),
          )
          .limit(1);
        context = row ? row : null;
        break;
      }
    }
    if (!context || context.clientId !== clientId) throw new CommunicationSourceNotFoundError();
    const resource: ResourceContext = {
      tenantId: principal.tenantId,
      ...(context.organizationId ? { organizationId: context.organizationId } : {}),
      ...(context.facilityId ? { facilityId: context.facilityId } : {}),
      clientId,
    };
    assertCan(principal, { action: sourcePermission(source.type), resource });
  }

  private requireAnyPermission(principal: AuthorizationPrincipal, permission: Permission) {
    if (!principal.grants.some((grant) => grant.permission === permission)) {
      assertCan(principal, { action: permission, resource: { tenantId: principal.tenantId } });
    }
  }

  private async recordChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    event: ReturnType<typeof createDomainEvent>,
    clientId: string,
    metadata: Record<string, unknown>,
    action = event.type,
    resourceType = 'client_communication',
  ) {
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action,
      resourceType,
      resourceId: clientId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(auditContext.ip === undefined ? {} : { ip: auditContext.ip }),
      ...(auditContext.userAgent === undefined ? {} : { userAgent: auditContext.userAgent }),
      metadata,
    });
    await this.outbox.enqueue(transaction, event);
  }
}

export function createCommunicationsApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
) {
  return new CommunicationsApplicationService(unitOfWork, audit, outbox);
}

export class CommunicationNotFoundError extends Error {
  readonly code = 'COMMUNICATION_NOT_FOUND';
  constructor() {
    super('Communication record not found');
    this.name = 'CommunicationNotFoundError';
  }
}

export class CommunicationSourceNotFoundError extends Error {
  readonly code = 'COMMUNICATION_SOURCE_NOT_FOUND';
  constructor() {
    super('Linked source was not found for this client');
    this.name = 'CommunicationSourceNotFoundError';
  }
}

export class InvalidCommunicationInputError extends Error {
  readonly code = 'COMMUNICATION_INVALID_INPUT';
  constructor() {
    super('Communication input is invalid');
    this.name = 'InvalidCommunicationInputError';
  }
}

export class CommunicationVersionConflictError extends Error {
  readonly code = 'COMMUNICATION_VERSION_CONFLICT';
  constructor() {
    super('Communication record changed since it was read');
    this.name = 'CommunicationVersionConflictError';
  }
}

function validateInteractionInput(input: CommunicationInput | Record<string, unknown>) {
  const record = input as Record<string, unknown>;
  if (
    !['inbound', 'outbound', 'internal'].includes(String(record.direction)) ||
    !['phone', 'in_person', 'email', 'letter', 'portal', 'other'].includes(
      String(record.channel),
    ) ||
    ![
      'general_inquiry',
      'appointment_coordination',
      'cancellation_rescheduling',
      'service_request',
      'service_agreement',
      'documentation',
      'billing_payment',
      'benefits_payer',
      'complaint_feedback',
      'other',
    ].includes(String(record.category)) ||
    ![
      'information_provided',
      'request_received',
      'action_required',
      'appointment_agreed',
      'no_answer',
      'resolved',
      'other',
    ].includes(String(record.outcome)) ||
    typeof record.subject !== 'string' ||
    !record.subject.trim() ||
    record.subject.trim().length > 200 ||
    (record.summary != null &&
      (typeof record.summary !== 'string' || record.summary.length > 4000)) ||
    !(record.occurredAt instanceof Date) ||
    Number.isNaN(record.occurredAt.getTime())
  )
    throw new InvalidCommunicationInputError();
}

function validatePreferences(input: CommunicationPreferencesInput) {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !['unspecified', 'postal', 'electronic'].includes(input.correspondencePreference) ||
    (input.preferredChannel != null &&
      !['phone', 'in_person', 'email', 'letter', 'portal', 'other'].includes(
        input.preferredChannel,
      )) ||
    (input.preferredLanguage != null && !['de', 'en'].includes(input.preferredLanguage)) ||
    (input.preferredContactTimes != null && input.preferredContactTimes.length > 250) ||
    (input.contactRestrictions != null && input.contactRestrictions.length > 1000)
  )
    throw new InvalidCommunicationInputError();
}

function hasPatchValue(input: CommunicationAmendmentInput) {
  return Object.keys(input).some((key) => !['expectedVersion', 'reason'].includes(key));
}

function normalizeOptional(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new InvalidCommunicationInputError();
  return result;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function sourceColumns(source: CommunicationSourceReference | null) {
  return {
    sourceVisitId: source?.type === 'visit' ? source.id : null,
    sourceAgreementId: source?.type === 'service_agreement' ? source.id : null,
    sourceTaskId: source?.type === 'operations_task' ? source.id : null,
    sourceInvoiceId: source?.type === 'invoice' ? source.id : null,
    sourceClaimId: source?.type === 'claim' ? source.id : null,
    sourceDocumentId: source?.type === 'document' ? source.id : null,
  };
}

function sourceId(row: typeof interactions.$inferSelect) {
  switch (row.sourceType) {
    case 'visit':
      return row.sourceVisitId;
    case 'service_agreement':
      return row.sourceAgreementId;
    case 'operations_task':
      return row.sourceTaskId;
    case 'invoice':
      return row.sourceInvoiceId;
    case 'claim':
      return row.sourceClaimId;
    case 'document':
      return row.sourceDocumentId;
    default:
      return null;
  }
}

function sourcePermission(type: CommunicationSourceType): Permission {
  switch (type) {
    case 'visit':
      return 'schedule.read';
    case 'service_agreement':
      return 'service_agreement.read';
    case 'operations_task':
      return 'operations.read';
    case 'invoice':
      return 'billing.read';
    case 'claim':
      return 'claims.read';
    case 'document':
      return 'documents.read';
  }
}

function interactionView(row: typeof interactions.$inferSelect, principal: AuthorizationPrincipal) {
  const resource: ResourceContext = {
    tenantId: row.tenantId,
    ...(row.organizationId ? { organizationId: row.organizationId } : {}),
    ...(row.facilityId ? { facilityId: row.facilityId } : {}),
    clientId: row.clientId,
  };
  const id = sourceId(row);
  const source =
    row.sourceType && id && can(principal, { action: sourcePermission(row.sourceType), resource })
      ? { type: row.sourceType, id }
      : null;
  return {
    id: row.id,
    clientId: row.clientId,
    contactId: row.contactId,
    contactLabel: row.contactLabelSnapshot,
    contactAuthorization: row.contactAuthorization,
    direction: row.direction,
    channel: row.channel,
    category: row.category,
    subject: row.subject,
    summary: row.summary,
    outcome: row.outcome,
    occurredAt: row.occurredAt.toISOString(),
    recordedByUserId: row.recordedByUserId,
    source,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function followUpStatusFor(
  outcome: InteractionOutcome,
  taskSummary: { hasOpen: boolean; hasOverdue: boolean; hasCompleted: boolean } | undefined,
): 'needs_task' | 'open' | 'overdue' | 'completed' | 'none' {
  if (taskSummary?.hasOverdue) return 'overdue';
  if (taskSummary?.hasOpen) return 'open';
  if (taskSummary?.hasCompleted) return 'completed';
  return outcome === 'action_required' ? 'needs_task' : 'none';
}

function interactionOrder(query: CommunicationListQuery, includeClient = false): SQL[] {
  const direction = (expression: SQLWrapper) =>
    query.order === 'asc' ? asc(expression) : desc(expression);
  const recentFirst = [desc(interactions.occurredAt), desc(interactions.id)];
  switch (query.sort ?? 'occurredAt') {
    case 'client':
      return includeClient
        ? [
            direction(sql`coalesce(${clientRecords.preferredName}, ${clientRecords.firstName})`),
            direction(clientRecords.lastName),
            ...recentFirst,
          ]
        : recentFirst;
    case 'subject':
      return [direction(interactions.subject), ...recentFirst];
    case 'channel':
      return [direction(interactions.channel), ...recentFirst];
    default:
      return [direction(interactions.occurredAt), direction(interactions.id)];
  }
}

function resourceFor(client: {
  id: string;
  tenantId: string;
  organizationId: string | null;
  primaryFacilityId: string | null;
}): ResourceContext {
  return {
    tenantId: client.tenantId,
    ...(client.organizationId ? { organizationId: client.organizationId } : {}),
    ...(client.primaryFacilityId ? { facilityId: client.primaryFacilityId } : {}),
    clientId: client.id,
  };
}

function canReadCommunication(principal: AuthorizationPrincipal, resource: ResourceContext) {
  return (
    can(principal, { action: 'client.read', resource }) &&
    can(principal, { action: 'communications.read', resource })
  );
}

function permissionScopes(
  principal: AuthorizationPrincipal,
  permission: Permission,
): Array<SQL | undefined> | null {
  const grants = principal.grants.filter((grant) => grant.permission === permission);
  if (grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId))
    return [undefined];
  const scopes: SQL[] = [];
  for (const grant of grants) {
    if (grant.scopeType === 'organization')
      scopes.push(eq(clientRecords.organizationId, grant.scopeId));
    else if (grant.scopeType === 'facility')
      scopes.push(eq(clientRecords.primaryFacilityId, grant.scopeId));
  }
  return scopes.length ? scopes : null;
}

function preferenceView(row: typeof clientCommunicationPreferences.$inferSelect) {
  return {
    consentStatus: 'unknown' as const,
    clientId: row.clientId,
    preferredChannel: row.preferredChannel,
    preferredLanguage: row.preferredLanguage,
    preferredContactId: row.preferredContactId,
    preferredContactTimes: row.preferredContactTimes,
    correspondencePreference: row.correspondencePreference,
    contactRestrictions: row.contactRestrictions,
    version: row.version,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function defaultPreferences(clientId: string) {
  return {
    consentStatus: 'unknown' as const,
    clientId,
    preferredChannel: null,
    preferredLanguage: null,
    preferredContactId: null,
    preferredContactTimes: null,
    correspondencePreference: 'unspecified' as const,
    contactRestrictions: null,
    version: 0,
    updatedByUserId: null,
    updatedAt: null,
  };
}
