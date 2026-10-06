# ADR 0002: Use Bun for workspace tooling and compatible backend runtime

- Status: Accepted
- Date: 2026-10-06

## Context

The platform needs one fast package manager and task workflow across web, API, worker, and domain packages. Backend code should remain usable from Node where practical.

## Decision

Use Bun workspaces and Bun for package management, scripts, tests, and backend execution where compatible. Use Turborepo for dependency-aware tasks. Keep domain code on standard TypeScript and Node APIs.

## Consequences

One `bun.lock` describes the workspace. Backend builds and tests share the same runtime. Runtime-specific APIs stay at infrastructure boundaries.

## Alternatives considered

- npm workspaces: rejected because Bun already supplies the required install and script workflow.
- pnpm or Yarn: rejected to keep one package manager and one lockfile.
- Node for every task: rejected because it would add a second package and script toolchain without improving this stack.
