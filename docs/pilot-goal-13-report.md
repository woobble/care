# Goal 13: Synthetic pilot simulation and product validation

**Run date:** 2026-10-16  
**Repository baseline:** `c5b8f7f`; changes remain uncommitted and the working tree was not reset.  
**Environment:** two isolated local Compose projects with retained project-scoped volumes: `care-goal13-final-validation` (PostgreSQL on 15434, Authentik, SeaweedFS, Redis, and Mailpit) for browser and live-date checks, and `care-goal13-fourweek` (PostgreSQL on 15435 and SeaweedFS) for the retrospective four-week run.  
**Data boundary:** all records were synthetic. No production service, payer, bank, or client was contacted. No commit or production deployment was made.

## Result

The seeded scenario and cross-module browser journeys completed on the isolated local stacks using retained synthetic volumes. The live-date seed was run twice against the same database; the second run generated no duplicate visits and validated existing financial records. A separate database was seeded with a retrospective 28-day window, then rerun idempotently. The expanded Playwright run passed all 12 tests in 4.9 minutes. Follow-up focused regressions passed for settings input preservation (1/1), interrupted caregiver documentation recovery (1/1), and concurrent administrator scope replacement (1/1). The caregiver regression returned a synthetic 503, confirmed that no entry reached the server, and restored the draft after a page reload. The Authentik configuration journey passed in a focused rerun (1/1 in 1.6 minutes) after its navigation wait was changed to `domcontentloaded`. The billing integration regression for a full claim rejection and corrected resubmission also passed (1/1). Final test and quality-gate results are recorded below.

This is a **partial product validation**, not a sign-off for a live pilot. The four-week run completed one visit in each simulated week, but only one of those services was allocated and billed. Settings errors, page-load observations, a rejected claim, concurrent scope replacement, and selected Operations deadline sources are covered; other operational and financial exception paths and query-plan/load behavior remain unverified.

## Synthetic scenario

The dedicated tenant `muster-betreuungsdienst-nrw` contains one provider organization, two facilities, four teams, ten employees (three Office staff and seven caregivers), twenty fictional clients, six services, twenty agreements, and seven synthetic funding sources. Fifteen clients are active and five are pending onboarding; fifteen agreements are active and five are drafts awaiting review. Client 01 has provisional §45b and §45a entitlements. The §45b record includes €25 of provider-reported external consumption; the separate §45a record has a €25 provider-reported external input, neither presented as payer-confirmed.

The live-date scenario clock was fixed at `2026-10-12` in `Europe/Berlin`. It generated 120 visits over four weeks and 103 published tours. One visit for Client 08 was executed on 2026-10-16 through the normal execution and documentation flow. The scheduling row remains `planned`; the linked execution row is `completed`, which is how these modules represent the lifecycle. The seed records a 60-minute actual interval matching the planned window through the audited time-correction workflow. One evidence package was created. The persistent seed does not record client acknowledgement or a signature.

For the retrospective run, the fixed start date was `2026-09-14`; all 28 scheduled dates were in the past by the time of execution. The same seed completed one eligible visit in each week of the four-week window through visit execution, finalized documentation, evidence, and audited time correction. Each week contained 30 scheduled visits and one completed execution. The seed was rerun with the same reference date and reported no newly generated visits. Three of the four performed services remain without funding allocations or invoices; only the representative finance visit was carried through billing and claims.

The funding and billing example is synthetic: a €34 performed service was allocated €17 to a locally configured funding source and €17 to the client. The payer claim decision and payments are local records for workflow testing, not a real authorization, claim response, or money movement.

## Reconciled database results

Read-only queries against the live-date pilot database after the second seed run returned:

| Record                                   |                   Count or amount |
| ---------------------------------------- | --------------------------------: |
| Facilities / teams                       |                             2 / 4 |
| Employees / clients                      |                           10 / 20 |
| Services / agreements / funding sources  |                        6 / 20 / 7 |
| Visits / published tours                 |                         120 / 103 |
| Completed executions / evidence packages | 1 / 1 (60-minute actual interval) |
| Client 01 §45b / §45a entitlements       |     1 provisional / 1 provisional |
| Client 01 §45a external input            |         €25.00, provider-reported |
| Service allocations                      |                        1 (€17.00) |
| Issued invoices                          |  2 (€17.00 payer + €17.00 client) |
| Accepted local claim                     |                        1 (€17.00) |
| Payments / payment allocations           |              2 / 2 (€22.66 total) |
| Client invoice paid / outstanding        |                    €5.66 / €11.34 |
| Operations tasks with source links       |                           15 / 15 |

