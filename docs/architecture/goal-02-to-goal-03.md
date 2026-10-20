# Goal 02 → Goal 03 handoff

## A. Goal 02 Status

**Complete.** The four deadline reads in `OperationsApplicationService.listWorkItems` execute authorized owner APIs. Organization timezone enrichment uses a bounded Organizations API. PostgreSQL/API regression coverage, architecture enforcement, root checks and build pass. Office Operations browser E2E was not run: the configured local test OIDC discovery service was unavailable. No Goal 03 implementation is included.

Implemented scope matches the Goal 01 handoff: agreement, qualification, entitlement and payer-arrangement expiry, their client context, timezone enrichment and composition. Task validation, worker SQL, recurrence, assignee guards and reconciliation SQL remain deferred. There is no remaining implementation work within this slice; browser verification and production-scale performance characterization remain limitations described below.

## B. Implementation Summary

### Files created

- `modules/service-agreements/src/application/operations-expiry.ts`
- `modules/employees/src/application/operations-expiry.ts`
- `modules/benefits/src/application/operations-expiry.ts`
- `modules/billing/src/application/operations-expiry.ts`
- This handoff.

### Files modified

- `modules/operations/src/application/operations.application.ts`: source capability composition, owner page calls and authorized timezone delegation. Worklist projection and reconciliation remain here.
- `modules/clients/src/application/client.service.ts`: bounded owner-facing deadline context/name projection.
- `modules/organizations/src/application/organization.service.ts`: authorized timezone batch lookup.
- `modules/{service-agreements,employees,benefits,billing}/src/index.ts`: query classes and explicit fact/query contracts.
- `apps/api/src/modules/{service-agreements,employees,benefits,billing,operations}.module.ts`: explicit provider factories, module imports and exports.
- `apps/api/src/pilot-seed.ts`: compose the same required capabilities for the existing direct application factory caller.
- `apps/api/integration/operations.integration.test.ts`: owner authorization, scope intersection, paging, failure, timezone and bounded query regression assertions.
- `scripts/architecture/baseline.json`: remove five resolved import entries only.
- `docs/architecture/{overview,module-boundaries,dependency-map}.md`: describe the implemented boundaries and remaining debt.

No files, migrations, endpoints or business operations were removed.

### Application contracts

| Owner              | Capability                                             | Minimal facts and authorization                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service Agreements | `AgreementExpiryQueries.operationsExpiryPage`          | Agreement ID, provider/client context, authorized display name and expiry; `service_agreement.read`; active/suspended agreements                                                                                   |
| Employees          | `QualificationExpiryQueries.operationsExpiryPage`      | Qualification/employee IDs, employee display name, qualification name, primary active facility context and expiry; `employee.read` (including the established manage implication); active qualifications/employees |
| Benefits           | `BenefitEntitlementExpiryQueries.operationsExpiryPage` | Entitlement ID, client/provider context, display name and expiry; `benefits.review`; confirmed/provisional entitlement plus active matching funding source                                                         |
| Billing            | `PayerArrangementExpiryQueries.operationsExpiryPage`   | Arrangement ID, arrangement organization, client primary facility/name and expiry; `billing.read`; authorized mandate effective on the supplied observation date                                                   |
| Clients            | `ClientApplicationService.operationsDeadlineContexts`  | At most 100 source-owner references, returning only authorized names and provider context inside the caller's tenant transaction                                                                                   |
| Organizations      | `OrganizationApplicationService.operationsTimezones`   | Deduplicated IDs, at most 1,000 organizations, returning only ID/timezone pairs visible through `operations.read`; facility grants are checked against Organizations-owned facilities                              |

Each source has a domain-specific typed query/fact interface and returns `{ items, complete }`. Source reads order by `(validUntil, id)`, require page size 100 and validate nonnegative integer offsets. `complete` means the raw source scan reached its final page. An empty authorized page can have `complete: false`; Operations must continue with the next offset. Failures propagate to the existing per-source isolation boundary and set worklist `truncated`.

