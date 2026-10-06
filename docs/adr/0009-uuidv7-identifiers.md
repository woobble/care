# ADR 0009: Use UUIDv7 for entity identifiers

- Status: Accepted
- Date: 2026-10-06

## Context

Domain entities need identifiers that can be generated without a central sequence and remain index-friendly as records grow.

## Decision

Generate UUIDv7 identifiers for users, tenants, clients, audit records, and events. Keep internal database IDs out of public application contracts.

## Consequences

Identifiers can be created before database writes and sort roughly by creation time. Tests and integrations must treat identifiers as opaque UUIDs.

## Alternatives considered

- Sequential integer IDs: rejected because they expose record order and require centralized allocation.
- Random UUIDv4: rejected because UUIDv7 improves index locality while retaining decentralized generation.
- ULIDs: rejected to use the standard UUID type supported directly by PostgreSQL and tooling.
