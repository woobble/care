# Goal 03 → Goal 04 handoff

## A. Implementation summary

Goal 03 extracts the seven Office tour use cases into an internal service. SchedulingApplicationService remains the only exported application facade for those operations. Goal 04 has not been implemented.

Created under modules/scheduling/src/application/:

- tours.application.ts: complete createTour, listTours, getTour, updateTourStops, estimateTourRoute, suggestTourOrder and publishTour orchestration; tour request validation, publication change summaries and tour event construction.
- planning-guards.ts: existing employee resource resolution, mutable-visit authorization/provider checks, execution guard, availability checks and sorted advisory resource locks, shared by both services.
- scheduling-events.ts: existing ordered audit append and outbox enqueue on the supplied transaction.
- planning-time.ts: existing calendar-date validation/range arithmetic and timezone-aware date helpers shared by guards, facade and tours.
- planning.errors.ts: eleven existing errors needed by shared guards or Tours; re-exported from the facade to preserve public identity/imports.
- tour.contracts.ts: existing CreateTourInput, UpdateTourStopsInput and TourSummary; re-exported from the facade.
- publication-snapshot.ts: existing published-stop type guard shared with caregiver reads.
- tours.application.test.ts: focused orchestration/guard regressions with real guards, permissions and writer, using in-memory repository doubles. These doubles do not prove PostgreSQL rollback or RLS.
- This handoff at docs/architecture/goal-03-to-goal-04.md.

Modified:

- modules/scheduling/src/application/scheduling.application.ts: seven delegates, internal composition, shared collaborator calls and compatible type/error re-exports.
- apps/api/integration/clients.integration.test.ts: tour authorization, invalid-stop rejection, stale publication, forced outbox failure/rollback, immutable snapshots, audit/outbox linkage and cancellation invalidation.
- docs/domains/scheduling.md: internal boundaries.
- Graphify output refreshed through graphify update . (AST-only, local ignored artifacts).

No files removed. No changes to public barrel exports, Nest tokens/providers, factory/constructor call signatures, controllers, DTOs, migrations, repository SQL, worker handlers, calendar subscriptions, generated contracts or frontend code. Internal composition shares the same repository, provider, guards and writer. Factory defaults remain compatible.

The facade retains visit CRUD/status, generation, assignment, substitution, availability/absence, preferences, client routing locations, worklist and caregiver projections. Visit-driven tour invalidation stays at its existing mutation call sites.

Approximate production responsibility distribution: original facade 4,542 lines / 155,529 bytes; after extraction 3,569 lines / 122,961 bytes. Tours owns 783 lines / 27,430 bytes, shared guards 235 lines / 8 KB, event writer 48 lines / 1.5 KB, shared contracts/errors/date/snapshot helpers 178 lines / 5.4 KB. Facade reduction is approximately 21%. Remaining facade code belongs to workflows explicitly excluded from Goal 03; file size does not measure resolved persistence debt.

## B. Architectural decisions

1. Tours owns full transactions and use cases. Constructor capabilities use typed Pick contracts for repository operations, client reads, five planning guards and event writing. There is no facade injection, callback into the facade, service locator, new public API or generic framework.
2. Guards take an existing DatabaseTransaction. They preserve validation precedence, organization/facility/team resource facts, client/provider checks, execution checks, availability and sorted/deduplicated resource locks. The facade uses the same implementations; rules were not duplicated.
3. The writer appends audit before outbox on the same transaction. Tour event construction and publication metadata belong to Tours; unrelated event construction stays with its workflow. Protected visit/dispatcher/absence notes remain excluded from event payloads.
4. Routing preserves read transaction → provider I/O → locked version recheck/persistence transaction. Suggestions use read permission and remain previews. Only normalized coordinates and visit IDs are projected to routing; the provider and rounding are unchanged.
5. Publication preserves row locking, optimistic versions, sequential visit checks, assignment/execution/availability/substitution validation, blocking travel conflicts, immutable numbered snapshots, change summaries and atomic audit/outbox. No additional transactions or locks were introduced.
6. Leaf types/errors avoid runtime import cycles. Only errors needed by Tours/shared guards moved; unrelated errors stay in the facade. Public exports still resolve through the existing facade.
7. A structural comparison of all 57 original non-constructor method ASTs matched after normalizing only shared collaborator access (this.planning and this.events). Transaction bodies and statement order are preserved. This supports equivalence but does not replace runtime testing.

