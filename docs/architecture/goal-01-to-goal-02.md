# Goal 01 → Goal 02: Decouple Operations Worklist from Cross-Domain Persistence

## A. Implementation Summary

Goal 01 adds executable import boundary enforcement and makes a small existing boundary repair without intentionally changing application behavior.

Created:

- `scripts/architecture/check.mjs`: TypeScript import/re-export parser, workspace/alias resolver, persistence provenance traversal, private-file/direction checks, module cycle detection, deterministic diagnostics and exact baseline comparison.
- `scripts/architecture/check.test.mjs`: focused temporary-workspace tests, including actual CLI success/failure exit codes and baseline non-mutation.
- `scripts/architecture/ownership.json`: public entry points, persistence ownership and exact-file infrastructure exceptions.
- `scripts/architecture/baseline.json`: 164 existing import violations, each with path, symbol, schema/target, line and reason. Routine checks cannot write it.
- `docs/architecture/module-boundaries.md`, `dependency-map.md`, and this handoff: policy, actual dependency/debt inventory and the next implementation scope.

Modified:

- Root `package.json`: `architecture:check`, `architecture:test`, and `oxc-parser` development dependency; `bun.lock` records the parser and platform bindings. TypeScript 7's root package no longer exposes the previous compiler parser API, so Oxc supplies a focused syntax parser.
- `.github/workflows/ci.yml`: architecture validation and focused tests run after dependency installation without Docker or credentials.
- `modules/onboarding/src/application/onboarding.application.ts`: three imports now use existing `@care/services` exports instead of Services implementation files.
- `docs/architecture/overview.md`: links to the enforced policy, inventory and handoff.

No files removed, HTTP contracts intentionally changed, database migrations edited, tenant data touched, or Goal 02 query refactoring implemented. Generated API files remain generated through the build.

## B. Architectural Decisions

Domain-owned rules, use cases, persistence, types, events and migrations remain inside modules. Composition roots inject public application capabilities; shared infrastructure must not depend on domain modules. Modules may use another module's public pure domain API/application contract, with no cycles. Root barrels remain available for infrastructure assembly; table exports are not application read contracts.

Persistence provenance follows named, aliased, star, namespace and imported-local re-exports. Type-only imports of table values are checked; pure declared interfaces/type aliases are allowed. Each cycle edge is independently baselineable, including type/schema edges, so an existing cycle cannot hide additional coupling. The current graph has no direct module import cycles. Structural injected interfaces can have runtime call relationships the import graph does not show.

Exact-file exceptions cover foreign-key schemas, infrastructure schema/bootstrap/seed/migration code, integration fixture assertions and the Better Auth server schema adapter. They do not disable cycle detection. No general application-service persistence exception was granted.

Baseline identity excludes line numbers and includes rule, file, symbol and target. Removing code reports a resolved entry; new dependencies fail. No baseline-write mode exists. Review additions explicitly with a reason and removal plan.

Limits: static imports do not prove authorization or transactional safety. Raw SQL, computed table aliases/objects, inferred types, nonliteral loading, Nest injection metadata and arbitrary module-resolution conditions are not fully analyzed. Schema values are conservatively persistence capabilities. New nonstandard persistence filenames must be added to ownership. Generated API client/declaration/build output is excluded. See the policy for resolver support and exception details.

## C. Remaining Technical Debt

Confirmed priority order:

1. **Operations:** 33 foreign persistence imports across its application services. `modules/operations/src/application/operations.application.ts:36` starts its foreign table imports. The worklist mixes injected source APIs with four direct deadline queries, context/name/timezone reads and cross-domain reconciliation predicates. Details below. `deadline-scheduler.application.ts` and `operations-guards.ts` retain additional debt.
2. **Onboarding:** `modules/onboarding/src/application/onboarding.application.ts:24` onward imports Benefits, Clients, Communications, Documents, Employees, Identity, Operations, Organizations, Scheduling and Agreement tables for readiness/link/source operations. The private Services imports were repaired; 19 persistence imports remain.
3. **Communications:** `modules/communications/src/application/communications.application.ts:21` onward imports Billing, Clients, Documents, Identity, Operations, Scheduling and Agreement persistence for contact/source/task projections (10 persistence imports).
4. **Billing and delivery:** Billing has 17 persistence imports; Service Evidence 12; Visit Execution 12; Benefits 10; Scheduling 8; Care Documentation 7. These need owner-facing query/guard contracts preserving locks, snapshots and invariants. Exact symbols and current locations are in `scripts/architecture/baseline.json`.
5. **Web:** `apps/web/src/components/agreement-cost-summary.tsx:12`, `agreement-service-fields.tsx:13` reach private Services pricing code/types. `apps/web/src/app/(office)/planning/page.tsx:33` imports Scheduling availability from the backend root barrel. These account for six private imports and seven direction violations; choose a pure shared contract before changing browser imports.
6. **API and master-data guards:** the dependency map lists the remaining API table reads and master-data cross-domain checks by source file. Do not hide these inside shared repositories.