The payer invoice is fully paid (€17.00); the client invoice has a €5.66 partial payment and €11.34 outstanding. Total recorded payments equal total payment allocations. The second seed run reported `generated=0` and `already-existing=120`; counts and invoice/payment totals remained unchanged. The pilot tenant retained one seed-only caregiver membership and no human sign-in mapping.

Read-only reconciliation of the separate historical database returned:

| Record                                                         |                Count or amount |
| -------------------------------------------------------------- | -----------------------------: |
| Scheduled visits                                               | 120 (30 in each of four weeks) |
| Completed executions / finalized documents / evidence packages |       4 / 4 / 4 (one per week) |
| Allocations / issued invoices / accepted local claims          |                      1 / 2 / 1 |
| Payer and client invoice totals                                |                €18.00 / €18.00 |
| Payments / payment allocations                                 |                €24.00 / €24.00 |
| Payer invoice settled / client invoice paid / outstanding      |        €18.00 / €6.00 / €12.00 |

Invoice lines reconcile to the one allocated service, and recorded payments equal payment allocations. The claim references the payer invoice and is accepted as a local synthetic decision. The other three performed services are not represented as billed or funded; this remains a cross-module coverage gap. Both database runs are distinct isolated datasets and must not be combined when reading totals.

Both pilot databases contain Client 01's separate provisional §45a entitlement and one €25 external-input bucket with `provider_reported` verification. The historical database contains two §45b monthly buckets for its September/October window; the live-date database contains one. A read-only Benefits integration check separately confirmed the seeded June 2025 §45b bucket is available through 2026-06-30 and has zero remaining on 2026-07-01.

## Workflow handoff