Clients accepts trusted source references, not arbitrary HTTP requests. Agreements supply their own organization/facility; Billing supplies its own organization and uses the client's primary facility; Benefits uses the client's provider context. Clients authorizes the selected source permission on that context, and each owner rechecks its resulting fact. The existing deadline projection authorizes names with the relevant source permission; this change does not add a new independent `client.read` prerequisite. Existing Clients authorization on other workflows and exception history is unchanged.

Domain query providers receive the existing `UNIT_OF_WORK` and, where needed, `CLIENT_APPLICATION`. Their Nest modules export the query class providers; Operations receives them explicitly through its factory and exposes narrow `Pick` capabilities in `OperationsSourceServices`. Existing Benefits/Billing application services and their financial behavior are unchanged. There is no service locator or new module import cycle.

The four Operations queries and their foreign joins are eliminated. Source queries access only owner tables. Client persistence remains entirely inside the Clients projection. Five Operations persistence import entries disappeared: `benefitFundingSources`, `payerArrangements`, `employeeQualifications`, `qualificationDefinitions`, `employeeFacilityAssignments`. Remaining symbols are still used by deferred paths and stay baselined. Total violations fell from 164 to 159 (146 persistence, six private, seven direction); zero new violations. The baseline was not regenerated.

REST/OpenAPI shapes and generated API client output have no diff. Operations retains item/issue identity, categories, policy/severity, local end-of-day conversion, filtering, final ordering/pagination, reconciliation, history, audit/outbox and worker behavior. The source date window is the intersection of the existing policy window and explicit query dates. Expiration predicates were copied from the actual previous SQL; no additional validity/status rules were inferred from other APIs.

## C. Architectural Decisions

1. Dedicated owner query classes keep these narrow reads separate from large mutation services, particularly Benefits and Billing. No generic repository or shared persistence abstraction was introduced.
2. Explicit fact types prevent table-shaped contracts from becoming new persistence interfaces. Owners authorize source facts; Operations applies its own permission intersection and projects issues.
3. Client display/provider context is resolved in one bounded lookup per nonempty source page, inside the source transaction. This avoids foreign joins and per-result database calls. Tenant-qualified source predicates and Clients predicates preserve RLS defense in depth.
4. Benefits and Billing apply client-dependent provider scopes after reading a raw owner page. Their page completeness must therefore be independent of the number of visible facts. This is a deliberate performance tradeoff, not permission widening; no unauthorized facts leave the owner API.
5. Timezones remain organization timezones, with the existing `Europe/Berlin` fallback. A facility-scoped Operations reader can obtain its owning organization's timezone without `organization.read` or unrelated organization data. The 1,000-ID bound supports the existing dashboard's maximum retained 1,000 items; ordinary streamed worklist batches use at most 100.
6. Cross-domain reconciliation was deliberately retained. Removing its SQL requires owner completeness/transaction contracts and separate regression coverage, not merely deleting imports.

## D. Verification Results

Executed commands, with actual outcomes:

| Command                                                                                                                         | Result                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `bun run architecture:check`                                                                                                    | Pass: 159 existing, zero new violations; no obsolete baseline entries           |
| `bun run architecture:test`                                                                                                     | Pass: 15 tests, 33 assertions                                                   |
| `bun run lint`                                                                                                                  | Pass                                                                            |
| `bun run typecheck`                                                                                                             | Pass: all 33 workspace tasks                                                    |
| `bun run test`                                                                                                                  | Pass: all 51 Turbo tasks                                                        |
| `bun run test:integration`                                                                                                      | Pass: all 32 Turbo tasks; PostgreSQL/API, worker and database tenant tests pass |
| `bun run build`                                                                                                                 | Pass: OpenAPI plus all 32 build tasks; no OpenAPI/client output diff            |
| `bun test --timeout=300000 apps/api/integration/operations.integration.test.ts`                                                 | Pass: focused Operations PostgreSQL/API scenario, including the new assertions  |
| `bunx oxlint --fix`                                                                                                             | Pass after removing unused imports                                              |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                            |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                            |
| `graphify update .`                                                                                                             | AST-only graph refresh; no API cost                                             |