Additional confirmed debt outside automated import findings: `operations.application.ts:3029` uses SQL strings to read `communications.interactions` joined with `clients.clients` in `validateSource`. It is tenant-qualified and followed by source permission checks, but still violates source ownership. It must be migrated deliberately; it is not counted among the 164 import findings.

Potential improvements, not additional confirmed violations: narrow public barrel surfaces; replace table-inferred public types with owned DTOs; add event-specific worker consumers when a real side effect is needed. Package permission names reflect a legitimate shared authorization registry. Existing schema foreign keys and worker/bootstrap schema assembly are legitimate exceptions.

## D. Verification Results

Executed successfully for Goal 01:

- `bun run architecture:check`: 164 baseline findings, zero new findings, zero resolved entries at initial capture.
- `bun run architecture:test`: 15 focused tests, including valid imports, forbidden private/table imports, provenance through barrels, cycles, alias/wildcard resolution and real CLI baseline exit behavior.
- `bun run lint`: 33 successful Turbo tasks.
- `bun run typecheck`: 33 successful Turbo tasks.
- `bun run test`: 51 successful Turbo tasks, no failures.
- `bun run build`: OpenAPI generation and all 32 build tasks succeeded (27 cached at execution). No generated API/OpenAPI diff resulted.
- `graphify update .`: AST graph refresh succeeded without API cost.
- Required `bunx oxlint --fix`, repository `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'`, and final `bunx oxlint --deny-warnings --format=agent` succeeded.

Database integration and browser E2E were not executed for this import/tooling change. Existing runtime behavior is supported by the existing unit/build checks and the import-only application diff, not a fresh PostgreSQL/E2E run. Goal 02 changes queries and must run the integration coverage below.

## E. Goal 02 Preparation

### Source tables and owners

`modules/operations/src/application/operations.application.ts` contains these direct foreign accesses:

| Tables                                                                                                 | Owner                      | Worklist/source usage                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `agreements`                                                                                           | Service Agreements         | Deadline query at 1354–1396; stale agreement issue validation; task source validation                                       |
| `employeeQualifications`, `employeeRecords`, `qualificationDefinitions`, `employeeFacilityAssignments` | Employees                  | Qualification deadline query at 1433–1498; stale qualification checks, user-to-employee lookup and task assignee enrichment |
| `clientBenefitEntitlements`, `benefitFundingSources`                                                   | Benefits                   | Entitlement expiry query at 1537–1594; task source validation                                                               |
| `payerArrangements`, `invoices`, `claims`                                                              | Billing (including Claims) | Payer mandate expiry query at 1631–1676; invoice/claim task source validation                                               |
| `clientRecords`                                                                                        | Clients                    | Display names/provider scope joins in three deadline sources; `clientResources` at 3146; client/task validation             |
| `organizationsTable`, `facilities`                                                                     | Organizations              | `organizationTimezones` at 3172; reminder settings and task provider validation                                             |
| `visits`                                                                                               | Scheduling                 | Task validation; bounded reconciliation source predicate in `completeSourceEntityScope` at 4408                             |
| `careDocuments`                                                                                        | Care Documentation         | Evidence reconciliation joins at 4439 onward                                                                                |
| `evidencePackages`                                                                                     | Service Evidence           | Evidence reconciliation joins and task validation                                                                           |
| `documentArtifacts`                                                                                    | Documents                  | Task source validation at 3018 onward                                                                                       |
| `tenantMemberships`, `users`                                                                           | Identity                   | Activity author display at 2336; not a deadline source                                                                      |
| `communications.interactions` (SQL string)                                                             | Communications             | `validateSource` communication branch at 3029; not a worklist deadline source                                               |

Operations-owned tasks, reminder policies, scheduler runs, activity and exception tables remain local and should stay local.

### Existing APIs and missing contracts

`OperationsSourceServices` at line 163 already injects:

- Scheduling `getWorklist`, `getWorklistForVisit`.
- Execution `operationsSummaries`, `operationsIssueState`.
- Care Documentation `worklist`, `getForVisit`.
- Evidence `worklist`, `getPackage`.
- Benefits `getWorklist`, `listUnallocatedServices`.
- Billing `listInvoicesPage`, `receivablesPage`; Claims `listClaims`, `readiness`, `readinessForClaims`.
- Onboarding `operationsReadinessWorklist`, `operationsIssueState` through a structural interface.

Continue using these; do not recreate them. Benefits carryover is already computed through the public Benefits projection; payer expiry and entitlement expiry are separate missing reads.

Service Agreements exposes `search`, `listForClient`, `get` in `service-agreement.application.ts:88`. Employees exposes `search` (`employee.service.ts:154`) and qualification catalog/list operations (`:940` onward). Organizations exposes organization/facility search/list APIs (`organization.service.ts:86` onward). These are candidates to reuse, but are not drop-in deadline contracts: the exact expiry predicates, ordering, permission intersection, bounded paging and timezone enrichment must be checked before substitution. Employees qualification catalog operations are not a tenant-wide qualification-expiry projection.

Missing focused reads: agreement expiry page; employee qualification expiry page; active benefit-entitlement expiry page; authorized payer-arrangement expiry page. Each belongs to its source owner and should return source facts with minimal authorized client/employee display/provider context. A batch Organizations timezone read can remove repeated enrichment SQL; a batch Clients resource-context read and Scheduling/Evidence completeness probes are later needed to remove all worklist persistence access.

The public Onboarding `readOperationsDeadlineCases` accepts a transaction and tenant ID for the restricted worker path. It does not accept/enforce an Office principal; do not reuse it as an authorized Office API without an owner-side authorization boundary.

### Security and compatibility

Worklist gates start at `listWorkItems:577`, source permission selection at 596, scope extraction at 620 and final item filtering/collection at 665. Preserve `operations.read`, source-specific grants and client visibility as intersecting constraints. Examples: Benefits deadlines require `benefits.review`, receivables `billing.payments.read`, payer arrangements `billing.read`, documentation `care_documentation.review`, and employee qualifications `employee.read`. Do not widen scopes by passing only tenant ID to an unrestricted query.

Retain tenant-qualified joins, tenant UnitOfWork/RLS context, organization/facility/client filters, employee applicability, inactive/status exclusions, mandate effective dates and stable ordering. Preserve current provider scope semantics rather than accidentally adopting broader list semantics. Client names require visibility; do not leak identifiers as names.

Operations owns item IDs, issue codes, categories/severity, timezone end-of-day rules, policy offsets, snooze/acknowledgement and history. It owns reconciliation updates and audit/outbox writes. The source owns current facts and authorization. Unavailable/incomplete sources must not resolve unseen issues: `reconcileStaleExceptionOccurrences:3295` and `syncExceptionOccurrences:3477` are sensitive. `completeSourceEntityScope:4408` limits resolution by the scanned window and source visibility. Preserve it until an equivalent owner contract is proven.

### Coverage and performance

`apps/api/integration/operations.integration.test.ts:33` is one broad PostgreSQL/API scenario protecting projections, tenant/source restrictions, task history, deadline worker retry/idempotency, reminders and scope. Relevant assertion regions: snooze/history and out-of-window reconciliation around 1472–1547, provider/client work-queue filtering around 1612–1634, paginated executions at 1958–1960, scoped task visibility around 1999–2009, deadline resolution at 2157, and onboarding pagination at 2179–2182. Extend this scenario or add focused integration cases for the new owner reads and denied/intersecting permissions.

`modules/operations/src/domain/operations.test.ts` and `recurrence.test.ts` cover pure issue/recurrence rules, not SQL authorization equivalence. `apps/web/e2e/office-operations.spec.ts` protects the Office workflow; preserve its contracts.

Current SQL streams pages of 100 with deterministic `(validUntil, id)` ordering. Final filters precede combined sorting/pagination, and `truncated` describes incomplete source reads. Preserve this behavior. Avoid one source call or name/timezone lookup per item, unbounded full-table fetches and multiplying cross-source transactions. Stale reconciliation is limited to 20 candidates from a 200-row read and intentionally sequential. New contracts should keep page size/order/completeness explicit; changing pagination strategy concurrently adds avoidable risk.