Baseline unchanged: 159 existing violations, zero new, zero obsolete entries. Existing foreign persistence remains repository/calendar debt outside this extraction.

## C. Verification

Exact commands executed from the root:

| Command                                                                                                                       | Result                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| bun run architecture:check                                                                                                    | Pass: 159 existing, zero new/obsolete entries                                      |
| bun run architecture:test                                                                                                     | Pass: 15 tests / 33 assertions                                                     |
| bun run lint                                                                                                                  | Pass: 33 workspace tasks                                                           |
| bun run typecheck                                                                                                             | Pass: 33 workspace tasks                                                           |
| bun run test                                                                                                                  | Pass: 51 Turbo tasks                                                               |
| bun run test:integration                                                                                                      | Pass                                                                               |
| bun run build                                                                                                                 | Pass: OpenAPI plus 32 build tasks; no OpenAPI/client diff                          |
| bun run format:check                                                                                                          | Pass                                                                               |
| bun run --filter @care/scheduling typecheck                                                                                   | Pass                                                                               |
| bun test modules/scheduling/src                                                                                               | Pass: 33 tests / 224 assertions, including 18 new orchestration tests              |
| bun test --timeout=300000 apps/api/integration/clients.integration.test.ts                                                    | Pass: PostgreSQL/API scenario, 862 assertions                                      |
| bunx oxlint --fix                                                                                                             | Pass after explicitly removing unused imports                                      |
| bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**' | Pass                                                                               |
| bunx oxlint --deny-warnings --format=agent                                                                                    | Pass                                                                               |
| graphify update .                                                                                                             | Pass: AST-only refresh, 12,872 nodes / 38,914 edges / 696 communities; no API cost |

The full PostgreSQL integration gate passed all 32 Turbo tasks: API 7 tests / 1,455 assertions; worker 3 tests / 13 assertions; database/RLS 5 tests / 80 assertions. The final focused Scheduling run passed 33 tests / 224 assertions. Turbo reused unchanged workspace results where applicable.

The initial extended integration run expected 422 for duplicate stops; the existing HTTP mapping returns 400. The assertion was corrected and the rerun passed. Behavior was not changed to satisfy that assertion.

Focused coverage:

- Assigned-visit creation/deterministic ordering; duplicate, cancelled, unassigned and wrong-date rejection; provider-context rejection.
- Tenant separation and organization/facility/team employee scope; read/write differences. Existing team-only grants can list employee tours but cannot authorize detail stops without an additional matching visit resource grant; preserved and tested.
- Reorder/trimmed notes; stale reorder/publication; locked second route read and stale provider result rejection without estimate writes.
- Routing outside transactions; coordinate-only stop projection; minute ceiling; unavailable routing; optimized preview ordering and feasibility conflicts without appointment/publication writes.
- Publication conflicts, execution/absence rechecks, numbered immutable snapshots and reschedule change summaries.
- Spring/autumn DST: 23/25-hour local availability bounds and tour dates near UTC midnight. Existing domain tests retain nonexistent/repeated wall-time coverage.
- PostgreSQL failure after domain/history/audit writes: publication/version/audit roll back together with no publication event. A temporary trigger injects failure in the disposable testcontainer and is removed in finally; no migration/production data changes.
- API permission denial/cross-tenant requests, stale publication, immutable snapshot comparison, audit/outbox IDs and draft/empty-stop invalidation on visit cancellation with prior publications retained.

