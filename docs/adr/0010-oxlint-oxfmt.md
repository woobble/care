# ADR 0010: Use Oxlint and Oxfmt

- Status: Accepted
- Date: 2026-10-06

## Context

The TypeScript monorepo needs fast, consistent linting and formatting that works across every workspace.

## Decision

Use Oxlint for lint checks and Oxfmt for formatting. Run both through workspace scripts and Turborepo.

## Consequences

Lint and format checks share one toolchain. Formatter settings live at the repository root, and generated files are excluded where regeneration owns their formatting.

## Alternatives considered

- ESLint and Prettier: rejected because the repository standardizes on the Oxc toolchain.
- Per-package formatter settings: rejected because inconsistent output would add maintenance without a domain need.
- No formatter: rejected because style drift raises review cost across the workspace.