- **Admissions and agreements:** the fixture has 20 fictional clients (15 active and five pending onboarding) and 20 agreements (15 active recurring and five drafts). The Authentik journey exercised prospect/admission readiness, admission, and first-visit scheduling. Contacts, authority review, facility, service, benefit, and agreement setup were represented. The seed does not create Authentik accounts or send invitations.
- **Scheduling and substitution:** the 120-visit, four-week window includes 103 published tours, weekday assignments, a planned absence, and a confirmed substitute. The browser workflow verified the original caregiver remained assigned until confirmation and lost visit visibility after the authoritative reassignment; the substitute gained access. No OSRM route estimate was expected.
- **Caregiver execution and evidence:** the retrospective run completed one visit in each week through the visit lifecycle, finalized documentation, current evidence, and audited actual-time correction. Browser journeys also exercised quantities, acknowledgement, decline, correction, and local draft recovery. A simulated HTTP 503 produced no server record and the draft was restored after reload.
- **Benefits:** statutory §45b recognition and service eligibility, §45a external-input gating, provider-reported conversion input, provisional §45a service allocation, private/other funding, split allocations, reversals, ledger immutability, budget projections, and payer-confirmed versus provider-reported balances were exercised at integration or domain level. The §45a integration case confirms missing external input blocks allocation, and adding provider-reported input enables only provisional allocation with zero confirmed balance. The Benefits integration test also verified a persisted §45b bucket remains available through 2026-06-30 and is excluded from the balance on 2026-07-01. New integration assertions confirm an expired carryover entitlement is rejected while a current provisional entitlement remains allocatable, the expired bucket receives no service-consumption entry, and provider-reported external consumption that exhausts the estimated balance blocks another allocation without creating a confirmed balance. Existing domain tests cover earliest-expiry allocation.
- **Billing and PDFs:** invoice candidates, split payer/client invoices, issuance, immutable line reconciliation, partial client payment, full payer settlement, authorized PDF preview/download, private-storage readback, and document artifact versioning were exercised. Historical totals are shown above; a submitted or accepted synthetic claim is not treated as client payment.
- **Claims:** the Authentik journey prepared and recorded local acceptance and payment. API integration now covers partial acceptance with corrected resubmission and a full rejection followed by corrected resubmission. No external payer system was contacted.
- **Documents and communications:** document template versioning, PDF generation, scope checks, artifact readback, document association, linked communications, and follow-up task navigation were exercised. Templates and messages used synthetic records.
- **Operations:** 15 seeded tasks have source links for onboarding, agreements, funding review, client receivables, and a local claim exercise. API integration covers unassigned visits, upcoming and overdue receivables (including dashboard overdue counts), overdue onboarding follow-ups, rejected claims, missing service evidence, agreement, qualification, benefit-entitlement, payer-authorization, and onboarding deadlines, source filtering, tenant isolation, recurring-task idempotence, and source-linked resolution. Browser coverage exercised task workflow, communication follow-up, recurrence, duplicate prevention, and the unallocated-service issue appearing before funding allocation and clearing afterward.
- **Administration and settings:** browser journeys covered invitations, pending identities, facility scope save/reload/clear, role change, activation, revocation, audit visibility, scoped facility visibility, and settings saves plus recoverable errors. Two simultaneous scope replacements serialized under the membership row lock. The final state matched one complete submitted set; the API exposes no version-conflict token, so stale concurrent replacements are last-write-wins.
- **Authorization and privacy:** API tenant/resource scope, facility-scoped lists, caregiver assignment access before/after substitution, financial permission paths, and document scope/download checks passed in the exercised paths. Test identities were synthetic and temporary membership links were removed. The persistent seed caregiver has no sign-in mapping.
- **Cross-module reconciliation:** the live-date and historical tables reconcile execution to documentation/evidence and allocation to invoice lines, claim, and payments. Three historical completed services are deliberately visible as not yet allocated or invoiced; no invoice or payer balance was fabricated for them.
- **UX and workflow friction:** PILOT-006 and PILOT-007 were fixed and covered. The caregiver retains edits across a transport failure; settings retain attempted values after recoverable errors and avoid stale success banners. The mobile Operations view fits the checked width but needs vertical scrolling. PILOT-005 remains a low-priority disclosure hydration warning; development runs also emitted React style and Next destination-stream diagnostics without a failed browser assertion.

## Browser and module coverage

The latest expanded Playwright run passed **12/12 tests in 4.9 minutes** on the isolated stack. A prior run had an Authentik navigation timeout; the test now waits for `domcontentloaded`, and both a focused retry (1/1 in 1.6 minutes) and the expanded run passed. The settings journey passed in the expanded run (16.5 seconds) and in earlier focused runs. Most journeys create synthetic E2E records in the local Demo Care tenant; they do not all operate on the seeded 20-client pilot data. The identity/access journey temporarily adds an E2E administrator to the pilot to inspect its Operations list and claim source, then removes that membership. The persistent pilot membership is the unlinked seed caregiver actor.

The suite covered:

- Client admission and visit planning.
- Service, client, benefit, and agreement configuration.
- Visit delivery, documentation finalization, evidence, acknowledgement, and correction scenarios.
- Benefit allocation, invoice issuance, and payment recording.
- Document review and linked communications with follow-up, including PDF generation, private-storage readback, and preview/download checks.
- Invitation creation and duplicate-pending-invitation error handling; pending identity behavior; facility scope selection, clearing and saving; role changes; activation, deactivation and revocation; audit display; and visibility of only the scoped facility.
- Operations dashboards, task workflow, recurrence, seeded pilot source navigation, responsive office navigation/theme states, and caregiver Today view.
- Billing profile, payer and requirements, document-template, and reminder settings saves, reload persistence, validation/stale-version errors, and absence of stale success banners.