Browser E2E is **unverified**: a bounded probe of configured .env.test OIDC discovery returned no response. No production credentials or identity configuration were changed. API integration uses its own isolated test OIDC server.

Performance: no repository query, transaction, per-stop loop, lock ordering or route provider implementation changed. Per-stop client checks, per-tour stop/publication reads and post-mutation detail reads remain. Method AST comparison and unchanged repository code support equivalent query structure; production latency/load, OSRM deployment availability and contention were not benchmarked. No performance improvement is claimed.

## D. Confirmed remaining debt

- Scheduling facade remains large across intentionally retained workflows. Shared guards still use the existing repository and owner APIs; further decomposition is separate work.
- listTours retains bounded per-tour stop/publication reads; getTour retains per-stop client checks.
- Team-only detail authorization is more restrictive than employee-level listing because detail visit resources lack team IDs. This change characterizes it without widening permissions.
- Scheduling foreign-table and calendar persistence debt remains in dependency-map.md. None moved to Tours.
- Operations still has 14 foreign persistence imports in operations.application.ts, three in recurrence, nine in deadline scheduling and two in the assignee guard. Raw Communications/Clients SQL in task source validation is additional debt outside the import checker.
- Browser E2E and production-scale performance remain unverified. These do not authorize unrelated cleanup in Goal 04.

## E. Goal 04 preparation from current source

Inspected modules/operations/src/application/{operations.application,recurrence.application,deadline-scheduler.application,operations-guards}.ts, both domain modules/tests, schema.ts, apps/api/src/modules/operations.module.ts, Operations API integration and worker integration coverage. Sizes: Operations facade 4,349 lines; recurrence 1,216; deadline scheduler 1,117. Operations has no dedicated repository today: these services issue Drizzle queries directly.

1. **Commands:** createTask, patchTask/updateTask, startTask, completeTask, reopenTask, cancelTask/transitionTask, addComment. Creation resolves source/client/provider context before its write transaction; scope validation opens separate reads. createDeadlineTask resolves a current worklist deadline then calls createTask with an idempotency key. Keep that bridge in aggregation.
2. **Queries:** listTasks, getTask, taskActivityList, taskSummary, taskView, readTask, taskScopeConditions. SQL count/filter/pagination precede display redaction; page size ≤100. Activity is ordered by timestamp/ID, limited to 200 and enriches actor names via Identity memberships/users. Dashboard calls taskSummary; listWorkQueue merges tasks and exceptions and stays aggregation-owned.
3. **Lifecycle/authorization:** operations.tasks.create for creation, operations.tasks.manage for changes/comments, operations.tasks.assign for assignment, operations.read for reads. Independent client authorization and source-link redaction remain necessary. Organization/facility SQL scopes intersect client visibility; team/assigned-client scope must not replace those predicates.
4. **Versions:** starts at 1; patch/transitions require positive safe integer versions, state validation and conditional tenant/ID/version update with increment. No-op patches return without writing. Completion/reopen retain actor/time behavior. Comments append activity/audit without version bumps or outbox events.
5. **History/audit:** addActivity handles creation/assignment/edit/status history; protected comment text stays in task activity. recordStateChange writes domain events/audit inside mutation transactions. Exceptions also use event/audit helpers, so task extraction cannot import the facade back into itself.
6. **Recurrence:** OperationsRecurrenceApplicationService owns definition lifecycle/queries/generation. Pure calendar/rule/DST logic lives in domain/recurrence.ts. Five-minute leases, tenant advisory locks and row-locked definitions protect generation. Occurrence uniqueness is (tenantId, recurrenceDefinitionId, occurrenceKey), plus unique task reference. Task/occurrence/definition/activity/audit/outbox share generation transactions. Limits: 100 definitions, 100 occurrences per definition, 500 tasks/run, 24-hour lookahead and bounded missed-generation policy. Invalid assignees become unassigned tasks with assignee_unavailable. Generation inserts tasks directly, without the interactive command.
7. **Deadline scheduler:** separate OperationsDeadlineTaskScheduler, composed for workers, takes UoW/Audit/Outbox and Benefits/Onboarding capabilities plus Billing receivable reads. It retains foreign deadline reads, policies, run tracking, idempotent task creation and exception projection. Tasks/activity are Operations-owned; employee/organization/client/agreement/benefit/payer facts are foreign-owned. Do not reroute system writes through interactive permissions.
8. **Foreign reads:** source validation reads Clients, Scheduling, Service Agreements, Care Documentation/Service Evidence, Billing invoices/claims, Benefits, Documents and raw Communications/Clients SQL. Task lists read client/employee display data; activity reads Identity; scopes/local due dates use Organizations. Recurrence validates Organizations/Facilities/Clients. Shared assignee validation reads Employees with share locks. These remain baseline debt after Goal 02. Retain the four worklist expiry APIs and Organizations timezone capability from Goal 02.
9. **Helpers/interfaces:** OperationsSourceServices carries worklist/expiry capabilities. validateOperationsAssignee is already shared by tasks, recurrence and deadline scheduling. Source mappings, task validation, local-due-date SQL, resource/view helpers remain in the large facade. Operations owns tasks, activity, recurring definitions/occurrences, reminder policies, scheduler runs and exception occurrences/interactions. Foreign tables do not become local ownership by moving their reads.
10. **Composition/tests:** Nest provides the existing Operations facade factory and independent recurrence token; worker scheduler composition is separate. apps/api/integration/operations.integration.test.ts covers creation/activity, competing versions, completion/reopen, scopes, recurrence lifecycle/generation/idempotency, scheduler paging and RLS. apps/worker/integration/outbox.integration.test.ts covers worker restart/outbox. Domain tests cover stable issue identity, recurrence cadence/DST. Preserve all coverage.