## F. Recommended Goal 02 Execution Plan

The smallest coherent first scope is **the four direct deadline-source reads inside `listWorkItems`, plus batched timezone enrichment**. Move facts and authorization behind the four owner APIs, retaining Operations policy/projection/history. This is a first worklist slice, not a claim that every Operations persistence import disappears. Defer task/source validation, deadline worker, assignee guards and reconciliation SQL to separately verified follow-ups. A complete worklist decoupling will additionally need Clients context and Scheduling/Evidence reconciliation contracts; do not widen the first change to the entire module.

1. Likely files: `modules/operations/src/application/operations.application.ts`, source-owner application/repository files in Service Agreements, Employees, Benefits, Billing and Organizations, each affected `src/index.ts`, `apps/api/src/modules/operations.module.ts`, relevant owner Nest composition modules, Operations package dependency declarations, architecture baseline/dependency docs and `apps/api/integration/operations.integration.test.ts`.
2. Proposed contracts: owner-specific `operationsExpiryPage(principal, { fromDate, untilDate, organizationId?, facilityId?, clientId?, employeeId?, offset, pageSize })` methods with appropriate filters per owner. Return minimal typed facts (`sourceId`, provider context, authorized name, expiry date) and explicit page completeness/next-page information. Organizations owns a bounded `timezonesForOrganizations(principal, ids)` lookup. Adapt names to existing conventions; avoid a shared generic repository or common cross-domain SQL DTO framework.
3. First characterize current authorization/status/date/pagination behavior with integration cases. Add owner queries and exports; inject narrow capabilities through `OperationsSourceServices` and Nest factories. Replace one source branch at a time while preserving projection and pagination. Reuse owner public Clients APIs where suitable for names/context; do not simply move foreign SQL into another application module and add baseline debt.
4. Preserve endpoints/OpenAPI, tenant RLS, source/client permission intersections, transactional audit/outbox, stable IDs, filters, DST/timezone cutoffs, stale issue behavior and source failure isolation. Do not remove a table import still used by deferred validation/reconciliation.
5. Run architecture checks/tests, focused owner tests, Operations PostgreSQL/API integration, relevant Office E2E when available, lint, typecheck, unit tests and build. Compare authorized outputs, totals, ordering and failure behavior across page boundaries, not just the presence of one deadline. Remove only baseline dependencies actually eliminated; document any import whose other call sites remain.
6. Risks/open decisions: compatible owner APIs may differ in client-scope filtering; names and timezones need authorized bulk contracts; worker reads have different restricted credentials; future completeness probes must preserve transactional/window semantics. Establish a query-count/latency comparison on multi-page data. Decide whether to return timezone with each source projection or use the Organizations batch capability; avoid broadening public organization data solely for enrichment.

### Copy-ready Goal 02 Codex prompt

> Implement Goal 02 in `woobble/care`: decouple the four direct deadline-source queries in `modules/operations/src/application/operations.application.ts:listWorkItems` from foreign persistence, plus its batched organization-timezone enrichment. Read `docs/architecture/overview.md`, `module-boundaries.md`, `dependency-map.md`, `goal-01-to-goal-02.md` and relevant domain docs first. Inspect the current worktree and use graphify as required. Do not use multi-agent mode.
>
> Add or reuse narrow authorized owner APIs for Service Agreement expiry, Employee qualification expiry, Benefit entitlement expiry, authorized Billing payer-arrangement expiry and Organizations timezone lookup. Inject capabilities through `OperationsSourceServices` and Nest composition. Source modules own facts and authorization; Operations keeps policy, item identity, projection, filtering, sorting, pagination and history. Avoid introducing new foreign-table debt in the owners when resolving client display/context. Preserve all current scope intersections, tenant-qualified joins/RLS, statuses, date rules, bounded pages, completeness/truncation, failure isolation, audit/outbox and HTTP/OpenAPI behavior.
>
> Keep task validation, deadline-worker SQL, assignee guards and Scheduling/Evidence reconciliation SQL outside this first slice. Do not claim complete Operations decoupling while these remain. Characterize and verify current behavior with PostgreSQL/API integration, including denied scopes, multi-page ordering/totals and source failures. Run architecture checks and focused tests, lint, typecheck, unit tests and build; run relevant Office E2E where feasible. Remove only resolved baseline entries, never regenerate/expand the baseline. Report exact changes, verified results, query/performance effects and remaining worklist debt. Do not change migrations, tenant data or public endpoints.
