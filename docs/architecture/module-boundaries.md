# Module boundaries

Care remains a NestJS/Fastify/Bun modular monolith using Drizzle and PostgreSQL. Each module owns its business rules, application services, types, tables, repositories, events and numbered migrations. Cross-domain orchestration calls owner-facing APIs; a public table export does not grant permission to query it.

## Ownership matrix

| Module             | Owned responsibilities and persistence                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity           | Local users, external identity links, memberships, roles/scopes, invitations, Better Auth sessions (`schema.ts`, `auth-schema.ts`)                                      |
| organizations      | Tenants, provider organizations, facilities, teams                                                                                                                      |
| employees          | Employee records, assignments, qualifications and skills                                                                                                                |
| clients            | Client records, contacts/roles, insurance, Pflegegrad and timeline                                                                                                      |
| services           | Service catalog, categories, availability and dated prices                                                                                                              |
| service-agreements | Agreed service lines, cadence, validity and agreement lifecycle                                                                                                         |
| scheduling         | Planned visits/services/assignments, availability, tours, routing context and calendar subscriptions                                                                    |
| visit-execution    | Actual execution, performers, performed services and corrections                                                                                                        |
| care-documentation | Notes, incidents, completeness, finalization and amendment history                                                                                                      |
| service-evidence   | Evidence packages, finalized service snapshots and acknowledgements                                                                                                     |
| benefits           | Funding, entitlements, rules, buckets, balances and allocations                                                                                                         |
| billing            | Billing profiles, payer arrangements, invoices, reservations, corrections, payments, receivables and claims (`schema.ts`, `claims/schema.ts`, `claims/payer-schema.ts`) |
| documents          | Document templates, artifacts and generation workflows                                                                                                                  |
| communications     | Interactions, prospect interactions, amendments and communication preferences                                                                                           |
| onboarding         | Admission cases, assessments, checklist templates/responses, links and transitions                                                                                      |
| operations         | Office tasks, recurrence, reminders, worklist projections and exception history; source facts remain with their owners                                                  |
| audit              | Transactional audit records and audit writer                                                                                                                            |
| platform           | Transactional outbox, delivery state and outbox writer                                                                                                                  |

The executable map is `scripts/architecture/ownership.json`: every module's public entry point and persistence files are listed. New modules or newly named schema files must be mapped. Nonstandard persistence filenames must also be registered in review. See [the dependency map](dependency-map.md) for actual edges and existing debt.

## Directions and interfaces

- Applications compose modules and shared infrastructure. Domain modules may depend on shared packages and other modules' exported application/query interfaces, contracts and pure domain APIs, provided the module graph stays acyclic.
- Cross-module imports must resolve to `modules/<owner>/src/index.ts`. Relative paths and `@module/*` aliases do not bypass the rule. Own-module implementation imports remain permitted.
- Exporting tables from a root barrel supports schema composition and existing callers; importing a foreign persistence value into application/domain/repository code is prohibited. The checker follows named, star, namespace, aliased and imported-local re-exports. Interface/type-alias declarations in schemas are not persistence values; `import type { table }` still exposes persistence and is checked.
- API presentation should call application services. Web should consume API client/contracts/UI, without importing backend modules. The server-side Better Auth schema adapter is an explicit exception.
- Shared packages must not import domain modules. Database owns connections, transaction propagation and migration infrastructure, not domain queries. Contracts/API client own transport shapes; Events owns envelopes/dispatch; Permissions owns the shared permission vocabulary and resource evaluator, deliberately including domain permission names. Auth owns token verification; Config, Logging, Observability, Storage and UI remain infrastructure. Testing owns test database setup. No shared-package-to-domain TypeScript import violations were found.

## Composition and dependency injection

`apps/api/src/modules/*.module.ts` binds application factories/classes to symbols in `apps/api/src/tokens.ts`. Modules receive `UnitOfWork`, `AuditWriter`, `OutboxWriter` and narrow service capabilities from the composition root. For example, `OperationsSourceServices` uses `Pick` interfaces for Scheduling, Execution, Documentation, Evidence, Benefits, Billing and Claims, and a structural Onboarding interface. This avoids Operations importing Onboarding while Onboarding already imports Operations. Keep such dependencies explicit; avoid service locators and `forwardRef` as a way to conceal cycles.