## F. Goal 04 execution plan

Smallest cohesive slice: isolate interactive task commands and queries from worklist aggregation, maintaining recurrence compatibility. Do not decompose recurrence/schedulers simultaneously.

1. Read this handoff, overview, module boundaries, dependency map and docs/domains/operations.md; inspect live state and query Graphify.
2. Create internal modules/operations/src/application/tasks.application.ts for the commands/queries above and task-specific validation, history/persistence/projections. One cohesive service with command/query sections is sufficient initially; split further only with evidence.
3. Preserve OperationsApplicationService as facade. Delegate task methods; retain dashboard/listWorkItems/listWorkQueue, exceptions, reminders and reconciliation. Keep createDeadlineTask as the current-deadline bridge into delegated creation with the same key. The task service must never call worklist aggregation.
4. Expose taskSummary through a narrow query capability for dashboard; work queue may call delegated listTasks without moving its merge/order/pagination. Share transaction-aware access/resource/history/event helpers only where required. Use leaf types/errors to prevent cycles. Keep recurrence/deadline direct inserts and existing assignee validation; no generic workflow engine.
5. Resolve baseline constraints before moving imports: the checker keys entries by source path. Moving foreign schema imports to tasks.application.ts creates new violations. Retain existing foreign reads at their current path behind explicit typed internal capabilities built from dependencies, without injecting a facade instance; alternatively introduce authorized owner APIs for only necessary moved reads. Do not move foreign SQL into a generic repository, expand/regenerate the baseline or weaken checking.
6. Preserve validation/write transaction boundaries, tenant CAS updates, deadline-task advisory lock/key, no-op behavior, client/source permission intersection, assignee share locks, display redaction and comment audit-only semantics. Retain ordered statements and error precedence; avoid nested transactions.
7. Add focused tests for delegated methods, denied/cross-tenant/client/provider scopes, assigned-to-me and name/source redaction, no-op patch and competing versions, lifecycle/completion fields, ordered history/comment privacy, rollback and deadline idempotency. Re-run recurrence/deadline/worker tests to prove generated tasks remain readable/editable and warning/history semantics unchanged. Verify count/pagination bounds and local-due-date/DST behavior.
8. Preserve factory/public exports/DI tokens, REST/DTO/OpenAPI/errors, schema/migrations and worker APIs. Run all required gates and refresh Graphify. Record actual before/after sizes, query implications and remaining debt.

