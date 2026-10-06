# ADR 0001: Start as a modular monolith

- Status: Accepted
- Date: 2026-10-06

## Context

The platform is early in development. The web app, API, and event worker need clear ownership, but separate deployable services for every domain would add operational work before their boundaries are proven.

## Decision

Keep deployable apps in one Bun workspace. Keep domain modules and shared infrastructure packages in that workspace. The NestJS API composes the modules; the web app uses the generated OpenAPI client; the worker consumes events from the PostgreSQL outbox.

## Consequences

Workspace dependencies stay version-aligned and local changes are easy to coordinate. Each app can still have its own Docker image. Module boundaries remain code ownership boundaries, not network boundaries.

## Alternatives considered

- Separate services per domain: rejected because they add network and deployment costs before module boundaries are proven.
- One unstructured application: rejected because it would make domain ownership and independent change harder to preserve.