The browser journey also checked the seeded 15-task list and opened the local accepted-claim source. The scoped Office account could see Facility West while Main Office was absent from its facility list. The benefits-billing browser regression passed **1/1 in 35.2 seconds**, confirming the unallocated-service issue appears for the scenario client before funding and clears after allocation. The focused Operations API/PostgreSQL integration test passed **1 test and 209 assertions**, including overdue receivable and onboarding follow-up visibility, rejected-claim and missing-service-evidence projections, a nonzero overdue dashboard count, and combined-queue pagination with the new critical exception. The complete integration task set passed: API/PostgreSQL **6 tests and 1,335 assertions**, worker outbox integration, and database RLS/migration integration.

The absence/substitution journey recorded leave for an assigned employee, followed the affected-visit link, proposed and confirmed a substitute, verified that the original assignment stayed active until confirmation, and queried the resulting assignment history. After confirmation, the original caregiver received no visit details and the substitute caregiver could open the visit. The documentation journey saved a synthetic entry locally, reloaded before submitting, restored the draft, and confirmed that no server entry existed. A focused follow-up returned HTTP 503 for the server-action POST, verified no entry was persisted, then reloaded and restored the same local draft. This closed PILOT-006.

Responsive checks covered desktop, tablet, and 390px mobile layouts. The office shell and Operations dashboard remained within the viewport; the mobile Operations view uses a long stack of readable cards, so it requires vertical scrolling. Follow-up browser regressions resolved recovery findings PILOT-006 and PILOT-007.

## Pilot-scale page observations

The identity/access browser journey measured a sequential full-page navigation until the page's first level-one heading was visible, filtered to the synthetic pilot organization where the route supports it. These are single local development observations, not capacity or production latency benchmarks.

| Office page          | Pilot-sized query                             | Elapsed |
| -------------------- | --------------------------------------------- | ------: |
| Operations dashboard | Organization scope                            |  574 ms |
| Client search        | `Musterkunde`, 20 clients in the tenant       |  414 ms |
| Employee search      | `Betreuungskraft`, 10 employees in the tenant |  486 ms |
| Week planner         | Week of 2026-10-16, 120 planned visits        |  413 ms |
| Benefits worklist    | October 2026, 20 clients                      |  441 ms |
| Invoice worklist     | 2026-10-12 through 2026-11-08                 |  422 ms |
| Claims worklist      | Organization scope, page size 20              |  442 ms |
| Operations task list | Synthetic pilot tasks, page size 20           |  415 ms |

The sample ran on local Linux x86_64 (24 logical CPUs; 30 GiB memory visible to the host, about 17 GiB available before the run), with Next.js development mode and local Docker Compose services. It did not capture SQL query plans, repeat/cold-cache distributions, concurrency, throughput, or production-equivalent infrastructure. No N+1 or unbounded-query review was performed; query behavior remains a follow-up.

## Coverage gaps and risks

The following parts of the requested pilot remain unverified:

- Realistic daily-volume execution: one visit per week was completed, not all 30 scheduled visits per week. Three completed services in the historical run still lack allocations and invoices.
- Client or representative acknowledgement/decline on the persistent pilot visit; acknowledgement, decline, and correction were exercised only in the separate E2E journey.
- Conflicting or unconfirmed external consumption beyond the seeded provider-reported examples remains untested. Allocation reversals are covered at the domain/API integration level.
- Payer-facing claim transmission remains untested. A billing integration test now covers a full rejection followed by corrected resubmission, and another covers partial acceptance; seeded claim outcomes remain local-only.
- Overpayment, refund, and overdue collection paths. Invoice correction and payment-allocation reversal are covered at the integration level.
- Administrator role-conflict resolution remains untested. A browser test submitted two simultaneous full-scope replacements for one membership: row locking serialized them, and the final state matched one complete submitted scope set. The service has no expected-version conflict token, so concurrent stale replacements use last-write-wins behavior.
- Sickness absence and failed/conflicting substitute assignment. Qualification expiry and the listed deadline projections are covered by API integration, although they are not seeded in the persistent pilot tenant.
- Pending communication follow-up task navigation and unallocated-service appearance/resolution are covered in browser journeys.
- SQL query plans, concurrent load, throughput, and latency distributions. The local route observations above are not production performance evidence.

OSRM was disabled. No external payer, banking, or messaging integration was used. The scenario intentionally does not infer statutory eligibility or payer-confirmed balances from synthetic funding records.

## Prioritized findings