The full PostgreSQL run covers seven API scenarios, three worker restart scenarios and five database/RLS scenarios. The focused final Operations run has 262 assertions. Existing assertions cover all four deadline projections, qualification totals across 102 rows, history, snooze/acknowledgement, source status changes, tenant/resource filtering and worker idempotency. New assertions directly exercise all four Nest-composed contracts with missing permissions, facility grants, foreign organization/facility filters, a different tenant and invalid page size. They also verify the independent Operations/source scope intersection for all four sources, authorized facility timezone lookup and denied/cross-tenant timezone lookup.

A Benefits fixture puts 100 unauthorized raw rows before the authorized entitlement. Its first page is empty and incomplete; its second page supplies the authorized fact, and the actual worklist reports total one without truncation. A failure injected into the second qualification page reports truncation and leaves all 102 still-current exception occurrences open. A provider timezone changed to `America/New_York` still produces the correct local date at 23:59:59; the timezone is restored before remaining history tests.

Office E2E: **not executed**. `.env.test` exists, but a bounded probe of its localhost OIDC discovery endpoint failed and no persistent E2E service stack was running. The optional UI gate remains unverified; this is not a browser-test pass. Unit coverage of the unchanged zoned-time conversion includes nonexistent spring-forward and ambiguous fall-back instants in `modules/scheduling/src/domain/schedule-generation.test.ts`.

Initial development checks found unused imports and a missing pilot-seed composition update; both were fixed. Import consolidation also temporarily displaced a pilot-seed lint directive; its environment-loader ordering and directive were restored before the final zero-warning check. New fixture attempts initially violated required client facility context and entitlement non-overlap constraints; fixtures were corrected to use a real facility and 100 distinct nonoverlapping dates. These were failing intermediate runs, not final failures. PostgreSQL emits an existing concurrent-client-query deprecation warning in the broad scenario. The intentional source fault logs only domain/error name.

### Performance

The unchanged integration scenario took 13.05 seconds before and 10.11 seconds after the initial refactor, both with 215 assertions. These single local runs include infrastructure and are not a controlled speed benchmark. The expanded final focused run took 9.64 seconds with 262 assertions. The final full integration run completed in 63.39 seconds.

Before, each deadline source page performed one source SELECT with foreign joins. Now qualification pages still perform one SELECT; nonempty agreement/benefit/payer pages perform two SELECTs in one transaction: owner facts and one Clients batch. The measured Benefits 100-row page and one-row tail each performed exactly two SELECT constructions, taking 2.23 ms and 0.92 ms locally in the final focused run. The count excludes transaction control/tenant setup, unchanged timezone enrichment and history operations. There is no per-result lookup. Timezone enrichment remains one bounded SELECT per lookup.

Scope filtering after pagination can require Benefits and Billing to scan additional tenant-local expiry pages for narrowly scoped users. The regression fixture verifies correct behavior for an entirely invisible page; it does not establish large-tenant latency. This tradeoff removes foreign persistence joins without migrations or unbounded client-ID materialization. Production-scale scoped workloads remain unbenchmarked. Consider an authorized owner projection/index strategy in a separately measured change if this cost becomes material. Do not silently cap scanning or treat an empty authorized page as complete.

## E. Remaining Technical Debt

These are deferred pre-existing paths, not new violations and not automatically part of Goal 03:

- `modules/operations/src/application/operations.application.ts`: `validateSource` (~2714), `validateAssignee` (~2959), `employeeForUser` (~2969), `clientResources` (~2986), `staleOccurrenceStillCurrent` (~3203), `completeSourceEntityScope` (~4220). Task/provider/source validation, Benefits carryover context and Scheduling/Evidence completeness still use foreign persistence. Stale agreement/qualification validation also contains direct SQL text; import counts do not capture that SQL.
- `modules/operations/src/application/deadline-scheduler.application.ts`: nine foreign persistence imports and restricted worker reads.
- `modules/operations/src/application/operations-guards.ts`: two foreign persistence imports for assignee validation.
- `modules/operations/src/application/recurrence.application.ts`: three foreign persistence imports.
- `modules/scheduling/src/infrastructure/scheduling.repository.ts`: five foreign persistence imports; Calendar Subscriptions adds three more across its application/repository. Goal 03 should preserve this debt baseline unless its focused extraction genuinely resolves an import.
- Benefits, Billing and other module debt remains listed in `dependency-map.md` and the exact baseline. This slice does not claim complete Operations decoupling.

Goal 02 introduces additional bounded client batch SELECTs and the scoped-scan tradeoff above. It introduces no baseline violations, new persistence dependencies, migrations or public contract changes.

## F. Goal 03 Preparation

The inspected `modules/scheduling/src/application/scheduling.application.ts` remains roughly 4,500 lines. Its facade groups visit search/get/create/update/status changes, assignments, agreement generation, substitutions, tours, routing locations, preferences, worklists, availability and unavailability. Preserve public method signatures and factory defaults.

Tour-related methods are contiguous:

