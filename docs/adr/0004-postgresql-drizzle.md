# ADR 0004: Use PostgreSQL with Drizzle

- Status: Accepted
- Date: 2026-10-06

## Context

The platform stores sensitive tenant data and needs reliable transactions, row-level security, and clear table ownership across domain modules.

## Decision

Use PostgreSQL for authoritative data and Drizzle for typed SQL mappings. Keep each module's schema and migrations with that module. The shared database package owns connections, transaction propagation, and migration execution.

## Consequences

PostgreSQL integration tests exercise production constraints and policies. Domain packages can evolve their schemas without a central table registry becoming the owner of every domain.

## Alternatives considered

- Prisma: rejected because module-local Drizzle schemas and explicit SQL fit the ownership and RLS requirements.
- TypeORM: rejected because the platform does not need entity-manager behavior or decorator-driven persistence.
- SQLite: rejected because it cannot validate the required PostgreSQL RLS and transaction behavior.