Performance risks: count+page queries, correlated name/permission predicates, actor enrichment, summary scopes, repeated queue pages, source preflight reads and lock inversions. Avoid per-task owner calls, unbounded batches, altered post-pagination filtering or extra transactions. Preserve tie-breakers and source deadline identity.

Exclusions: full Operations persistence-debt removal, worklist/reconciliation rewrite, recurrence/cadence redesign, deadline foreign-read cleanup, schema changes, owner policy changes, frontend work and unrelated Scheduling cleanup. Deliver actual task ownership, not forwarding alone.

## G. Copy-ready Goal 04 prompt

> Implement Goal 04 in woobble/care: isolate Operations task commands and queries from worklist aggregation while maintaining recurrence compatibility. Read docs/architecture/goal-03-to-goal-04.md, overview.md, module-boundaries.md, dependency-map.md and docs/domains/operations.md first. Inspect live worktree/tests and Graphify; preserve unrelated changes. Do not use multi-agent mode or production credentials/data.
>
> Introduce an internal task application service for createTask, listTasks, getTask, taskActivityList, patchTask, startTask, completeTask, reopenTask, cancelTask, addComment and task-specific helpers, including dashboard's task-summary query capability. Preserve the public OperationsApplicationService/factory/exports/tokens and delegate. Keep dashboard/worklist/queue aggregation, exceptions, policies and reconciliation outside. Keep createDeadlineTask as a current-deadline facade bridge into delegated creation with the same idempotency key. Never inject the facade into its internal service.
>
> Preserve tenant RLS; independent task/client/source/assignment permissions; organization/facility visibility; source/name redaction; lifecycle/completion fields; expected-version CAS/no-op semantics; activity/comment privacy; audit-only comments; atomic domain/history/audit/outbox; deadline locks/idempotency; transaction order; pagination/counts and timezone behavior. Retain recurrence/deadline system generation, occurrence keys, assignee warning fallback, leases/limits and transactions. Reuse domain rules and shared assignee validation with narrow typed collaborators.
>
> Inspect modules/operations/src/application/{operations.application,recurrence.application,deadline-scheduler.application,operations-guards}.ts, domain/, schema.ts, Nest/worker composition and API/worker tests. There is no Operations repository today. Distinguish owner task/activity/recurrence/exception persistence from foreign schemas. New-path foreign imports are new violations: retain existing baselined reads behind explicit typed internal capabilities without facade dependency, or replace necessary reads with authorized owner APIs. Do not expand/regenerate the baseline, weaken enforcement or move foreign SQL into a generic repository. Preserve Goal 02 expiry/timezone capabilities and Goal 03 Scheduling compatibility. Do not attempt all Operations debt cleanup.
>
> Add focused orchestration/PostgreSQL tests for scopes/redaction, pagination/local dates, lifecycle/versions/no-ops, history/comments, rollback/audit/outbox and deadline idempotency; re-run recurrence/deadline/worker tests and generated-task compatibility. Run bun run architecture:check, architecture:test, lint, typecheck, test, test:integration, build, format:check, required fix/format commands, strict zero-warning lint and graphify update . Run relevant E2E when isolated OIDC is available; otherwise report unverified. Preserve REST/OpenAPI/DTO/error contracts, migrations and UI.
>
> Implement the extraction. Create mandatory docs/architecture/goal-04-to-goal-05.md before completion: status, files/interfaces/ownership, compatibility and transaction decisions, actual verification/gaps, performance implications, remaining debt, evidence-based Goal 05 preparation/plan and copy-ready Goal 05 prompt. Do not implement Goal 05. Finish with status, responsibility/file-size comparison, checks, architecture findings, issues and handoff path.