| Methods                                 | Current location and role                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createTour`, `listTours`, `getTour`    | ~1229–1441; create, bounded employee/date listing and authorized detail                                |
| `updateTourStops`                       | ~1442; full stop order/notes, expected version, returns detail                                         |
| `estimateTourRoute`, `suggestTourOrder` | ~1540–1715; external provider orchestration, feasibility and preview                                   |
| `publishTour`                           | ~1716; revalidation, immutable publication and transactional event                                     |
| `getMyTodayTour`, `getMyPublishedTours` | ~1866–2070; linked employee, publication views and current authorized visits                           |
| `invalidateToursForVisit`               | ~3466; visit mutation hook clearing estimates/removing inapplicable stops and returning tours to draft |
| `recordTourChange`                      | ~3581; create/reorder event and audit construction                                                     |

Callers: `SchedulingToursController` and caregiver tour controllers in `apps/api/src/presentation/http/scheduling.controller.ts:633–784`, plus `apps/api/src/pilot-seed.ts` tour setup. Browser pages/actions use generated HTTP client contracts. Operations consumes only `getWorklist`/`getWorklistForVisit`; Documents uses the visit facade. They should not receive a new tour dependency.

Persistence: `SchedulingRepository` owns `insertTour`, `getTour` (optional row lock), `getTourForEmployeeDate`, `listTours`, `tourStops`, stop replacement/estimates, conditional version updates, publication inserts/latest/batch/history and tour invalidation lookups. Tour/stop/publication tables and constraints live in Scheduling; visit and assignment reads share the repository. `modules/scheduling/src/domain/tour.ts` already owns date membership, chronological stop comparison, feasibility and tour errors; `route-provider.ts` owns route-provider contracts/OSRM behavior.

Invariants: unique employee/local-date tour; valid date/timezone; bounded unique stops; same organization/date; active employee assignments; authorized visit/client/provider context; planning immutability once execution starts; availability/overlap checks; explicit optimistic versions; dispatcher notes retained with visits. Reordering resets draft state. Publishing rechecks visits, assignments, execution, availability, proposed substitutions and blocking travel conflicts, then appends an immutable publication with a separate publication version and change summary.

Transaction boundaries: create/reorder/publish mutate domain state and audit/outbox in one tenant transaction. Row/advisory locks and expected-version checks must remain on the same transaction. `estimateTourRoute` intentionally reads in one transaction, calls the provider outside it, then locks/rechecks version and persists estimates in a second transaction. Suggestions are previews: they call suggest/estimate without writing visit times or publications. Do not hold database locks over routing I/O.

Composition: `apps/api/src/modules/scheduling.module.ts` provides `SCHEDULING_APPLICATION` using UnitOfWork, Clients, Organizations, Employees, Services, Service Agreements, Audit, Outbox, execution guards and configured OSRM/unavailable provider. The application constructor also receives `SchedulingRepository` and the generation horizon. Avoid a dependency from a tour component back to the facade; extract narrow transaction-aware planning guards if needed.

Cross-domain authorization currently runs through employee/client owner APIs, organization/service/agreement capabilities and execution guards; repository foreign imports remain existing debt. Routing requests must contain normalized coordinates only, without names, addresses, care facts or audit context.

Coverage: `modules/scheduling/src/domain/{tour,route-provider,schedule-generation,availability,visit}.test.ts`; PostgreSQL tour creation, unavailable routing, publication, reordered/stale-version behavior and publication history in `apps/api/integration/clients.integration.test.ts:1866–1930`; calendar feed integration in `calendar-subscriptions.integration.test.ts`. There is no dedicated Scheduling integration file today. Browser Office/caregiver suites cover planning workflows, but there is no tour-named E2E spec. Add focused integration assertions rather than assuming domain unit tests cover transaction orchestration.

Performance risks already present: per-stop client authorization in `getTour`, per-tour publication/stop lookups in `listTours`, sequential per-visit command checks and repeated detail reads after writes. Routing latency and stale-version races span two transactions. Preserve bounds and query behavior during extraction; do not combine broad optimization with decomposition.

Timezone behavior uses `sameTourDate`, per-tour and per-visit IANA zones, calendar-date arithmetic and `localDateTimeToInstant`. Caregiver today reads a UTC-adjacent date range, selects by the tour's local date and builds local-midnight bounds using earlier/later ambiguity handling. Preserve 23/25-hour days and spring/fall DST semantics; never replace local-day boundaries with fixed 24-hour arithmetic.

**Recommended first extraction:** Office tour orchestration, the seven methods `createTour`, `listTours`, `getTour`, `updateTourStops`, `estimateTourRoute`, `suggestTourOrder`, `publishTour`. Keep caregiver publication views, invalidation call sites and other Scheduling responsibilities in the facade initially. Extract shared planning guards only as required to avoid a facade/component cycle. This delivers a substantial cohesive reduction without rewriting the entire service.

## G. Goal 03 Execution Plan

1. **Exact scope:** introduce an internal `SchedulingToursApplicationService` for the seven Office tour methods above and delegate existing facade methods. Keep HTTP/OpenAPI and callers stable. Leave generation, visit CRUD/status, availability, preferences, substitutions, caregiver projections and existing foreign-table cleanup outside scope.
2. **Likely files:** create `modules/scheduling/src/application/tours.application.ts`; modify `scheduling.application.ts`; optionally add `planning-guards.ts` and `application-context.ts` for shared transaction-aware guards/event writing; modify `src/index.ts` only for public type compatibility; adjust `apps/api/src/modules/scheduling.module.ts` only if composition requires it; extend `apps/api/integration/clients.integration.test.ts` or add focused `scheduling-tours.integration.test.ts`; add relevant application tests and architecture/handoff documentation.
3. **Boundaries:** Tours receives UoW, owner repository methods, route provider, event writer and a narrow planning guard capability for employee resources, readable/mutable visits, execution and availability. Shared guards take the existing transaction; they must not start nested transactions. Keep pure validation in `domain/tour.ts`. Keep caregiver projections and transactional invalidation in the facade until separately extracted.
4. **Steps:** inspect live state/docs/graph; characterize current tour outputs/errors and callers; define typed internal dependencies; extract the smallest shared guards without behavior changes; move seven methods and delegate; preserve facade factory defaults and pilot/test composition; remove only genuinely unused implementation helpers; run focused security/consistency tests and required root gates; update Graphify and document results.
5. **Authorization/consistency:** preserve `schedule.read`/`schedule.update`, client/provider restrictions, linked employees, RLS, execution immutability, resource locks, expected versions, atomic data/audit/outbox and immutable publication history. Preserve second-phase route version checks. Test denied and cross-tenant requests through the composed application.
6. **Compatibility:** same methods, inputs, outputs, error codes/statuses, route statuses, snapshot shapes, event payloads and ordering; same unknown/unavailable routing fallback; no endpoint, schema, migration or frontend changes. Keep public `TourSummary`/input types re-exportable without breaking callers.
7. **Focused tests:** create/reorder/detail/list and note retention; empty/duplicate/over-100 stops; provider/assignment/date/execution/availability/substitution violations; unauthorized and foreign-tenant access; stale reorder/publish/route results and rollback without stray audit/outbox; append-only publication versions and change summaries; provider failure/unknown route/conflicting travel; preview without writes; date boundaries and both DST transitions; invalidation when existing visit/assignment mutations run; bounded query counts and no routing I/O under locks.
8. **Risks:** circular guard delegation, accidental nested transactions, changed error precedence, reauthorization differences, lost lock/version checks, transaction time expansion, copied mutable publication data, leaking care details to routing/logging, type export breakage and unrelated debt expansion. Report any pre-existing defect separately unless its fix is essential to preserve this extraction.

## H. Copy-Ready Goal 03 Prompt

> Implement Goal 03 in `woobble/care`: decompose the Scheduling application service through a focused Office tour orchestration extraction. Read `docs/architecture/overview.md`, `module-boundaries.md`, `dependency-map.md`, `goal-02-to-goal-03.md` and `docs/domains/scheduling.md` first. Inspect current Git state and use Graphify as instructed. Do not use multi-agent mode or production credentials.
>
> Extract exactly `createTour`, `listTours`, `getTour`, `updateTourStops`, `estimateTourRoute`, `suggestTourOrder` and `publishTour` from `modules/scheduling/src/application/scheduling.application.ts` into an internal `SchedulingToursApplicationService`. Preserve the existing facade, factory defaults, Nest wiring, pilot seed callers, public types and HTTP/OpenAPI contracts. Introduce narrow transaction-aware planning guards/event-writing capabilities only where needed; avoid component-to-facade cycles, service locators and nested transactions. Keep pure rules in their existing domain modules. Leave caregiver tour projections, visit/generation/availability/preferences/substitution workflows, worker SQL and unrelated cross-domain persistence cleanup outside this goal. Preserve existing invalidation behavior and test it through the facade.
>
> Retain tenant RLS, schedule/client/provider authorization, employee assignments, same-organization/local-date membership, executed-visit locks, availability/substitution/route-feasibility checks, deterministic ordering, dispatcher notes, optimistic versions and atomic domain/audit/outbox writes. Preserve immutable publication snapshots, publication versions and change summaries. Keep routing I/O outside database transactions with the existing version recheck before saving estimates; suggestions remain previews. Routing requests/logs must not contain care details. Preserve IANA timezone, local-midnight and DST semantics.
>
> Add focused regression tests for the composed application and PostgreSQL transaction behavior, including denied/cross-tenant scope, stale commands and route results, rollback, publication history, invalidation, routing failure, DST and bounded reads. Inspect `apps/api/integration/clients.integration.test.ts` and existing Scheduling domain tests before expanding coverage. Run architecture checks/tests, lint, typecheck, unit tests, PostgreSQL integration and build; run relevant Office/caregiver E2E when the isolated environment is available. Report actual command results, query/latency implications, unverified behavior and remaining debt. Do not regenerate the architecture baseline; remove only resolved entries. Run required formatting/lint and `graphify update .`.
>
> Create the mandatory `docs/architecture/goal-03-to-goal-04.md` handoff before completion. Include Goal 03 status and remaining work; exact files/interfaces/composition changes; architectural decisions and public compatibility; every verification result and performance limitation; deferred debt with source locations; an evidence-based focused Goal 04 recommendation, scope, likely files, implementation steps, authorization/transaction/compatibility constraints, tests and risks; and a self-contained copy-ready Goal 04 Codex prompt requiring a mandatory Goal 05 handoff. Inspect the actual post-Goal-03 repository before recommending Goal 04. Do not implement Goal 04 or rewrite all of Scheduling. Finish only after the implemented extraction is verified and the Goal 04 handoff is usable.
