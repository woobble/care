# ADR 0007: Store domain events in a transactional outbox

- Status: Accepted
- Date: 2026-10-06

## Context

Client writes produce events for asynchronous work. Writing directly to Redis after a database commit can lose events when the process stops between the two writes.

## Decision

Write each domain event to PostgreSQL in the same transaction as its client and audit changes. A worker leases pending rows, dispatches each event to registered handlers, then records delivery or retry state in PostgreSQL. Redis remains in local infrastructure; add BullMQ when queue-backed jobs enter scope.

## Consequences

The database is the durable source of event delivery state. Dispatch is at least once, so handlers must be safe to retry. Failed work returns to the outbox with bounded exponential backoff and eventually enters a dead state.

## Alternatives considered

- Publish to Redis after committing domain state: rejected because a process failure between the two operations can lose the event.
- Use PostgreSQL logical replication: rejected because it complicates event contracts and module ownership for this initial slice.
- Adopt full event sourcing: rejected because the platform needs durable integration events, not event-sourced aggregate storage.