Owner-facing methods must apply tenant and resource authorization. Passing a principal is not sufficient without enforcing its grants. Reads requiring atomic consistency and mutations must retain existing UnitOfWork, RLS, locking, audit/outbox and rollback semantics. The ownership check does not prove these runtime properties.

Legitimate patterns include querying Scheduling's public worklist API, injecting Execution's planning guard into Scheduling at the application root, and owner APIs returning bounded read projections. Foreign schema references for database foreign keys are also legitimate; those do not authorize cross-domain application queries.

## Enforcement and baseline

Run `bun run architecture:check` and `bun run architecture:test`. Both work without Docker, service startup or credentials. CI runs both after dependency installation. The check parses TypeScript/TSX with Oxc, resolves relative imports, workspace exports (including wildcard exports), and nearest tsconfig path aliases inherited through relative `extends`. It inspects static imports/re-exports, literal dynamic imports, literal `require`, and import types. Namespace/dynamic imports conservatively expose all persistence exports.

Diagnostics include source path, current line, imported symbol, target/owning schema and a reason. The module graph includes type-only and schema edges; every import edge participating in a cycle is checked individually so a baseline cannot hide a new edge inside an existing cycle. Output ordering is deterministic. Parse errors, unmapped modules/schema filenames, unresolved internal imports and new violations fail the command.

`scripts/architecture/baseline.json` is the initial auditable debt ledger. The stable identity is `(kind, file, symbol, target)`, so line movement does not create false additions. Existing entries pass; new entries fail. Resolved entries are reported for explicit removal. No routine command writes or expands the baseline. The baseline permits the same dependency again in the same file; it is an import-dependency ledger, not a query-count ledger.

To assess a change, use `bun scripts/architecture/check.mjs --report` for a read-only JSON report. Remove resolved baseline entries in the refactoring PR. New baseline debt requires explicit architectural review and a documented reason/migration plan; do not replace the ledger with a fresh report to make CI pass.

Exceptions are exact file lists with allowed rule kinds and a reason in the ownership map. They cover schema foreign keys, API database schema assembly, migration/seed entry points, worker bootstrap, integration fixtures/assertions and server-side Better Auth schema composition. Exceptions do not disable cycle analysis. New files do not inherit another file's exception. Review changes to exceptions and ownership alongside application code; do not grant whole-domain application exceptions.

## Limits and debt

This is a static import check, not a security proof or whole-program dataflow analysis. It does not inspect SQL strings, infer foreign tables hidden in computed objects/return types, follow nonliteral dynamic loading, resolve arbitrary Node conditions or package-based tsconfig inheritance, or interpret Nest injection metadata. JSON tsconfigs and relative extends match this repository's current configuration. Generated API client files, declarations and build outputs are excluded. It does not enforce package.json dependency declarations or inspect SQL migration contents.

Persistence values exported by mapped schema files (including schema aggregates/enums/helpers) are conservatively private; move legitimate pure contracts out of persistence before widening an exception. A table introduced under a nonstandard filename requires an ownership-map update. Review remains responsible for these gaps.

The scan identified 151 foreign persistence imports, six private-file imports and seven Web dependency-direction violations after the legitimate composition exceptions. There are no direct module import cycles in the current source graph. Onboarding's three private Services imports now use existing public exports; no business logic changed. Follow the ordered debt list and exact locations in the [dependency map](dependency-map.md) and baseline. Goal 02 preparation is in [the handoff](goal-01-to-goal-02.md).

## Operations expiry capabilities (Goal 02)

Operations composes `AgreementExpiryQueries`, `QualificationExpiryQueries`, `BenefitEntitlementExpiryQueries` and `PayerArrangementExpiryQueries` through narrow `operationsExpiryPage` capabilities. Owners query only their own persistence and authorize facts; Clients supplies bounded authorized display/provider context inside the source transaction. Pages retain deterministic `(validUntil, id)` ordering and size 100. Completeness describes the raw scan: an empty authorized page may require another read. Operations retains projection, policy, permission intersection and history; failed scans never become complete reconciliation domains.

`OrganizationApplicationService.operationsTimezones` exposes only ID/timezone pairs for Operations-visible organizations, including organization ownership of facility grants. Ordinary batches contain at most 100 IDs; the existing 1,000-item dashboard is also bounded. Task validation, workers and reconciliation SQL remain separately baselined debt. See [Goal 02 to Goal 03](goal-02-to-goal-03.md) for verified behavior and limitations.
