# Dependency and violation map

Goal 02 source snapshot. Refresh this report deliberately after architectural changes; `bun scripts/architecture/check.mjs --report` prints the current machine-readable map without changing the baseline. Import edges include types, schema declarations and re-exports. This is not a runtime call graph.

## Observed module dependencies

| Module             | Imports other modules                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| benefits           | audit, clients, documents, organizations, platform, scheduling, services, visit-execution                                                                                         |
| billing            | audit, benefits, clients, documents, organizations, platform, scheduling, service-evidence, services, visit-execution                                                             |
| care-documentation | audit, clients, employees, platform, scheduling, visit-execution                                                                                                                  |
| clients            | audit, organizations, platform                                                                                                                                                    |
| communications     | audit, billing, clients, documents, identity, operations, organizations, platform, scheduling, service-agreements                                                                 |
| documents          | audit, clients, organizations, platform                                                                                                                                           |
| employees          | audit, identity, organizations, platform                                                                                                                                          |
| identity           | audit, organizations, platform                                                                                                                                                    |
| onboarding         | audit, benefits, clients, communications, documents, employees, identity, operations, organizations, platform, scheduling, service-agreements, services                           |
| operations         | audit, benefits, billing, care-documentation, clients, documents, employees, identity, organizations, platform, scheduling, service-agreements, service-evidence, visit-execution |
| organizations      | audit, platform                                                                                                                                                                   |
| scheduling         | audit, clients, employees, identity, organizations, platform, service-agreements, services                                                                                        |
| service-agreements | audit, clients, organizations, platform, services                                                                                                                                 |
| service-evidence   | audit, care-documentation, clients, employees, platform, scheduling, visit-execution                                                                                              |
| services           | audit, organizations, platform                                                                                                                                                    |
| visit-execution    | audit, clients, employees, platform, scheduling, service-agreements, services                                                                                                     |

Audit and Platform have no outgoing module import edges. No direct module import cycles were found. API Nest composition has separate dependency wiring; the checker does not interpret Nest metadata or injected callback call graphs.

## Confirmed import debt

146 persistence imports, 6 private imports, 7 direction violations. Legitimate exceptions are excluded. These are import sites/symbols, not counts of database queries. The baseline retains every exact path, line, symbol, owning schema and reason.

| Source file                                                                       | Findings                 |
| --------------------------------------------------------------------------------- | ------------------------ |
| `apps/api/src/ops/bootstrap.ts`                                                   | persistence: 4           |
| `apps/api/src/presentation/http/health.controller.ts`                             | persistence: 1           |
| `apps/web/src/app/(office)/planning/page.tsx`                                     | direction: 1             |
| `apps/web/src/components/agreement-cost-summary.tsx`                              | direction: 4; private: 4 |
| `apps/web/src/components/agreement-service-fields.tsx`                            | direction: 2; private: 2 |
| `modules/benefits/src/application/benefits.application.ts`                        | persistence: 10          |
| `modules/billing/src/application/billing.application.ts`                          | persistence: 8           |
| `modules/billing/src/claims/claims.application.ts`                                | persistence: 9           |
| `modules/care-documentation/src/infrastructure/care-documentation.repository.ts`  | persistence: 7           |
| `modules/clients/src/infrastructure/persistence/client-master-data.repository.ts` | persistence: 1           |
| `modules/clients/src/infrastructure/persistence/client.repository.ts`             | persistence: 2           |
| `modules/communications/src/application/communications.application.ts`            | persistence: 10          |
| `modules/documents/src/application/documents.application.ts`                      | persistence: 1           |
| `modules/employees/src/infrastructure/persistence/employee-visibility.ts`         | persistence: 2           |
| `modules/employees/src/infrastructure/persistence/employee.repository.ts`         | persistence: 5           |
| `modules/identity/src/application/authorization-principal.ts`                     | persistence: 1           |
| `modules/identity/src/application/identity.service.ts`                            | persistence: 1           |
| `modules/identity/src/application/tenant-access.service.ts`                       | persistence: 3           |
| `modules/onboarding/src/application/onboarding.application.ts`                    | persistence: 19          |
| `modules/operations/src/application/deadline-scheduler.application.ts`            | persistence: 9           |
| `modules/operations/src/application/operations-guards.ts`                         | persistence: 2           |
| `modules/operations/src/application/operations.application.ts`                    | persistence: 14          |
| `modules/operations/src/application/recurrence.application.ts`                    | persistence: 3           |
| `modules/scheduling/src/application/calendar-subscription.application.ts`         | persistence: 1           |
| `modules/scheduling/src/infrastructure/calendar-subscription.repository.ts`       | persistence: 2           |
| `modules/scheduling/src/infrastructure/scheduling.repository.ts`                  | persistence: 5           |
| `modules/service-evidence/src/infrastructure/service-evidence.repository.ts`      | persistence: 12          |
| `modules/services/src/application/service-price.application.ts`                   | persistence: 1           |
| `modules/services/src/infrastructure/service.repository.ts`                       | persistence: 1           |
| `modules/visit-execution/src/infrastructure/visit-execution.guards.ts`            | persistence: 2           |
| `modules/visit-execution/src/infrastructure/visit-execution.repository.ts`        | persistence: 10          |

## Migration order

1. Operations worklist deadline reads, scope/name/timezone enrichment and reconciliation (Goal 02 handoff). Operations has 28 remaining persistence import sites across its application services.
2. Onboarding readiness and source validation (19 persistence imports); Communications source/task/contact reads (10). Preserve independent source permissions and prospect isolation.
3. Billing (17), Service Evidence (12), Visit Execution (12), Benefits (10), Scheduling (8), Care Documentation (7). Replace source facts with bounded queries/guards while retaining transaction locks and authorization; do not mechanically move SQL into shared infrastructure.
4. Employee, Identity, Client and catalog/provider checks. Use focused owner-facing guards/read contracts.
5. Web imports of Scheduling availability and Services pricing logic/types: design a safe public pure contract or move the required calculation into a suitable shared contract package. Avoid importing backend root barrels into browser bundles.
6. API transport access to tables: replace remaining controller reads with owner APIs. Better Auth schema composition is an explicit legitimate server exception.

Raw SQL is outside the import checker. Confirmed additional debt: `modules/operations/src/application/operations.application.ts:2886` reads Communications and Clients in source validation. Potential improvements (not confirmed violations): narrower public barrels, dedicated DTOs instead of table-inferred return types, and future event consumers replacing the worker catch-all.

## Goal 02 deadline reads

The four `listWorkItems` expiry streams now call Service Agreements, Employees, Benefits and Billing owner query classes. Client display/provider facts come from the bounded authorized Clients projection; organization timezone enrichment comes from Organizations. Five Operations persistence imports were removed without adding violations or regenerating the baseline. The application retains 14 foreign persistence imports for task validation, enrichment and reconciliation, and raw SQL debt remains. See [the Goal 02 to Goal 03 handoff](goal-02-to-goal-03.md) for scope, security, pagination, performance tradeoffs and the Scheduling extraction plan. Goal 03 does not inherit the deferred Operations cleanup automatically.
