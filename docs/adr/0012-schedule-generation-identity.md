# ADR 0012: Durable schedule generation identity

## Status

Accepted

## Context

Office users need to generate bounded visit ranges repeatedly. Retries and concurrent commands must not create duplicate visits, and regenerated agreement intent must not overwrite visits that staff already adjusted. A generation operation also writes visits, snapshots, audit, and outbox records that must commit together.

## Decision

Store one generation key on each generated `VisitService`, using `<agreementServiceId>:<local-occurrence-date>`. Enforce uniqueness by tenant with a partial unique index. Serialize generation and competing client scheduling commands with transaction-scoped advisory locks on the client; acquire multiple client and employee locks in stable sorted order. Persist a summary row for every successful generation command.

When a key already exists, generation counts it and leaves its visit unchanged. Agreement edits do not update existing visits. All writes for one command are atomic.

## Consequences

- Repeating and concurrent requests are idempotent across overlapping ranges.
- Manual changes remain intact without a reconciliation engine or dirty-state protocol.
- A key identifies a service occurrence, so several service lines can share one visit.
- Staff must resolve or cancel future visits before incompatible agreement changes.
- Client-level locking serializes otherwise unrelated occurrences for the same client, which keeps conflict checks simple and correct for this planning volume.
