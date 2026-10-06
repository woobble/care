# ADR 0008: Expose a versioned REST API with generated OpenAPI types

- Status: Accepted
- Date: 2026-10-06

## Context

The web application and future clients need a stable API contract. Hand-maintained request and response types can drift from the server.

## Decision

Expose versioned REST routes from NestJS, generate OpenAPI from controller DTOs, and generate the TypeScript client types consumed by the web app.

## Consequences

HTTP DTOs remain explicit at the API boundary. API changes update the generated contract through the build pipeline.

## Alternatives considered

- GraphQL: rejected because the initial slice has a small command and query surface that fits REST.
- Handwritten frontend request types: rejected because they duplicate server contracts and can silently drift.
- A code-first client generator independent of OpenAPI: rejected because OpenAPI is also useful for API inspection and external clients.
