# ADR 0009: Use UUIDv7 for entity identifiers

- Status: Accepted
- Date: 2026-10-06

## Context

Domain entities need identifiers that can be generated without a central sequence and remain index-friendly as records grow.

## Decision

Generate UUIDv7 identifiers for every internally generated identifier, including domain entities, Better Auth users, sessions, accounts, verifications, audit records, and events. Keep internal database IDs out of public application contracts. UUIDv4 remains valid at API and database boundaries for compatibility with existing callers.

The final platform migration replaces stored non-v7 UUID entity IDs and Better Auth local record IDs with UUIDv7 values. It updates UUID references, Better Auth user links, and UUID references in structured audit metadata and outbox events. Existing UUIDv7 IDs and external identity provider subjects and account IDs remain unchanged. Old internal IDs stop resolving after the migration, so clients must refresh them.

## Consequences

Identifiers can be created before database writes and sort roughly by creation time. Tests and integrations must treat identifiers as opaque UUIDs. Better Auth local IDs follow the same generation rule; provider-issued IDs and non-ID randomness remain unchanged.

## Alternatives considered

- Sequential integer IDs: rejected because they expose record order and require centralized allocation.
- Random UUIDv4: rejected because UUIDv7 improves index locality while retaining decentralized generation.
- ULIDs: rejected to use the standard UUID type supported directly by PostgreSQL and tooling.