### P0 — Critical

None reproduced.

### P1 — High

**PILOT-006 — resolved:** React Hook Form disables the fieldset while submitting. The caregiver draft hook had reconstructed `FormData` after that disabled state began, saw no values, and removed the saved draft. It now uses the submission `FormData` built before the fieldset was disabled. Transport errors are caught in the shared action form while Next redirect signals continue through the transition, and the caregiver form shows the uncertain status and re-enables submission. The regression injected a 503, confirmed the entry was absent from PostgreSQL, saw the uncertain status, reloaded the page, and restored the same draft.

### P2 — Medium

- Investigate three completed services without allocations or invoices.
- Add realistic daily-volume execution. Unassigned visits, overdue invoices, overdue onboarding follow-ups, rejected claims, missing service evidence, qualification expiry, and unallocated-service visibility/resolution already have coverage.
- PILOT-007 is resolved: the focused settings journey confirms billing, payer requirements, template, and reminder inputs survive recoverable errors while persisted values remain unchanged.
- Add query-plan review and repeated/concurrent performance measurements at representative scale.

These are validation gaps, not confirmed product defects.

### P3 — Low

- The final dev browser run emitted React hydration diagnostics for `caret-color: transparent` styles on form inputs and Next.js destination-stream write errors, along with environment color and `pg` client-concurrency deprecation warnings. All 12 browser tests passed. Confirm whether browser/stream diagnostics recur in a production-like build before assigning a product defect.
- The mobile Operations dashboard is a tall card stack. It fit the viewport width and remained readable in the checked screenshots, but routine work requires vertical scrolling.
- The findings register retains a low-priority disclosure hydration warning from an earlier local journey; no user-visible failure was reproduced in the focused document/communications retry.

## Verification and reproduction

The scenario setup and safety constraints are documented in [pilot-scenario.md](pilot-scenario.md). On a fresh, isolated local development stack, apply migrations and run `bun run pilot:seed`. Keep `PILOT_REFERENCE_DATE` fixed across reruns; for same-day execution, set it so the selected Client 06–10 has an eligible visit today. The seed refuses non-development mode and non-loopback database hosts, does not drop or truncate data, and only accepts a non-default database port when both dedicated-test flags and matching loopback URLs are set.

The expanded Playwright run passed 12/12 in 4.9 minutes. Focused regressions for settings recovery, caregiver interrupted-save recovery, and concurrent membership scope replacement each passed 1/1 after their changes. The benefits-billing Operations visibility regression passed 1/1 in 35.2 seconds, and the Authentik configuration journey passed 1/1 in a focused rerun after the navigation-wait adjustment. The full `bun run test:integration` task passed, including API/PostgreSQL **6 tests and 1,335 assertions**, worker outbox, and database RLS/migration integration. Root gates passed: `bun run build` (32/32 tasks, OpenAPI and client generation), `bun run typecheck` (33/33), `bun run lint` (33/33), `bun run test` (51/51), `bun run i18n:check` (3,528 messages), `bun run format:check`, `bunx oxlint --deny-warnings --format=agent`, and `git diff --check`. Both pilot seed reruns reported `generated=0` and `already-existing=120`; the retrospective run additionally reported `weekly execution timeline=4/4 available weeks`. Read-only reconciliation is recorded above.

Repository checks passed: `bun run build` (32/32 tasks, including OpenAPI and API client generation), `bun run typecheck` (33/33), `bun run lint` (33/33), `bun run test` (51/51), `bun run i18n:check` (3,528 messages), final `bunx oxlint --deny-warnings --format=agent`, `bun run format:check`, and `git diff --check`. `graphify update .` completed after the final code edits. `git status --short` confirms changes remain uncommitted; no reset or volume cleanup was performed.

All test services and data were local and isolated from the shared development stack. No shared or pilot volume was reset or removed. Demo Care retains synthetic E2E business fixtures, including uniquely named settings organizations; the Authentik session helpers remove their synthetic sign-in identities and memberships. Both isolated Compose projects remain running with their project-scoped volumes. Reproduction and safe volume-discard instructions are in [pilot-scenario.md](pilot-scenario.md).
