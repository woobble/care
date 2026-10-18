# Release-candidate readiness assessment

**Assessment date:** 2026-10-18
**Repository baseline:** `b9a2fdf` (clean when Goal 14 began)  
**Status:** Not cleared for release. Goal 15 completed the full Authentik browser suite, direct API load and concurrency measurements, authenticated post-restore document retrieval, a process-kill test for recurring Operations tasks, eight query plans, production-image runtime smokes, and a separate-segment backup timing run. Current local final-artifact scans leave Authentik at one critical and 15 high IDs and the rebuilt Grafana candidate at four high package instances across three unique IDs. A new linux/amd64 OSRM runtime candidate removes the prior Debian utility packages from the final image and scans at zero critical/high. Application images and several rebuilt infrastructure candidates have no critical/high findings, but custom local candidates have not been published under immutable registry digests. Targeted accessibility audits cover visible semantics, responsive overflow, touch targets, dialog focus cycles in two Office workflows, representative color-token contrast pairs, localized pagination navigation/current-page state, shared-form validation announcements and focus, and a new keyboard/reduced-motion pass across 11 Office routes at three viewport sizes. Broader dialog coverage, rendered-state contrast coverage, production external configuration, security-owner acceptance, and review of two possible local process-output exposures remain open. No production deployment was attempted.

Goal 15A’s 2026-10-18 updates rebuilt and rescanned exact local application/custom images, moved OTel and Mailpit to digest-pinned releases with zero critical/high findings, and directly reverified the official SeaweedFS 4.48 linux/amd64 registry manifest. The OSRM runtime now retains the pinned official v26.10.0 routing binary in a pinned Distroless Debian 13 C++ base; its exact local final image has zero critical/high findings, down from eight high Debian-package IDs. A derived Authentik candidate updates fixed OpenSSL and urllib3 packages and removes unused global pip tooling; its exact final scan has one critical and 15 high IDs. A Grafana source rebuild fixes the main server's kin-openapi findings, but its retained signed Prometheus plugin still has four high package instances across three unique IDs. The patched SeaweedFS, Prometheus, OSRM, Authentik, and Grafana artifacts remain local builds without registry manifest digests. Sections 19–28 preserve the successive evidence; section 29 records the latest container update, and section 28 records the latest focused accessibility fix. The platform remains blocked and is not cleared for production.

Sections 1–14 preserve Goal 13/14 evidence and their historical verification state. Section 15 records the Goal 15 baseline; sections 16–31 contain the later Goal 15 and container-security evidence, including corrections to earlier incomplete-status statements.

This is a technical assessment, not a production-readiness, GDPR-compliance, or legal certification. Goal 13 workload results below are prior verified synthetic runs; the historical scheduling and billing records were re-queried through application services during this assessment.

## 1. Repository and environment

- The worktree was clean at the start of Goal 14 at commit `b9a2fdf`. The changes listed in the final handoff remain uncommitted.
- Repository tool versions during verification: Bun 1.4.3 and Node 24.21.0. The workspace contains 33 packages.
- The local Goal 14 workload and authenticated E2E project ran in isolated `care-goal14-workload` and `care-goal14-e2e` projects. A separate `care-goal14-restore` project held the restored Authentik, object storage, Redis, mail, and PostgreSQL targets. The retained Goal 13 projects were `care-goal13-fourweek` and `care-goal13-final-validation`. No project or volume was reset or removed.
- Runtime checks used the explicit local Docker configuration at `/tmp/care-goal14-docker-config`; restored API, web, and worker processes connected only to the isolated recovery targets. Production Compose syntax still passed without starting production services.
- Metadata checks showed `.env.production` and nine files under `secrets/` at mode `0600`. I inadvertently ran a quiet Compose syntax check with `.env.production`, `bun run backup:create` (whose deploy wrapper loads it), and `bun run build` (which invokes a Next.js production build); those tools can load the file automatically. The backup attempt failed during Docker build before creating a recovery set. A later `bun outdated` attempt also reported `.env.production` and `.env` by name. None of these commands printed secret values or file contents. Subsequent recovery work used the recovery CLI directly with isolated synthetic targets, and the Compose syntax check was repeated with `.env.production.example`. The production preflight was not run because it would contact configured external services.

### Goal 15 environment-isolation remediation

- Added root `bunfig.toml` with Bun automatic dotenv loading disabled. The shared application loader now reads only `.env` in development, only `.env.test` in tests, and no dotenv file in production. Browser tests select `.env.test` and reject `NODE_ENV=production`; their locally spawned API/web processes use development mode.
- Next.js has a separate dotenv loader, so the root build now sets and passes `NODE_ENV=test` through Turbo. This makes `next build` select `.env.test` or local `.env` instead of `.env.production`; the supported build command does not need production credentials.
- Added five focused environment-selection tests. They verify development/test file selection, production skips dotenv, tests do not fall back to `.env`, and Bun does not auto-load a synthetic `.env.production` even when `NODE_ENV=production`.
- `env -i ... docker compose --env-file .env.production.example -f compose.yaml -f compose.production.yaml config --quiet` passed without starting services. The earlier production-mode build was not used as isolation evidence because Next.js can load `.env.production` itself; the guarded `NODE_ENV=test bun run build` is the current build path. Removing the dotenv loader import from the web auth module also removed Next.js's dynamic filesystem tracing warning.
- An earlier local comparison scanned `.next` build artifacts against 17 values and found zero exact matches; that is historical evidence only. After the guarded Goal 15 build, a separate comparison checked all 8,239 `.next` files against ten non-placeholder sensitive values from the isolated `.env.test` and found zero matches. The two excluded matches were public weak-secret guard strings already present in source validation code, not injected environment values. `.dockerignore` excludes `.env.*` from Docker build contexts. No production preflight, service start, backup, restore, or deployment was run for this remediation.

## 2. Goal 13 validation gaps

### Historical services

The three historical performed services were queried in the retained synthetic Goal 13 database using the billing application service under the restricted application role. No allocation or invoice was created during reconciliation.

| Service date | Performed service ID                   | Verified state                                                                                                                                                             |
| ------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-21   | `598c4bc5-81bc-56c3-8845-d99b97299cfe` | Ready self-pay billing candidate for €36.00, payable by the client. No funding allocation exists and no prerequisite blocker was returned. Eligible but not yet allocated. |
| 2026-09-28   | `2c5b372b-1fad-5934-94a5-53580eb0c5d2` | Ready self-pay billing candidate for €36.00, payable by the client. No funding allocation exists and no prerequisite blocker was returned. Eligible but not yet allocated. |
| 2026-10-05   | `3e504eb6-b61e-59bb-b6b7-1e4ed454bb22` | Ready self-pay billing candidate for €36.00, payable by the client. No funding allocation exists and no prerequisite blocker was returned. Eligible but not yet allocated. |

The representative financial service dated 2026-09-14 (`742b6c39-755a-56e3-bc55-3773af9fef5d`) had one funding allocation and two issued invoice lines. Its remaining candidate slices were correctly blocked as `BILLING_SERVICE_ALREADY_INVOICED`. These records were re-queried through the restricted billing application service; no allocation or invoice was created during re-verification.

### Scheduling eligibility issue found during workload preparation

A retained Goal 13 synthetic record has a historical confirmed substitution (`01a14683-36fd-740a-8872-2f3ac29f6352`) involving Office employee `PILOT-OFF-03` on visit `01a14634-ed4d-7685-b686-8d7fe1b7c22c`, created during a failed seed retry. The corrective substitution was re-queried through scheduling application services and is active with caregiver `PILOT-BET-05`. The pilot tenant has zero active Office assignments. The original event remains historical; no direct SQL correction was made.

The application now rejects Office employees in `EmployeeApplicationService.validateForScheduling`, exposes `VISIT_EMPLOYEE_NOT_ELIGIBLE` as a conflict, and excludes such employees from scheduling and substitution candidates through the shared validation path. A focused test proves Office rejection and continued acceptance of a part-time caregiver. The new clean Goal 14 workload had zero active Office assignments.

## 3. Synthetic workload profile

The optional `PILOT_WORKLOAD_VISITS_PER_WORKDAY=3` mode is documented in [pilot-scenario.md](pilot-scenario.md). It preserves the original seed behavior when unset, uses stable fixture identities, and rejects a retrospective day that cannot meet the requested workload.

The verified isolated run used 20 fictional clients, seven caregivers, three Office employees, four weeks, six scheduled visits per weekday, and three completed visits per weekday:

- 120 scheduled visits over 20 working days; 60 completed executions and performed services.
- Three distinct clients and three distinct caregivers among the completed visits on each day.
- 60 finalized care documents and 60 evidence packages. The fixture does not invent client acknowledgements or signatures.
- One planned-leave and one sick-leave absence, each with a confirmed substitution; 104 published tours.
- Zero duplicate generation keys, incorrect active assignment counts, or active Office assignments.
- Billing candidate evaluation returned 61 rows for 60 performed services: 59 ready self-pay services and two already-invoiced slices for the representative financial service. No duplicate candidate service was selected.
- The Operations worklist returned 136 understood fixture exceptions: 60 missing client acknowledgements, 60 unallocated services, 14 missing entitlements, one unverified provider-reported balance, and one overdue synthetic receivable. There were no missing-documentation, overdue-execution, or claims exceptions.
- A second seed run was idempotent: `generated=0`, `already-existing=120`; the 60/60 completed workload and two confirmed substitutions remained stable.

The intentionally unresolved acknowledgements, unallocated services, missing entitlements, and provider-reported balances are fixture review conditions, not evidence of unexpected execution or documentation loss. No historical service was automatically allocated or invoiced.

## 4. Performance baseline and query plans

Three representative plans were captured with `EXPLAIN (ANALYZE, BUFFERS)` on the Goal 14 fixture database under the pilot tenant's RLS context:

| Query shape                                            | Rows | Execution | Shared buffer hits | Observations                                                                                                                                       |
| ------------------------------------------------------ | ---: | --------: | -----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seven-day visit page                                   |   20 |  0.322 ms |                142 | Visits scanned sequentially at the 120-row fixture size; joins used indexes.                                                                       |
| Weekly visit counts                                    |   30 |  0.103 ms |                  5 | Small-table sequential scans.                                                                                                                      |
| Client name search with joins and effective Pflegegrad |   20 |  6.870 ms |                150 | Contains search had no matching name index; Pflegegrad exclusion index ran once per client, 20 loops with 10 rows per loop before the join filter. |

An authenticated browser check requested nine high-frequency pages in three batches of three concurrent page navigations. In the latest completed identity/access test, all nine pages returned HTTP 200 in 3.213 seconds total (about 2.8 page navigations/second), with p50 995 ms and p95 1,156 ms. The foreign-organization route returned no client result section. These timings include browser rendering and server/API work. This was a short page-level workload proxy, not a direct API endpoint load test, sustained load, or a production target. An earlier nine-at-once burst hit one Chromium `ERR_NETWORK_CHANGED`; the test now caps each batch at three pages. No index was added based on the small local fixture.

Before a release decision, measure dashboard, search, scheduling, benefits, billing, claims/evidence, Operations, and administration API latency, throughput, and error rate under concurrent authorized requests. Record local hardware, p50/p95, buffer use, and exact seed revision. Do not infer a live-service target from these local results.

## 5. Security review

Source and unit-test review found these controls:

- OIDC access tokens are validated against the configured issuer, audience, expiry, and an explicit signing-algorithm allowlist. The tenant header selects a candidate tenant but is accepted only after active membership resolution.
- Application, migration-owner, and worker database URLs use separate roles. Tenant-owned tables use forced RLS; transaction-local tenant/user settings prevent pooled context leakage. The worker has a distinct outbox policy.
- Role assignment rechecks the actor's current membership and restricts grants to permissions the actor can grant. Resource scopes are checked by owning application services.
- Better Auth trusts only the configured web origin, disables password login and automatic account linking, encrypts OAuth tokens, uses secure cookies in production, and gives sessions an eight-hour expiry with a one-hour update age.
- API CORS allows the configured web origin without credentialed cross-origin requests. The HTTP adapter test confirms an attacker origin receives only the configured web-origin value and no credentialed CORS header. Helmet is enabled. API responses default to `private, no-store`; the adapter test also checks correlation IDs, 512 KiB multipart bounds, and rejection of multiple uploaded files.
- Private invoice/document retrieval reauthorizes the source and verifies the stored hash. Signature retrieval reauthorizes the evidence package and checks both stored hashes.
- Pino redacts authorization, cookie, token, password, database URL, and storage credential fields. Request logs contain method, path without query, status, duration, and correlation ID, not request bodies. Slow SQL logs omit bound parameters.
- The production Caddy proxy now sets HSTS, `nosniff`, clickjacking protection, and a restrictive referrer policy for the web, API, and Authentik hosts.

The current PostgreSQL/API integration suite and focused post-change cases exercised the requested adversarial boundaries on synthetic data:

- Cross-tenant client retrieval returned 404. A scheduling assignment using a real employee from another tenant returned 404 `EMPLOYEE_NOT_FOUND`, and the visit remained unassigned.
- A tenant-scoped principal could not read another tenant's funding budget. RLS read/write checks also showed funding rows changing with tenant context.
- An invoice PDF request from a principal in another tenant returned `InvoiceNotFoundError`; a same-tenant principal without billing permission was denied. Cross-tenant claim and source-document/evidence access also returned not-found or authorization-denied results.
- A caregiver-role token could not change another member's scopes (403). Office scope changes were checked for cross-tenant references and for their effect on facility visibility.
- A replayed funding allocation returned the original allocation IDs; a changed replay payload was rejected as a conflict.
- Evidence/document download without `service_evidence.read` was denied, and an artifact from another tenant was not found.

The full API/PostgreSQL integration suite passed before the final two assertion additions; the updated billing and client integration files then passed individually. Caddy's updated header syntax was reviewed against the official [Caddy header directive](https://caddyserver.com/docs/caddyfile/directives/header); Caddy itself was not started to validate the adapted config.

No API or Caddy rate limiting was found. Before exposing the service publicly, define and verify request limits at the approved edge or add an application-level policy for expensive and abuse-prone endpoints. The targeted runtime checks passed; they are representative boundary tests, not a full penetration test. No confirmed code-level P0 issue was found in source review.

## 6. Privacy and data protection

The existing [privacy](security/privacy.md) and [data lifecycle](security/data-lifecycle.md) inventories accurately describe the reviewed behavior:

- Client and care data are returned through scoped projections; insurance details are excluded from search and timeline output. Care narratives and signature bytes are omitted from worklists, audit metadata, logs, and outbox payloads.
- Invoice and benefit CSV exports exist for authorized scopes. There is no general client data export covering every operational, evidence, audit, retired-schema, and backup record.
- Caregiver drafts are scoped in browser `sessionStorage` by user, tenant, visit, and form; they are unencrypted, remain available to the active browser profile, and expire after 24 hours or when inaccessible/stale.
- Session lifetime and access deactivation are enforced by the application. There is no universal client cascade delete, automatic legal-retention deletion, outbox purge, or object-orphan purge. Retired schemas are retained and included in backups. Recovery copies may retain deleted or superseded information until backup expiry.
- No automatic deletion policy exists for signature/evidence history. The recovery default retention of 30 days is an operational default, not a legal schedule.

Legal and organizational decisions remain for lawful basis, notices, processor agreements, hosting region, retention periods, access/deletion/anonymization requests, signature retention, and backup retention. No GDPR compliance claim is made.

## 7. Backup and recovery

The existing paired recovery tool and [operations runbook](runbooks/pilot-operations.md) cover PostgreSQL (`care` and `authentik`), global roles, all current private-bucket objects and metadata, checksums, migration checksums, forced-RLS counts, selected business counts, and database-to-object references. Restore validation checks target isolation, migration compatibility, record/reference counts, storage metadata, and object bytes. The tool reports orphans and does not delete them.

An isolated paired recovery set (`care-20261016T220350489Z-58ba4cf9`) was created and verified from the synthetic workload. It contains both PostgreSQL databases and six private-bucket objects. The recovery CLI restored it to a fresh isolated target and verified migration compatibility, forced-RLS counts, selected business counts, database-to-object references, object metadata, and byte hashes. The restored Authentik OIDC discovery endpoint returned HTTP 200. Restored API readiness passed database, storage, and worker checks, and the restored web root returned HTTP 200.

The restore command's start and completion timestamps were not captured, so the actual restore duration is unreported. The drill did not retrieve invoice PDFs and evidence through their authenticated application routes or compare every financial-history invariant. No RPO or RTO is claimed. The recovery artifacts and isolated volumes remain available for review; no source project or volume was removed.

## 8. Worker and background processing

The worker uses the separate `care_worker` role and PostgreSQL outbox. The reviewed worker batches up to 50 messages, leases for 120 seconds, retries up to ten times, reports heartbeat/scheduler/outbox status, and has a 30-second Compose stop grace period with a 10-second in-process shutdown timeout. Health and Prometheus metrics expose heartbeat age, backlog, scheduler state, and dead-letter count without tenant labels.

The worker now has a catch-all event subscription after type-specific handlers. It records delivery through the existing logging-only path for event types without a specialized handler; this prevents otherwise-unhandled committed event types from being retried as missing handlers. The catch-all does not create domain side effects. The outbox integration test covers four formerly missing event families, and the focused test passed.

A controlled crash drill on an isolated synthetic event killed the worker after its claim committed and while delivery was paused inside PostgreSQL. The row remained `processing` at attempt 1. After the test lease expired and the worker restarted, it reclaimed the row and marked it delivered at attempt 2. All 917 restored outbox rows ended in `delivered`. The drill validates lease recovery and delivery state only; it does not prove external side-effect idempotency, and recurring generation, reminders, or consequential operations were not exercised. Graceful shutdown and handler-specific idempotency still need review.

## 9. Configuration and containers

- `docker compose --env-file .env.production.example -f compose.yaml -f compose.production.yaml config --quiet` passed without starting services. An earlier quiet syntax check inadvertently used `.env.production`; see the environment disclosure in section 1.
- The production override removes host ports from PostgreSQL, Redis, Authentik, SeaweedFS, and OSRM. Caddy is the only service publishing host ports (80/443). The API, web, worker, migration, operator, and storage services use private Compose networks and health/dependency checks.
- The production override specifies restart policies and a 30-second stop grace period for API, web, and worker. The migration job must complete before API and worker startup. PostgreSQL health is a dependency of migration and Authentik startup.
- The production Compose file has no CPU or memory resource limits/reservations. Most images use versioned tags rather than immutable digests; OSRM is digest-pinned.
- The production environment/secret files had restrictive mode metadata, but values, owner IDs, remote database reachability, SMTP, TLS/domain setup, external S3, Authentik discovery, and real preflight behavior were not validated. The deployment preflight was deliberately not run.

### Remote container image scan

On 2026-10-16, Trivy 0.76.0 scanned the remote production image references with its vulnerability database updated at `2026-10-16T01:13:54Z`. Counts below are unique vulnerability IDs per image, with the highest reported severity used when an ID appears in multiple packages or binaries. Trivy noted that some severities came from alternate vendor sources. Digests are shortened to 12 characters; complete scan JSON is in the temporary `/tmp/care-trivy/` directory and is not committed.

| Image reference                                        | Resolved digest | Critical | High | Medium | Low | Unknown |
| ------------------------------------------------------ | --------------- | -------: | ---: | -----: | --: | ------: |
| `oven/bun:1.4.2` (API, web, worker, and operator base) | `9114c058aeae`  |        3 |   20 |     52 |  36 |       3 |
| `postgres:18-alpine`                                   | `77f585114c32`  |        1 |   24 |     32 |   3 |       2 |
| `redis:8-alpine`                                       | `3811787313eb`  |        0 |    0 |      1 |   0 |       0 |
| `ghcr.io/goauthentik/server:2026.8.3`                  | `ab9b4e8cc4ab`  |        3 |   27 |     65 |  57 |       3 |
| `chrislusf/seaweedfs:4.48`                             | `4e61d15fd359`  |        0 |    3 |     10 |   1 |       2 |
| `amazon/aws-cli:2.33.1`                                | `30df7db05447`  |        0 |  132 |     60 |   7 |       0 |
| `otel/opentelemetry-collector-contrib:0.162.0`         | `39923a8e431b`  |        0 |    3 |      8 |   1 |       2 |
| `prom/prometheus:v3.15.0`                              | `efd719c99d83`  |        0 |    3 |      8 |   1 |       2 |
| `grafana/grafana:13.2.3`                               | `b28bae15e219`  |        0 |   11 |     15 |   2 |       2 |
| `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian`    | `55dbfd47d984`  |        0 |   10 |     39 |  35 |       3 |
| `caddy:2.10.2-alpine`                                  | `4c6e91c6ed0e`  |        5 |   66 |     69 |  23 |       4 |

The critical results include Debian `perl-base` findings in the Bun base, `libxml2` and Python `PyJWT`/`anyio` findings in Authentik, a bundled Go `gosu` finding in PostgreSQL, and OpenSSL, Caddy, and bundled Go dependency findings in Caddy. Trivy reported patched versions for several of these packages, including `PyJWT` 2.14.0, `anyio` 4.14.2, and Caddy 2.11.4; other findings have no fixed version in this database. The AWS CLI image has 132 unique high-severity IDs, largely in its Amazon Linux packages. These findings require package-owner review and updated-image rescans; they are not evidence that each package is reachable or exploitable in this deployment.

The worker and operator images were built locally and scanned on 2026-10-17 with Trivy 0.76.0 and the cached vulnerability database. Counts below are unique vulnerability IDs per image, with the highest reported severity used when an ID appears in multiple packages or binaries. The worker image (`care-goal14-worker-interrupt`, digest `895759d4a55b`) reported 3 critical, 20 high, 52 medium, 36 low, and 3 unknown findings. The operator image (`care-platform-operator`, digest `202e3ebf5f11`) reported 0 critical, 32 high, 71 medium, 85 low, and 5 unknown findings. Full JSON remains in `/tmp/care-trivy/` and is not committed. API and web images were not built or scanned. The scan command used `trivy image --image-src docker --scanners vuln --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL`; rescan exact release digests after image updates.

## 10. Diagnostics and operations

The API logs structured request duration and correlation identifiers and warns on production requests at or above one second. Route labels are bounded, query strings are omitted from request logs, and metrics carry no tenant/client identifiers. PostgreSQL slow-query logs omit parameter values. The preflight checks configuration, migration checksums, forced RLS, storage, Authentik discovery, API and worker readiness, worker heartbeat/backlog, and backup age/integrity. The existing runbook documents recovery and failure handling.

Alert thresholds, notification routing, backup encryption and destination, on-call ownership, host resource sizing, and a live preflight remain operator setup. No new monitoring platform was introduced.

## 11. Accessibility and high-frequency workflows

Earlier browser runs included one `ERR_NETWORK_CHANGED` during identity/access, followed by an interrupted rerun. After reducing page-navigation batches to three, the complete isolated suite passed 12/12 with no skips in 4.6 minutes on 2026-10-17. `ERR_NETWORK_CHANGED` did not recur. The run logged a React hydration mismatch on an Operations screen and transient Next.js stream-write errors during navigation; the affected E2E journeys passed.

The earlier responsive checks exercised client and agreement flows, benefit funding, claims settings, documents, administration scopes, Office navigation, Operations, and caregiver Today at 390×844, 768×1024, and 1440×900. Keyboard checks covered Office navigation, escape/collapse behavior, focus return, and administration combobox selection. At that stage the suite did not exercise every listed action at every size or fully audit visible focus, error announcements, contrast, touch targets, and reduced motion; the targeted Goal 15 checks and their remaining limits are recorded below. No WCAG certification is claimed.

After the first Goal 15 run, the shared Playwright review helpers added checks at every screenshot and responsive-layout checkpoint. The checks require accessible names for visible controls and fields, `alt` attributes on visible images, no document-level horizontal overflow beyond a one-pixel tolerance, and a minimum 24×24 CSS-pixel interactive target. Target sizing accounts for associated clickable labels and the reusable checkbox's explicit `::after` hit area. The review generated 72 captures spanning administration, clients, agreements, benefits, billing, and Operations; responsive checks also covered caregiver Today and other screens that do not produce review captures. The Office shell test asserts a visible focus ring, Escape handling, focus return, and reduced-motion behavior. The visit-details Sheet now has `aria-modal="true"` and a Tab/Shift+Tab wrap check; its Escape and focus return to the planner link are exercised at 390×844, 768×1024, and 1440×900. Those checks exposed duplicate IDs between the planner and intercepted visit form; the detail form now uses unique IDs, and all four rescheduling fields are checked by accessible label. Entity selection checks focus placement for single-select and multi-select comboboxes. A representative contrast calculation converted 12 foreground/background token pairs from the light and dark OKLCH palettes to linear sRGB and applied the WCAG 2.x relative-luminance formula. All pairs exceeded 4.5:1; the lowest was 5.58:1 in light mode and 4.60:1 in dark mode. The measured pairs cover foreground/background, card, popover, muted, primary, secondary, accent, success-muted, warning-muted, sidebar, sidebar-accent, and destructive text on card. This token-level calculation does not cover every rendered style, opacity overlay, or component state. The latest full authenticated rerun passed 12/12 tests with zero skips and exit code 0 in 4.3 minutes. It logged React hydration-mismatch warnings on Operations, Claims settings, and Document Templates, including hidden-input styles and a form `novalidate` difference, plus transient Next.js stream-write warnings. The affected journeys passed; the mismatch source has not been isolated. Validation-error announcements, focus management in every Dialog and Sheet, and page-wide rendered-state contrast were not measured comprehensively, and not every action was repeated at all three widths. No WCAG certification is claimed.

## 12. Dependency and build review

The initial `bun audit` found three high-severity advisories affecting the locked `js-yaml@4.2.0` used by the OpenAPI schema parser. A scoped override now pins only `@hey-api/json-schema-ref-parser`'s `js-yaml` dependency to 4.3.2. The affected v4 versions and patched range are documented by [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), and [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

`bun install --frozen-lockfile` passed after the lock update. `bun audit --audit-level=low` reported no vulnerabilities across 835 packages. `bun outdated` reported only a Turbo patch update from 2.11.8 to 2.11.9 and a newer major `@types/node` 26.6.5 while the workspace uses 24.19.2 with Node 24.21.0; neither was changed during this focused review. This does not establish support status for every transitive package. The existing Fastify 5.12.7 override was preserved. Current `bun run build`, `bun run typecheck`, and `bun run test` passed after the event-dispatch and worker changes. The worker Docker image required a root `tsconfig.json` copy from the Turbo pruner stage; after that correction it built and started successfully. The remote and local image scans found critical/high findings in multiple pinned-tag images and the Bun base. Image updates, package-level triage, immutable digest pinning, and API/web image scans remain release blockers.

## 13. Automated verification

| Check                                                                                                                           | Result                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Passed, exit 0 after the latest UI and E2E changes.                                                                                                                                                                            |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Passed, exit 0; 679 files checked/formatted after the latest report wording update.                                                                                                                                            |
| `bun --no-env-file apps/web/scripts/check-i18n.ts`                                                                              | Passed, exit 0; English/German parity for 3,528 messages.                                                                                                                                                                      |
| `bun run typecheck`                                                                                                             | Root typecheck passed earlier in Goal 15 (33/33); focused web TypeScript check passed after the latest UI changes, and the production build typecheck passed.                                                                  |
| `bun run test`                                                                                                                  | Passed after the latest dialog/UI changes; 51 of 51 Turbo tasks, zero failures.                                                                                                                                                |
| `bun run build`                                                                                                                 | Passed after the latest UI changes; 32 of 32 Turbo tasks, including OpenAPI/client generation and Next.js production build.                                                                                                    |
| `bun audit --audit-level=low`                                                                                                   | Passed, exit 0; zero known advisories across 835 packages after the scoped fix.                                                                                                                                                |
| Trivy remote image scan                                                                                                         | Completed for 11 production references; findings include critical/high severity items listed in the container assessment above.                                                                                                |
| Production Compose `config --quiet` with `.env.production.example`                                                              | Passed, exit 0; no services were started.                                                                                                                                                                                      |
| `git diff --check`                                                                                                              | Passed after the final report wording update.                                                                                                                                                                                  |
| PostgreSQL/API integration                                                                                                      | `bun run test:integration` passed, 32/32 Turbo tasks (12 tests / 1,416 expectations). After adding cross-tenant invoice and employee/scope assertions, focused billing (1 / 93) and client (1 / 849) integration tests passed. |
| Authentik E2E                                                                                                                   | Latest full isolated run passed 12/12 with zero skips and exit code 0 in 4.3 minutes after the focus and combobox assertions were added. `ERR_NETWORK_CHANGED` did not recur.                                                  |
| Backup/restore and application smoke                                                                                            | Passed on a fresh isolated target; details and remaining route-level checks are in section 7.                                                                                                                                  |
| Worker interruption                                                                                                             | Generic outbox lease recovery passed; the new isolated SIGKILL/restart test passed for a recurring Operations task committed before scheduler acknowledgement. Other external side effects remain outside this drill.          |
| Query plans and browser timings                                                                                                 | Three local query plans and a nine-route, three-at-a-time browser workload completed; no sustained direct API load or concurrent Office-action test was run.                                                                   |
| Adversarial API checks                                                                                                          | Completed the requested representative client, funding, invoice, employee assignment, membership-scope, financial replay, and evidence checks on synthetic data.                                                               |
| Responsive/keyboard review                                                                                                      | Shared semantic, overflow, and touch-target checks run at review checkpoints. Office navigation and visit-details dialog focus cycles pass at all three target widths; a full cross-workflow review remains outstanding.       |

The current remaining gates are unresolved actionable image findings, full cross-workflow viewport/keyboard review, production external settings/preflight, and security-owner review of the possible process-output exposure. The full browser run, direct API baseline, authenticated restore retrieval, selected worker crash recovery, and representative financial/concurrency checks now have completed evidence. Unit/build success does not replace these release gates.

## 14. Prioritized findings and remaining work

### P0 — security release blockers

- The remote image scan reports critical findings in the shared Bun base, PostgreSQL, Authentik, and Caddy, plus high findings in every scanned production image except Redis. The locally built worker image also has 3 critical and 20 high unique vulnerability IDs; the operator image has 32 high IDs. Update affected image references to vendor-patched releases, review findings against upstream advisories and package reachability, then rescan immutable release digests. Do not publish these image references until critical findings are resolved or explicitly accepted by the responsible security owner.
- Build and scan the final API and web images. The worker and operator images have been built and scanned, but they still contain the findings listed above. Migration/runtime dependency coverage needs a release-image-specific scan.

### P1 — release-gating verification

1. Measure direct API latency distributions, throughput, and errors under moderate concurrent authorized reads and representative Office actions; broaden query plans to benefits, billing, claims/evidence, Operations, and administration.
2. Repeat the paired restore to a fresh isolated target with start/completion timing, retrieve invoice PDFs and evidence through authenticated application routes, and compare the full financial-history invariants.
3. Exercise consequential specialized handlers, recurring generation, reminders, crash retries, and graceful shutdown; verify handler-specific side-effect idempotency.
4. Extend keyboard, focus, validation-error, and responsive checks to the remaining high-frequency workflows at 390px, 768px, and 1440px.

### P2 — operational and privacy follow-up

- Define rate limits for the public edge and abuse-prone operations; verify behavior under concurrent requests.
- Set CPU/memory limits from measured pilot-host capacity and pin every production image by digest after vendor updates and rescans.
- Decide and document legal retention/deletion/export rules, including audit, signatures, retired schemas, outbox, generated documents, and backup copies.
- Configure alert notification routes, backup encryption/location, host patching/access, monitoring ownership, and response procedures.

### P3 — maintainability

- Keep the new daily-workload mode and scheduling eligibility rule covered as pilot fixtures evolve; preserve the documented no-sign-in caregiver actors and the no-auto-billing behavior.

## 15. Goal 15 final verification — 2026-10-17

### Gate status at 2026-10-17 (historical)

| Gate                                           | Status     | Evidence and limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container security                             | Fail       | Exact artifacts were scanned and package findings are recorded below. Authentik retains one critical and 20 high IDs; the local SeaweedFS candidate has 0 critical/0 high; OTel and Prometheus retain 3 high each, Grafana 11 high, and OSRM 10 high. AWS CLI high findings were remediated. SeaweedFS still needs registry publication and immutable digest pinning. No security-owner risk acceptance is recorded.                                                                                                                     |
| Secret isolation                               | Blocked    | Guard tests pass and production `.env` was not read, but a `pgrep -af` process search matched its shell wrapper and emitted environment fields into the tool trace. Review whether proxy credentials were included and rotate any confirmed exposed values through the normal process.                                                                                                                                                                                                                                                   |
| Database recovery                              | Pass       | Paired PostgreSQL restore to a fresh isolated target completed in 23.550 seconds and passed migration, forced-RLS, count, reference, and financial-history checks. A separate quiescent synthetic backup run recorded global, per-database, object-copy, and verification durations.                                                                                                                                                                                                                                                     |
| Document recovery                              | Pass       | Authorized issued-invoice PDF and evidence routes returned the expected identity and SHA-256; the evidence PDF was 3,471 bytes. Anonymous invoice access returned 307 and no PDF. Six private objects were restored and verified.                                                                                                                                                                                                                                                                                                        |
| Worker recovery                                | Pass       | Outbox lease recovery and a real SIGKILL/restart around a committed recurring Operations task both passed; after restart there was exactly one task and occurrence. Reminder, document, and external billing side effects were not all crash-injected.                                                                                                                                                                                                                                                                                   |
| Authentication                                 | Pass       | The latest full isolated Authentik suite passed 12/12 with zero skips and exit 0 in 4.3 minutes after focus and combobox assertions were added. Hydration-mismatch and transient Next.js stream-write warnings recurred; all affected journeys passed.                                                                                                                                                                                                                                                                                   |
| Financial integrity                            | Pass       | Restored financial snapshots and references matched; invoice/claim concurrency and idempotency checks passed; simultaneous task completion returned one 200 and one 409. Evidence scope checks denied anonymous/foreign access.                                                                                                                                                                                                                                                                                                          |
| API performance                                | Pass       | Ten authorized routes completed 400 measured reads at concurrency four, all HTTP 200; p50/p95/p99 and throughput are recorded below. Separate hardware/SLO evidence is absent.                                                                                                                                                                                                                                                                                                                                                           |
| Accessibility                                  | Fail       | Shared audits cover visible names, field labels, image alt attributes, overflow, and 24×24 targets. Office navigation and visit-details dialogs pass focus wrapping, Escape, and focus-return checks; visit details are checked at 390×844, 768×1024, and 1440×900. Twelve representative palette pairs in both themes exceed 4.5:1, but rendered opacity/state combinations, validation-error announcements, exhaustive dialog/Sheet behavior, and every action at every target width remain incomplete. This is not a WCAG assessment. |
| Configuration                                  | Pass       | Production Compose syntax, networks, port exposure, startup dependencies, health checks, secret mounts, Caddy headers, migrations, and worker startup/shutdown were reviewed with example/synthetic configuration. No production preflight, real TLS/domain, SMTP, or external OIDC check was run.                                                                                                                                                                                                                                       |
| Security-owner acceptance                      | Blocked    | No risk acceptance is recorded for the Authentik critical finding or the remaining high findings.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Production preflight and external integrations | Not tested | No live production identity, object storage, SMTP, domain/TLS, or operator preflight validation was run.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| RPO/RTO and production performance targets     | Not tested | Only local synthetic timings are available; production hardware/SLO targets and production RPO/RTO commitments were not measured.                                                                                                                                                                                                                                                                                                                                                                                                        |

### Repository verification

After the latest UI changes, strict Oxlint with warnings denied, `bun run format:check`, focused web TypeScript check, `bun run test` (51/51 tasks), the guarded root `bun run build` (32/32 tasks), and the full Authentik E2E suite (12/12) passed. The Goal 15 full-workspace lint, i18n parity (3,528 catalog messages), and typecheck (33/33 tasks) also passed earlier in this run. `bun run test:integration` passed all 32/32 tasks, including six API/PostgreSQL suites (1,347 assertions) and both worker integration tests (nine assertions). The production Compose files passed `config --quiet` with `.env.production.example`; the final `git diff --check` and `graphify update .` passed. No production environment file was opened for these checks.

### Recovery and production image smoke

The paired set `care-20261017T081456441Z-a77145c5` contained both PostgreSQL databases, global roles, and six private-bucket objects. Restore validation completed in 23.550 seconds to isolated targets. Authentik discovery returned HTTP 200. Source/target financial snapshots and relationship checks matched; orphan invoice lines, claim lines, payment allocations, and evidence links were zero. An authorized issued-invoice PDF returned HTTP 200 with identity and hash matching the billing metadata. An evidence-package page/preview returned HTTP 200, and an authenticated service-evidence PDF returned 3,471 bytes with matching stored hash and size. Anonymous invoice access returned HTTP 307 and no PDF. The application checks took 9.267 seconds from API start to validation. A separate quiescent synthetic backup set, `care-20261017T100238167Z-78779039`, contained both databases and eight private objects. It completed creation and verification in 379 ms: global dump 11 ms, care database dump 105 ms, Authentik database dump 176 ms, database-dump verification 10 ms, eight-object storage copy 33 ms, and recovery-set verification 12 ms. A prior six-object backup run took 0.886 seconds combined; it did not record separate segments. The current operator also verified the older six-object manifest after the optional timing fields were added. These are local synthetic timings, not production RTO/RPO commitments.

The production images were run against the restored synthetic dependencies with temporary strong database and application secrets. The API image now runs `apps/api/src/main.ts`: its prior compiled entry failed in Nest Swagger's `Reflect.getMetadata` initialization, while the source entry preserves the legacy decorator metadata at runtime. The final migration command completed, the worker remained running and exited cleanly on SIGTERM, API readiness reported database and storage ready, and the web root returned HTTP 200. A storage issue found during this check led to adding `-ip.bind=0.0.0.0` to the SeaweedFS Compose command: the image's `server` command otherwise defaults its bind address to its detected `-ip`, which was loopback in the original target container. The revised peer-network check passed. [SeaweedFS server options](https://github.com/seaweedfs/seaweedfs/blob/master/weed/command/server.go) document that `-ip.bind` defaults to `-ip`.

The synthetic E2E `.env` bucket name did not match the single bucket in the restored target, so the image smoke discovered that target bucket through the S3 API and used it. The production `S3_BUCKET` value was not read or verified. The temporary role passwords were restored and login checks passed. The restored target containers and volumes remain available. The 0.886-second backup figure is combined only; no RPO or RTO is claimed.

After rebuilding, the exact API runtime artifact `care-platform-api@sha256:7fab2f964c6287c5ccbe46f0b36b27f11b02c6afc48f8d8492e239a2ce96ada0` started against the isolated synthetic E2E PostgreSQL and SeaweedFS services. Its liveness endpoint returned HTTP 200, and readiness reported the database and storage ready; worker readiness was unavailable because this smoke did not start a Care worker. The temporary API container was stopped. The current worker artifact was rebuilt and scanned, and its source-level SIGKILL/restart integration test passed; the container startup/SIGTERM smoke above was run on the preceding worker digest.

### Direct API measurements

`apps/web/e2e/api-load.ts` used a synthetic Office-admin token, five warmups, 40 measured requests per route, concurrency four, and returned each synthetic mutation to its original value. All 400 measured reads returned HTTP 200. Times are milliseconds; throughput is requests/second.

| Route                  |   p50 |    p95 |    p99 | Throughput |
| ---------------------- | ----: | -----: | -----: | ---------: |
| Client search          | 56.65 | 179.72 | 186.87 |      53.45 |
| Employee search        | 56.30 |  62.64 |  65.89 |      64.86 |
| Scheduling day         | 54.21 |  61.42 |  61.81 |      67.32 |
| Scheduling week        | 53.74 |  61.62 |  64.76 |      67.51 |
| Benefits worklist      | 55.97 |  64.82 |  67.20 |      64.16 |
| Invoices               | 57.43 |  65.57 |  71.71 |      62.92 |
| Receivables            | 53.69 |  61.91 |  68.71 |      67.95 |
| Claims                 | 55.10 |  62.66 |  63.61 |      65.87 |
| Operations work queue  | 84.74 |  94.98 |  96.86 |      43.62 |
| Administration members | 71.89 |  82.95 |  89.84 |      51.21 |

Two simultaneous PATCH requests against separate synthetic active clients both returned HTTP 200; both restore requests also returned HTTP 200. The Operations integration test now also sends two task-completion requests with the same expected version and observes one HTTP 200 plus one HTTP 409. Other isolated integration checks cover concurrent scheduler runs (busy/succeeded, one recurring task), documentation edits (200/409), parallel invoice issuance (unique invoice numbers), and duplicate claim reservation (one success, one domain conflict). Hardware and a service-level target were not recorded, so these are local comparison measurements only.

The eight `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans covered client and employee directories, issued invoices, claims, benefit allocations, evidence packages, Operations tasks, and membership directory. The restored fixture contained 20 clients, 10 employees, two invoices, and small single-row claim/benefit/evidence/membership tables plus 15 Operations tasks. The observed one-hit scans are expected at this size; no production indexing conclusion is drawn.

### Worker and integration recovery

The latest full Authentik browser suite passed 12/12 with zero skips and exit 0 in 4.3 minutes after focus and combobox assertions were added. It emitted React hydration-mismatch warnings on Document Templates, Claims settings, and Operations screens and transient Next.js stream-write warnings during navigation; affected journeys passed, and the mismatch source remains undetermined. The full API/PostgreSQL integration suite passed 6/6 with 1,347 assertions. The latest focused worker integration run passed 2/2 tests with nine assertions, including clean SIGTERM exit, the real SIGKILL/restart case, and structured event-log fields for event identity, category, attempt, duration, and outcome. A new isolated worker integration test installed a PostgreSQL gate that paused scheduler success acknowledgement after the recurring-task transaction committed, sent SIGKILL to the worker, then restarted it. Recovery completed with exactly one recurring task and one occurrence. Fault injection after deadline projection commit and after recurring occurrence commit also produced no duplicates on retry. The earlier generic outbox interruption drill reclaimed a synthetic event at attempt two and ended with all 917 restored events delivered. Reminder projection and external document/billing side effects were not all interrupted at the process level. The catch-all event dispatcher remains logging-only; these tests do not imply exactly-once delivery for arbitrary external side effects.

### Final image scan

Trivy 0.76.0 scanned the exact local and pinned remote images listed in [goal15-container-scan.json](security/goal15-container-scan.json). The command scanned vulnerabilities only and counted unique vulnerability IDs at their highest reported severity. The database artifact was downloaded at `2026-10-17T08:46:43Z` (database `UpdatedAt` `2026-10-16T01:13:54Z`); an update check at 09:15 UTC returned the same artifact. The API runtime, worker, migration, and operator artifacts were rebuilt from the current worktree and rescanned at 10:06 UTC with that same database. The migration tag resolves to the operator target because the API Dockerfile's final stage is `operator`, matching the production Compose build with no explicit target. The structured file records full image digests, package-level findings, references, counts, and the Goal 14 baseline. Scanner findings do not establish exploitability or package reachability.

Counts below are unique vulnerability IDs per image (Critical/High/Medium/Low/Unknown). Digests are the exact scanned artifacts. Locally built images are resolved by digest here but their Compose references remain mutable tags; those must be promoted by immutable digest before deployment.

| Image                         | Production Compose tag                                                                                                      | Exact tested artifact and digest                                                                                  |    C/H/M/L/U |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -----------: |
| API                           | `care-platform-api:latest`                                                                                                  | `care-platform-api@sha256:7fab2f964c6287c5ccbe46f0b36b27f11b02c6afc48f8d8492e239a2ce96ada0` (`goal15-final`)      |    0/0/1/0/0 |
| Web                           | `care-platform-web:latest`                                                                                                  | `care-platform-web@sha256:b7ec056e8983e64a6c801f7b17cc8019c89173c1083aac5e93130cfe18b9c39e`                       |    0/0/1/0/0 |
| Worker                        | `care-platform-worker:latest`                                                                                               | `care-platform-worker@sha256:c415e8600d2ade4571fbc954c99139ab62738b6257c33e51d51e68a98d191dbd` (`goal15-final`)   |    0/0/1/0/0 |
| Migration                     | `care-platform-migrate:latest`                                                                                              | `care-platform-migrate@sha256:8e80ff6279df428996ff91fe1e96e36deb9dc94baf047d32f15b85dd0923bea7` (`goal15-final`)  |    0/0/1/0/0 |
| Operator                      | `care-platform-operator:latest`                                                                                             | `care-platform-operator@sha256:8e80ff6279df428996ff91fe1e96e36deb9dc94baf047d32f15b85dd0923bea7` (`goal15-final`) |    0/0/1/0/0 |
| PostgreSQL                    | `care-platform-postgres:18.6-go1.26.9`                                                                                      | `sha256:23ae145cc679576ecee115451b819739982d42b6e8c2545eeef5b2d04a23dbba`                                         |    0/0/3/0/1 |
| Caddy                         | `care-platform-caddy:2.11.7-go1.26.9`                                                                                       | `sha256:cc457b5c8884b4e32d79e55025e79883a478e2599b6952e30d9272486ae3d0dd`                                         |    0/0/1/0/1 |
| Authentik server/worker       | `ghcr.io/goauthentik/server:2026.8.4@sha256:e7226ae116dac5aa0a5643803e735b010038f492c401e08e16b3bf1ac54c090c`               | `sha256:e7226ae116dac5aa0a5643803e735b010038f492c401e08e16b3bf1ac54c090c`                                         | 1/20/56/57/1 |
| SeaweedFS                     | `care-platform-seaweedfs:4.48-go1.26.9-xnet0.60.0`                                                                          | local candidate `sha256:3fecd8c52e67396f3e3778a3f289831a0af3858033f64b7277a268d16e639a1b`                         |    0/0/2/0/1 |
| AWS CLI bootstrap             | `care-platform-aws-cli:2.37.4-al2023-patched`                                                                               | `sha256:421edce1eecafe09e70481dd35771b26a4595beaabca31fa7e69400d4c70281d`                                         |    0/0/0/0/0 |
| Redis                         | `redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`                                    | `sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`                                         |    0/0/1/0/0 |
| OpenTelemetry Collector       | `otel/opentelemetry-collector-contrib:0.162.0@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6`      | `sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6`                                         |    0/3/8/1/2 |
| Prometheus                    | `prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e`                           | `sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e`                                         |    0/3/8/1/2 |
| Grafana                       | `grafana/grafana:13.2.4@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f`                            | `sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f`                                         |  0/11/14/1/2 |
| OSRM                          | `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f` | `sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f`                                         | 0/10/39/35/3 |
| Mailpit (development profile) | `axllent/mailpit:v1.31.4`                                                                                                   | `sha256:b68349e3a014b90c5610bfb26b2ae36f3892d7b8cf25ee140c6c71c98d2fcf48`                                         |    0/3/9/1/2 |

The SeaweedFS production override now builds a candidate from upstream release 4.48 commit `530be3e37337488ecc34d58441e0bc476e121c93`. The build uses the digest-pinned Go 1.26.9 toolchain and raises only `golang.org/x/net` to v0.60.0, then copies the rebuilt binary into the pinned upstream runtime. The [SeaweedFS 4.48 release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.48), [Go 1.26.9 release history](https://go.dev/doc/devel/release#go1.26.9), and [GO-2026-6611 advisory](https://pkg.go.dev/vuln/GO-2026-6611) document the pinned source and upstream fixes used here. Against the same Trivy database, unique findings changed from 0/3/10/1/2 to 0/0/2/0/1 (Critical/High/Medium/Low/Unknown). The exact local artifact digest and package findings are in the structured scan record. A synthetic S3 health, bucket-create, upload, download, and byte-for-byte comparison passed using temporary storage in an isolated network namespace. No registry publication was performed; the Compose tag is local and `digestPinnedInCompose` remains false. Publish this artifact through the approved registry, scan the registry artifact, and pin its resulting immutable digest before deployment.

The Authentik critical finding is `CVE-2026-6653` in Debian Trixie's `libxml2` `2.12.7+dfsg+really2.9.14-2.1+deb13u3`; the scanner reported no fixed version. Debian's tracker marks that Trixie package vulnerable, while listing a fixed version for forky/sid. Authentik currently lists 2026.8.x as a supported release line; that support status does not clear the operating-system package finding. [Debian CVE tracker](https://security-tracker.debian.org/tracker/CVE-2026-6653), [Authentik supported versions](https://github.com/goauthentik/authentik/security).

The custom Bun-base application images, PostgreSQL image, Caddy image, and local SeaweedFS candidate have no critical or high findings. The SeaweedFS scan still reports two medium Alpine packages and one unknown Go `x/crypto/openpgp` advisory; Trivy does not assess whether that package path is reachable. The custom PostgreSQL, Caddy, and SeaweedFS builds use Go 1.26.9; the official Go release history records security updates in that release. [Go release history](https://go.dev/doc/devel/release). AWS CLI 2.37.4 dropped from 16 high/11 medium IDs to zero after upgrading AL2023 packages to release 2023.12.20261013. Grafana 13.2.4 reduced medium findings from 15 to 14 and low from two to one; its 11 high IDs remain. The AWS CLI scanner metadata retains the base OS release label, while the derived image's RPM/system-release packages were verified at 20261013. Trivy records OS and application/runtime package origin, installed/fixed versions, source, references, and layer digest in the structured report; it does not assess reachability.

The Authentik critical finding is `CVE-2026-6653` in Debian Trixie's `libxml2` `2.12.7+dfsg+really2.9.14-2.1+deb13u3`; no fixed version was reported. The image also has 20 high IDs spanning OS and application/runtime packages. The original SeaweedFS artifact had three unique high IDs across four package findings; they are absent from the rebuilt candidate. OTel and Prometheus retain high Go runtime findings; Grafana has high findings across Go runtime and bundled application packages; OSRM has high OS packages. Those exact advisories are in the package-level scan record. Private-network placement does not clear these findings. The Authentik critical and high findings plus remaining production-profile high findings are release blockers pending patched images or explicit security-owner decisions. Optional observability, OSRM, and development-only Mailpit findings still require owner triage before enabling those profiles.

| Unresolved image                                                       | Exposure and mitigation                                                                                                                                                                                                                                                                                                                            | Accountable owner and next action                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentik server and worker                                            | Server is routed through Caddy; worker is private. Trixie's bundled `libxml2` critical finding has no fixed version in the current Debian tracker, and practical parser reachability was not assessed. Hold deployment until a supported fixed image is available or a security owner accepts the risk; network placement does not clear the scan. | Platform identity image maintainer; security owner must make and record any risk decision. Named individuals are not assigned in this assessment.                                                                                                                                                                                                                                                                                                    |
| OpenTelemetry Collector, Prometheus, Grafana (`observability` profile) | High runtime/application findings remain. The OpenTelemetry `v0.163.0` source release had been published during the Oct 17 review, but its `0.163.0` image tag did not resolve in Docker Hub or the GHCR mirror, so there was no newer exact artifact to scan. Keep the profile disabled until patched images are available and rescanned.         | Platform observability maintainer; recheck upstream image publication, update by digest, then rescan. Named individuals are not assigned. [OpenTelemetry v0.163.0 release](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.163.0), [Prometheus 3.15.0 release](https://github.com/prometheus/prometheus/releases/tag/v3.15.0), [Grafana 13.2.4 release](https://github.com/grafana/grafana/releases/tag/v13.2.4). |
| OSRM (`routing` profile)                                               | Ten high IDs remain in the Debian 13 image packages; most had no fixed version reported. The optional service has no production host-published port, but this is not a vulnerability waiver. Keep the profile disabled pending a supported patched base/image and rescan.                                                                          | Routing/platform image maintainer; track Debian fixes or a newer upstream image. Named individuals are not assigned. [OSRM 26.10.0 release](https://github.com/Project-OSRM/osrm-backend/releases/tag/v26.10.0).                                                                                                                                                                                                                                     |
| Mailpit (`development` profile)                                        | Three high IDs remain in a development-only image, and the production override confines it to the development profile. Do not enable that profile in production.                                                                                                                                                                                   | Development tooling maintainer; revisit before enabling Mailpit in a deployed environment. Named individuals are not assigned.                                                                                                                                                                                                                                                                                                                       |

One broad search accidentally matched `.env.production` once and emitted only its configured OIDC issuer URL; no credential values were exposed. Bun's audit command also logged `.env.production` and `.env` by filename without printing contents or values. During this assessment, a `pgrep -af` process search matched its shell wrapper and emitted shell-snapshot command text containing environment fields in the tool trace. It was not a read of `.env.production`, and no values from that output are reproduced here; the output may have included credential-bearing proxy configuration. Review and rotate any confirmed credential-bearing values through the normal process. No automatic rotation was performed. Follow-up process checks used command names only. No manual production environment-file read was made during the final Goal 15 checks. Production Compose syntax checks used `.env.production.example` and did not start services.

## Release decision

No production deployment, infrastructure purchase, or real-client-data setup was performed. The synthetic application, browser, restore, load, worker, and repository gates now have the evidence recorded in section 15. The application remains **uncleared for first deployment** because the current scan has one critical and multiple high findings without owner acceptance; the SeaweedFS candidate also needs registry publication and immutable digest pinning. Production external configuration, preflight, complete accessibility review, and review of the process-output exposure remain open.

## Recommended next implementation goal

Resolve or obtain explicit security-owner acceptance for the Authentik critical and remaining high findings, publish the patched SeaweedFS candidate and pin its registry digest, then rescan the exact immutable release images. Validate production identity, storage, SMTP, TLS/domain, and preflight settings through the approved production process. Extend rendered-state contrast and dialog/Sheet focus reviews across the remaining workflows before making a first-deployment decision.

## 16. Goal 15A container security update — 2026-10-18

### Current container gate

**Fail; the platform remains uncleared for production.** Goal 15A rebuilt and scanned every production application image and custom runtime artifact, pinned newer OpenTelemetry Collector and Mailpit releases, verified the official SeaweedFS 4.48 registry digest, and passed an isolated synthetic runtime smoke. The patched SeaweedFS candidate still needs publication to the approved registry and a digest pin for that published artifact. At the initial scan, Authentik had one critical and 20 high IDs; Prometheus, Grafana, and OSRM had 3, 12, and 10 high IDs. Section 19 records the later Prometheus and OSRM rebuilds and supersedes those counts. No security-owner risk acceptance is recorded.

This addendum supplies the initial Goal 15A scan evidence and supersedes the Goal 15 image versions and counts below for images rescanned on 2026-10-18. Section 19 supersedes its Prometheus and OSRM findings with later exact-artifact scans. It preserves the historical Goal 14/15 results above. Other readiness gates keep their independently verified status.

### Inventory and exact scan results

Trivy 0.76.0 ran vulnerability-only scans against linux/amd64 artifacts. Its database was updated at `2026-10-18T07:12:07Z` and downloaded at `2026-10-18T11:29:07Z`. Counts are unique vulnerability IDs, with the highest severity per ID; order is Critical/High/Medium/Low/Unknown. The scan record contains full package findings, report hashes, image metadata, and exact references in [goal15a-container-scan.json](security/goal15a-container-scan.json). Raw Trivy JSON remains in the temporary cache path recorded there.

| Service                            | Exact scanned reference or local artifact                                                                                                                  |    C/H/M/L/U |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: |
| API                                | local build `care-goal15a-build-api:latest`, artifact `sha256:c128b4ceaba06f5275250b87dae60b866ec202cd85d10c910b1ca82ce131943`                             |    0/0/1/0/0 |
| Web                                | local build `care-goal15a-build-web:latest`, artifact `sha256:aeec84bbdaab3ad4246492ecea91b62d2c4fd47e1b75646133a9445fb82a6858`                            |    0/0/1/0/0 |
| Worker                             | local build `care-goal15a-build-worker:latest`, artifact `sha256:ecbbc6910b4e7f1442ee7bf5cda9add3a1c2ef66ac5935aca7b599adc7fc1755`                         |    0/0/1/0/0 |
| Migration                          | local build `care-goal15a-build-migrate:latest`, artifact `sha256:c153a56bc6209f1367193ae9d0c0deba079c708b1ffba867c996cde9c327bf8e`                        |    0/0/1/0/0 |
| Operator                           | local build `care-goal15a-build-operator:latest`, artifact `sha256:d982b7ee674d7e2b53866e33f4b47d74463379db5b32438918db69e3799d926d`                       |    0/0/1/0/0 |
| PostgreSQL                         | local build `care-platform-postgres:18.6-go1.26.9`, artifact `sha256:c4484c2bbb7e6c8593d69ae18926f3ae7111605b8311df6855e8987564f5afdc`                     |    0/0/3/0/1 |
| SeaweedFS                          | local patched build `care-platform-seaweedfs:4.48-go1.26.9-xnet0.60.0`, artifact `sha256:a374e36140a81524c3bc7ec00e9b03aca79c4883f8d0a9c673d62bac6ca309df` |    0/0/2/0/1 |
| AWS CLI bucket initializer         | local build `care-platform-aws-cli:2.37.4-al2023-patched`, artifact `sha256:62e1021512afaf5e73eb67beef0269215ef406c466bb3710fe067d5513e28be7`              |    0/0/0/0/0 |
| Caddy                              | local build `care-platform-caddy:2.11.7-go1.26.9`, artifact `sha256:3f7fd8a878e0880f26bfbf8c5ceb417865c86453e6c99b2485aa1e96501dc7ae`                      |    0/0/1/0/1 |
| Authentik server and worker        | `ghcr.io/goauthentik/server:2026.8.4@sha256:e7226ae116dac5aa0a5643803e735b010038f492c401e08e16b3bf1ac54c090c`                                              | 1/20/56/57/1 |
| Redis                              | `redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`                                                                   |    0/0/1/0/0 |
| OpenTelemetry Collector            | `otel/opentelemetry-collector-contrib:0.163.1@sha256:1175b03003053962012f5a231f5567f66a3e8fdb960c7835c0e48f7aa1555806`                                     |    0/0/0/0/1 |
| Prometheus (observability profile) | `prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e`                                                          |    0/3/9/1/1 |
| Grafana (observability profile)    | `grafana/grafana:13.2.4@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f`                                                           |  0/12/15/1/1 |
| OSRM (routing profile)             | `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f`                                | 0/10/39/35/3 |
| Mailpit (development profile)      | `axllent/mailpit:v1.31.6@sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387`                                                          |    0/0/0/0/1 |

The local artifact digests identify the exact images scanned on this Docker engine. They are not registry-published digests. Production Compose still builds API, web, worker, migration, operator, PostgreSQL, Caddy, AWS CLI, and the patched SeaweedFS image locally; those artifacts need approved registry publication and remote digest scans before a reproducible release reference exists.

Registry index digests were checked with `docker buildx imagetools inspect`; Trivy scanned the exact `tag@sha256` references using `--platform linux/amd64`. SeaweedFS release 4.48 resolves to registry index `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`; its linux/amd64 manifest is `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. The supported official image exists, but its scan retains three high Go advisories. The production Dockerfile rebuilds the official release source commit `530be3e37337488ecc34d58441e0bc476e121c93` with Go 1.26.9 and `golang.org/x/net` 0.60.0; the local patched artifact scan has zero critical/high findings. Its final local digest is not a registry manifest digest, so `seaweedfs` remains blocked on approved publication and a rescan of the published digest. The production service now fixes the intended platform to `linux/amd64`; startup flags and storage configuration were retained.

### Remediation and remaining critical/high findings

- API, web, worker, migration, and operator final images use multi-stage Bun builds and the digest-pinned Bun 1.4.3 Alpine runtime. Each scan has zero critical/high findings and one medium Alpine zlib advisory (`zlib` 1.3.2-r0; Trivy reports 1.3.2-r1 as fixed). PostgreSQL, Caddy, and SeaweedFS final images also have zero critical/high findings. PostgreSQL’s upstream base had one critical and 24 high Go findings in bundled gosu built with Go 1.24.6; the final Dockerfile replaces gosu with a Go 1.26.9 build. Caddy’s upstream base had three high Go/x/net findings; the final Dockerfile rebuilds Caddy 2.11.7 with Go 1.26.9 and x/net 0.60.0. AWS CLI’s AL2023 update remains clean at critical/high.
- Updating OTel 0.162.0 to 0.163.1 removed its three high Go standard-library/x/net IDs. Updating Mailpit 1.31.4 to 1.31.6 removed its three high Go standard-library/x/net IDs. Both exact new images report the `UNKNOWN` advisory `GO-2026-5932` in `golang.org/x/crypto` v0.58.0; Trivy reports no fixed version. Mailpit remains disabled by the production override.
- Authentik 2026.8.4 remains the latest verified supported release available in this assessment. Its critical `CVE-2026-6653` affects Debian Trixie `libxml2` 2.12.7+dfsg+really2.9.14-2.1+deb13u3; Trivy reports no fixed version. Debian’s tracker does not list a Trixie fix. The 20 high IDs include Debian util-linux, libxml2, ncurses, libacl, systemd, perl, and OpenSSL packages, plus Python msgpack, setuptools, and urllib3 dependencies. Trivy reports some fixed package versions (OpenSSL 3.5.7-1~deb13u3, msgpack 1.2.1, setuptools 78.1.1, urllib3 2.8.0), but no newer supported Authentik image was available to consume them. Hold deployment pending a supported image or an explicit security-owner decision. See [Debian’s CVE-2026-6653 tracker](https://security-tracker.debian.org/tracker/CVE-2026-6653).
- Prometheus 3.15.0 retains three high Go stdlib/x/net IDs (`CVE-2026-78667`, `CVE-2026-78669`, `CVE-2026-97031`); its scan records Go stdlib v1.27.1 and x/net v0.58.0. Grafana 13.2.4 retains 12 high IDs in kin-openapi, Tempo, Go stdlib/x/net, and grpc. OSRM 26.10.0 retains ten high Debian 13 package IDs covering util-linux, ncurses, libacl, systemd, perl, OpenSSL, and libpcre2. Exact package versions, fixed-version data, and advisory links are in the structured scan report. Keep these profiles disabled until supported updates are scanned or the security owner explicitly accepts the risk.
- The 2026-10-18 scans found no fixed newer supported upstream releases for Authentik, Prometheus, Grafana, or OSRM. Internal network placement does not waive the findings. No scanner ignores or exclusions were added.

### Build, runtime, and environment validation

The production Dockerfiles built successfully for API, web, worker, migration, operator, PostgreSQL, SeaweedFS, Caddy, and the AWS CLI initializer with `.env.production.example` explicitly selected. The Docker engine ran linux/amd64. The local image scans above inspected each resulting final artifact; the report stores each image identity and Trivy JSON SHA-256. No production deployment was started.

The dedicated `care-goal15a-runtime` Compose project used generated synthetic environment and secret files, project-scoped disposable volumes, alternate Caddy ports, and the exact just-scanned local images. PostgreSQL, Redis, Authentik server/worker, SeaweedFS, API, web, worker, and Caddy all reached healthy status. The migration and SeaweedFS bucket-init jobs completed successfully. API readiness reported database, object storage, and worker dependencies ready. Caddy configuration validation passed; HTTPS requests through the test Caddy routes returned HTTP 200 for API live/ready, web root, and Authentik health. A synthetic S3 put/get roundtrip passed a SHA-256 comparison. The existing `care-goal15-e2e-rerun` project was left running and untouched. At the final status snapshot its Authentik server and worker showed 41 restarts each, exit code 0, and no OOM kill; this separate project needs its own runtime inspection before reuse. The synthetic project and volumes were removed after validation.

The first disposable startup revealed that `pg_isready` can report healthy against PostgreSQL’s temporary initialization server before its init scripts finish. The migration then raced the server restart. The Compose healthcheck now queries for the `care_app` and `care_worker` roles and the `authentik` database created by the init script. The clean retry held PostgreSQL unhealthy until initialization completed, then migrations succeeded. This verifies the PostgreSQL initialization dependencies in the synthetic stack.

Focused API and worker integration tests passed: six API/PostgreSQL suites (1,347 assertions), including invoice PDF generation, PDF retrieval/hash verification, and document authorization; and both worker integration suites (nine assertions), including outbox dispatch and recurring-task recovery after interruption. API billing/document integration tests use synthetic PostgreSQL and an in-memory object store; the runtime S3 roundtrip independently verified the SeaweedFS data path. Goal 15’s full Authentik browser E2E remains recorded as 12/12 with zero skips. It was not rerun in Goal 15A; the Authentik digest and application source were unchanged. Goal 15A did verify Authentik health through Caddy.

Production Compose validation used `docker compose --env-file .env.production.example -f compose.yaml -f compose.production.yaml config --quiet`. The image builds used the same explicit safe example file; runtime used generated synthetic credentials. Scanner commands used no secrets. `.dockerignore` excludes `.env` and `.env.*`, and `bunfig.toml` disables Bun’s automatic env-file loading. No `.env.production` was opened or loaded for Goal 15A, and no production secret or volume was used. Generated scan reports contain image/package metadata and no secret values.

### Reproduction commands

```bash
docker compose --env-file .env.production.example \
  -f compose.yaml -f compose.production.yaml config --quiet

docker compose -p care-goal15a-build --env-file .env.production.example \
  -f compose.yaml -f compose.production.yaml \
  build postgres seaweedfs api web worker caddy migrate operator seaweedfs-init

trivy --cache-dir <cache> image --image-src docker --skip-db-update \
  --skip-java-db-update --scanners vuln \
  --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json \
  --output <report.json> <exact-local-image-reference>

trivy --cache-dir <cache> image --image-src remote --platform linux/amd64 \
  --skip-db-update --skip-java-db-update --scanners vuln \
  --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json \
  --output <report.json> <registry-image:version@sha256:digest>
```

For future image updates, select a supported upstream release, inspect and record its registry manifest digest, scan that exact digest on the intended platform, update Compose, build custom images with digest-pinned bases, and rescan the final artifacts. Publish custom images only through the approved registry; then resolve and scan the registry digest before updating production references. Digest pinning provides reproducibility and does not fix vulnerabilities by itself.

### Quality checks

| Check                                                               | Result                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`                                                      | Pass — 33/33 workspace tasks.                                                                                                                                       |
| `bun run format:check`                                              | Pass — all 680 matched files formatted after formatting the two Goal 15A artifacts.                                                                                 |
| `bun run i18n:check`                                                | Pass — catalog parity across 3,528 messages.                                                                                                                        |
| `bun run typecheck`                                                 | Pass — 33/33 workspace tasks.                                                                                                                                       |
| `bun run test`                                                      | Pass — 51/51 workspace tasks; Turbo reused the current content-addressed cache.                                                                                     |
| `bun run build`                                                     | Pass — OpenAPI generation and 32/32 build tasks; Turbo reused the current content-addressed cache.                                                                  |
| `bun run test:integration --filter=@care/api --filter=@care/worker` | Pass — 6 API integration suites/1,347 assertions and 2 worker integration suites/9 assertions.                                                                      |
| `bunx oxlint --deny-warnings --format=agent`                        | Pass.                                                                                                                                                               |
| Production Compose config with `.env.production.example`            | Pass.                                                                                                                                                               |
| `git diff --check`                                                  | Pass.                                                                                                                                                               |
| `graphify update .`                                                 | Pass — graph refreshed after Compose changes.                                                                                                                       |
| Production image builds and Trivy scans                             | Pass — exact local artifacts and configured registry images are recorded above and in the scan JSON.                                                                |
| Full Authentik E2E                                                  | Not rerun in Goal 15A — Goal 15’s 12/12 result remains historical; the separate pre-existing E2E Authentik containers were restarting at the final status snapshot. |

### Goal 15A release gates

| Gate                                  | Status   | Current evidence and limit                                                                                                                                                                                 |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production image inventory            | Pass     | Required services, optional profiles, base image lineage, exact scan artifacts, and references are recorded in the structured report.                                                                      |
| Application and custom image builds   | Pass     | All nine production Dockerfile targets built successfully with explicit safe config.                                                                                                                       |
| Exact image vulnerability scans       | Pass     | All configured image references and the exact local final build artifacts were scanned with Trivy 0.76.0 and the 2026-10-18 database.                                                                      |
| SeaweedFS release digest verification | Pass     | Official 4.48 index and linux/amd64 manifest were verified directly against the registry and scanned.                                                                                                      |
| Patched SeaweedFS production digest   | Blocked  | Patched local candidate has 0/0 C/H and passed S3 smoke, but no approved registry publication or remote candidate digest exists.                                                                           |
| Production image immutability         | Blocked  | Upstream references are digest-pinned. Locally built production images have no registry-published immutable references yet.                                                                                |
| Actionable critical/high findings     | Fail     | Authentik has 1 critical/20 high; Prometheus 3 high, Grafana 12 high, OSRM 10 high. No risk acceptance is recorded.                                                                                        |
| Synthetic runtime compatibility       | Pass     | Isolated stack, healthchecks, migrations, API/web/worker/Auth, Caddy routes, and S3 object operations passed. Invoice PDF application tests passed separately with synthetic database fixtures.            |
| Production environment isolation      | Pass     | Explicit synthetic/example env files were used; no production secrets or volumes were used.                                                                                                                |
| Overall production release            | **Fail** | Container and other independently open release gates still prevent clearance. This assessment does not change accessibility, recovery, performance, external configuration, or organizational gate status. |

### Current next actions

1. Hold deployment until Authentik critical/high findings have supported upstream fixes or the security owner records a risk decision.
2. Keep observability and routing profiles disabled until their high findings are fixed in supported images or explicitly dispositioned.
3. Publish the patched SeaweedFS candidate through the approved registry, verify and pin its linux/amd64 digest, rescan that exact registry artifact, and retain the synthetic S3 compatibility evidence.
4. Publish and pin the locally built application and custom infrastructure images before treating their local scan identities as release references.

## 17. Goal 15 continuation — full Authentik regression — 2026-10-18

The retained `care-goal15-e2e-rerun` project was inspected before use. Its Postgres, Redis, and Mailpit containers had exited, while Authentik was restarting because its dependencies were stopped. The isolated project was restarted with the dedicated synthetic `.env.test`; Compose health checks passed for PostgreSQL, Redis, SeaweedFS, Mailpit, Authentik server, and Authentik worker. Migrations and the synthetic seed completed successfully. No production environment file or production volume was used.

The first fresh Playwright invocation could not launch Chromium because the browser binary was absent from the default cache. The matching Playwright Chromium build was installed under `/home/woobb/.cache/codex-tmp/care-goal15-playwright` and the suite was rerun. All 12 Authentik E2E tests passed with zero skips and exit code 0 in 4.5 minutes. Coverage included tenant identity and membership, administration and facility scopes, admissions, employees, service catalog and agreements, scheduling, caregiver execution and evidence, benefits, billing, claims, documents and communications, and Operations.

This rerun exposed a race in the identity/access test after concurrent scope replacement: the UI can render either zero facility selections or both submitted selections. The test had attempted to clear a selection before the streamed page state settled. It now waits for the database-confirmed zero-or-two facility state, clears only when selections exist, and asserts the Facility West selection before saving. The focused identity/access test passed 1/1, followed by the full 12/12 run. This was a test synchronization fix; authorization behavior and scope persistence rules were unchanged.

During the same E2E run, the test's supplemental browser read replay completed nine tenant-scoped/foreign-organization page requests across three concurrent pages in three batches. The p50 page load was 819 ms, p95 was 1,128 ms, and the full batched replay took 2.72 seconds. The foreign-organization route returned no client list. These are local synthetic browser timings and do not replace the direct API measurements or establish production SLOs.

React hydration-mismatch output and a transient Next.js destination-stream error recurred; all affected journeys passed. Their underlying cause remains unisolated. The Authentication gate is now current Pass (12/12); the separate Accessibility gate remains Fail, container security remains Fail, security-owner acceptance remains Blocked, and the overall production release remains Fail.

Reproduction used:

```bash
docker compose --env-file .env.test -p care-goal15-e2e-rerun \
  -f compose.yaml -f compose.e2e.yaml --profile development up -d --wait
bun --env-file=.env.test run migrate
bun --env-file=.env.test run seed
PLAYWRIGHT_BROWSERS_PATH=/home/woobb/.cache/codex-tmp/care-goal15-playwright \
  bun --env-file=.env.test run --filter @care/web test:e2e
```

## 18. Goal 15 continuation — worker crash recovery — 2026-10-18

The worker outbox audit found one `subscribeAll` handler, which records event type in a log and performs no domain mutation. This includes document and billing event types: there are no current worker consumers that create documents, PDFs, invoices, claims, or other financial records. The worker's consequential writes are its Operations schedulers. Recurring tasks already had a real process-crash test; this continuation adds equivalent coverage for deadline evaluation, which creates agreement follow-up tasks and deadline occurrence projections. Reminder policies create Operations work items; they do not send email, SMS, or push notifications.

The new worker integration test uses a disposable PostgreSQL database and synthetic tenant, organization, facility, client, agreement, and reminder policy. A test-only database trigger pauses the worker after its task and active `agreement_expiry` occurrence have committed but before the scheduler run is acknowledged. The worker is killed with `SIGKILL`; after expiring the scheduler lease, a new worker process succeeds. Both before and after recovery, exactly one agreement follow-up task and one active deadline occurrence exist. No production configuration, credentials, or volumes are used.

The worker integration command completed with **3 passed, 0 failed, 13 assertions**: outbox dispatch-before-delivery, recurring task recovery after a crash, and deadline reminder task recovery after a crash. The earlier API deadline retry test also continues to cover exception injection after the task transaction commits, with one generated task and one occurrence after retry. API billing/document integration tests separately cover synthetic invoice PDF generation, authorized retrieval, and byte/hash verification; no worker document or financial event side effect exists to duplicate on worker restart.

Reproduction:

```bash
bun --env-file=.env.test run --filter @care/worker test:integration
```

This adds worker restart/idempotency evidence only. Container vulnerability findings and the security-owner disposition gate remain Fail/Blocked. Accessibility remains Fail; overall production release remains **Fail**. The prior section 16 worker count is historical and is superseded by this current 3-suite result.

## 19. Goal 15A container scan follow-up — 2026-10-18

### Current container security status

**Fail; the platform remains blocked from production.** This follow-up rebuilt the Prometheus runtime from its pinned 3.15.0 source commit with patched Go and `x/net`, and rebuilt OSRM 26.10.0 with Debian’s fixed PCRE2 and OpenSSL packages. Both final local artifacts were scanned with the same Trivy 0.76.0 binary and vulnerability database as section 16. Prometheus now has zero critical/high findings; OSRM fell from ten to eight high IDs. Authentik still has one critical and 20 high IDs, Grafana still has 12 high IDs, and there is no security-owner acceptance for those findings. The custom images are local build artifacts, not registry-published immutable references.

The scanner database was updated at `2026-10-18T07:12:07.771859408Z`. The final Prometheus report SHA-256 is `b8194b4d002ac579474f183d6e2c7ff11d7858682f2eb3c025a30a3e0af98c6b`; the final OSRM report SHA-256 is `9ccff12fd3fcf340e704ffdc47020bd7da0bef13983d3976821d8641e438627d`. Report paths and exact image identities are recorded under `followUpBuildScans` in [goal15a-container-scan.json](security/goal15a-container-scan.json). Trivy scanned the final linux/amd64 runtime image filesystems, not only their base images. Local build digests identify the exact artifacts on this Docker engine; they are not registry manifest digests.

| Image             | Before                                                                                                                                                 | After exact artifact                                                                                                                                            | Change                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Prometheus 3.15.0 | Official `prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e`; **0/3/9/1/1** C/H/M/L/U                    | `care-platform-prometheus:v3.15.0-go1.26.9-xnet0.60.0`, local artifact `sha256:fd24214cf8d6927b89b218423c48f10feecb2ae4d422280006ca56965ecfc89c`; **0/0/0/0/1** | Fixed all three high IDs; one `UNKNOWN` Go advisory remains.     |
| OSRM 26.10.0      | Official `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f`; **0/10/39/35/3** | `care-platform-osrm:v26.10.0-debian-security`, local artifact `sha256:f4717f8bdf849d9dda43590474ee2ccd04a14a6d938db7a48dca35d065b482d3`; **0/8/29/33/3**        | Fixed two high IDs; eight high IDs with no fixed version remain. |

### Remediation details

- **Prometheus:** the baseline binary used Go stdlib `v1.27.1` and `golang.org/x/net v0.58.0`, triggering `CVE-2026-78667`, `CVE-2026-78669`, and `CVE-2026-97031`. `infra/prometheus/Dockerfile` builds the verified upstream commit `5241a27fe3c6983549fccc32f6e65917408c63cd` using the digest-pinned `golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade`, upgrades `golang.org/x/net` to `v0.60.0`, and uses the official 3.15.0 web UI asset tarball after checking SHA-256 `fa8c918ed05e3f89e232e9b69eccd6ed074602cd9e8a2cab7a92bec9651974ae`. The final stage inherits the pinned official Prometheus 3.15.0 busybox image and replaces only `prometheus` and `promtool`; builder packages are absent from the runtime filesystem. The exact final scan removed all three high IDs. The remaining `UNKNOWN` finding is `GO-2026-5932` in `golang.org/x/crypto v0.57.0`; Trivy reports no fixed version. A candidate `v3.15.1` registry tag did not resolve during this check.
- **OSRM:** the baseline Debian 13 image carried PCRE2 `10.46-1~deb13u2` and OpenSSL `3.5.7-1~deb13u2`. The custom image installs `libpcre2-8-0=10.46-1~deb13u3` and `libssl3t64` plus `openssl-provider-legacy` at `3.5.7-1~deb13u3`, removing `CVE-2026-103111` and `CVE-2026-84782`. The remaining high IDs are `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, and `CVE-2026-78410` in util-linux packages; `CVE-2026-54369` in libacl; `CVE-2026-16742` in systemd/udev libraries; `CVE-2025-69720` in ncurses/tinfo; and `CVE-2026-9538` in perl-base. Trivy reports no fixed versions for those installed package versions. They remain in the final OSRM runtime image; private routing-network placement is not a waiver.
- **Unchanged blockers:** the Authentik image still contains `CVE-2026-6653` in Debian `libxml2` with no reported Trixie fix. Its other high IDs span Debian util-linux, libxml2, ncurses, libacl, systemd, perl, and Python dependencies. Trivy reports fixed versions for OpenSSL, setuptools, urllib3, and msgpack, but the installed Authentik image holds `libssl-dev`, `libssl3t64`, and `openssl`; forcing apt past those holds would bypass upstream package policy. No Authentik derivative was retained. Candidate `2026.8.5` and `2026.8.4-nonroot` tags did not resolve. Grafana 13.2.4 still has 12 high IDs in kin-openapi, Tempo, Go stdlib, `x/net`, and gRPC; fixed versions exist in the scan metadata, but a patched image tag was not available (`13.2.5` did not resolve). I also scanned the official Ubuntu variant `grafana/grafana:13.2.4-ubuntu@sha256:d838696907b4350d9232eb8da1503dc1d1010a0359d3ce4b3f7d2ff7db28eb75` on linux/amd64. It retained the same 12 high IDs (0/12/34/12/1 C/H/M/L/U), confirming the alternate OS layer does not resolve the application/runtime findings. The OSRM `v26.10.0-alpine` tag did not resolve. No findings were ignored or suppressed.

### Digest and runtime verification

- SeaweedFS 4.48 remains verified as an official registry release: index digest `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`; linux/amd64 manifest `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. The patched Go/x/net SeaweedFS build is still local and has no registry digest. Production Compose cannot yet point at a published patched artifact.
- Prometheus and OSRM production overrides explicitly select linux/amd64. Their source/upstream bases and OSRM release digest are pinned, but the custom runtime outputs have only local artifact digests. Publishing them through the approved registry, resolving registry manifest digests, rescanning those exact digests, and updating production references remain required.
- The Prometheus container started as `nobody`; its readiness endpoint returned HTTP 200 with `Prometheus Server is Ready.` The smoke used an explicitly generated local scrape config, localhost-only port forwarding, and disposable container storage.
- The patched OSRM image reported `v26.10.0` for `osrm-routed` and `osrm-extract`. Its existing production startup and health-check scripts ran against the read-only local OSRM fixture: the health check passed and the configured route probe returned HTTP 200 with OSRM code `Ok`. The test container used a temporary localhost port and was removed afterward; no production volume was mounted.
- `docker compose --env-file .env.production.example -f compose.yaml -f compose.production.yaml config --quiet` passed after both overrides. The Prometheus and OSRM builds used that explicit example env file. No `.env.production`, production secret, or production volume was loaded or mounted.

### Reproduction commands

```bash
DOCKER_CONFIG=/home/woobb/.cache/codex-tmp/care-goal15a-docker-config \
  docker compose --env-file .env.production.example \
  -p care-goal15a-patched -f compose.yaml -f compose.production.yaml \
  build prometheus osrm

/home/woobb/.cache/codex-tmp/care-goal15a-trivy/bin/trivy \
  --cache-dir /home/woobb/.cache/codex-tmp/care-goal15a-trivy/cache \
  image --image-src docker --skip-db-update --skip-java-db-update \
  --scanners vuln --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json \
  --output <report.json> <exact-local-image-reference>

docker compose --env-file .env.production.example \
  -f compose.yaml -f compose.production.yaml config --quiet
```

### Required security-owner decisions and release gates

| Finding or gate                                                   | Status   | Observed exposure and required action                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentik `CVE-2026-6653` and 20 high IDs                         | Blocked  | Caddy exposes the Authentik host over public HTTPS; the XML denial-of-service advisory could affect user-facing XML/SAML handling, though Trivy does not assess reachability. Wait for a supported upstream package/image fix or obtain explicit security-owner acceptance for the exact findings and mitigations.                           |
| Grafana 12 high IDs                                               | Blocked  | The observability profile binds Grafana to `127.0.0.1:3002` on the host and the private Compose network, with no Caddy route. Its application and bundled plugin/runtime packages remain present; local or private-network access is still relevant. A supported fixed image and rescan, or explicit security-owner acceptance, is required. |
| OSRM eight high Debian package IDs                                | Blocked  | The routing profile publishes no host port and uses `care-private`; the API can reach its route endpoint. The findings are OS packages and utilities; actual code reachability is not assessed. Keep routing disabled until fixed packages or explicit security-owner acceptance. Network placement does not waive findings.                 |
| Custom SeaweedFS, OSRM, Prometheus and other locally built images | Blocked  | Publish only through the approved registry, verify immutable linux/amd64 registry digests, rescan the pushed artifacts, and configure those exact digests.                                                                                                                                                                                   |
| Production release                                                | **Fail** | Container risk, custom-image publication, and independently open accessibility, recovery, performance, external-configuration, and organizational gates still prevent clearance.                                                                                                                                                             |

### Quality checks in this follow-up

`bun run lint` passed all 33 workspace tasks; `bun run format:check` passed for 680 files; `bun run i18n:check` passed with 3,528 messages; `bun run typecheck` passed all 33 tasks; `bun run test` passed all 51 tasks; and `bun run build` passed 32 tasks, including OpenAPI generation and the Next.js build. Turbo reused its content-addressed cache for several tasks. `bunx oxlint --deny-warnings --format=agent`, `git diff --check`, and production Compose validation with the explicit example env file passed. `graphify update .` completed after Compose changes. The focused API/worker integration evidence and the 12/12 Authentik E2E result are recorded in sections 16–18; those suites were not rerun for this follow-up because only Prometheus and OSRM images/configuration changed.

The original image inventory, historical scans, and Goal 14/15 evidence remain preserved in sections 1–18 and the structured scan record. This follow-up changes only Prometheus and OSRM vulnerability results and does not mark other release gates as passed.

## 20. Goal 15A exact-artifact rescan and authentication recheck — 2026-10-18

### Complete image rescan

At `2026-10-18T12:43:40Z`, Trivy 0.76.0 rescanned all 16 structured inventory entries and both patched Prometheus/OSRM runtime artifacts. All 18 scans completed against linux/amd64 images with exit code 0. The vulnerability database was unchanged from its `2026-10-18T07:12:07.771859408Z` update (`DownloadedAt` `2026-10-18T11:29:07.494039118Z`). The full reference, artifact identity, count, report path, and report SHA-256 for each scan are recorded in `latestFullRescan` in [goal15a-container-scan.json](security/goal15a-container-scan.json). Local Docker image IDs identify scanned local artifacts; they are not registry manifest digests.

| Image or artifact                        | Critical / High / Medium / Low / Unknown | Result                                                                             |
| ---------------------------------------- | ---------------------------------------: | ---------------------------------------------------------------------------------- |
| API, web, worker, migration, operator    |                 Each `0 / 0 / 1 / 0 / 0` | No critical/high findings; one Alpine zlib medium per image.                       |
| PostgreSQL 18.6 with rebuilt gosu        |                      `0 / 0 / 3 / 0 / 1` | Upstream gosu critical and 24 high Go findings are absent from the final artifact. |
| Patched SeaweedFS 4.48 local artifact    |                      `0 / 0 / 2 / 0 / 1` | Three upstream Go high IDs are absent; registry publication remains open.          |
| AWS CLI bucket initializer               |                      `0 / 0 / 0 / 0 / 0` | Clean at critical/high.                                                            |
| Rebuilt Caddy 2.11.7                     |                      `0 / 0 / 1 / 0 / 1` | Three upstream Go/x/net high IDs are absent.                                       |
| Authentik 2026.8.4                       |                   `1 / 20 / 56 / 57 / 1` | Critical/high findings remain.                                                     |
| Redis 8-alpine                           |                      `0 / 0 / 1 / 0 / 0` | No critical/high findings.                                                         |
| OpenTelemetry Collector 0.163.1          |                      `0 / 0 / 0 / 0 / 1` | No critical/high findings.                                                         |
| Patched Prometheus 3.15.0 local artifact |                      `0 / 0 / 0 / 0 / 1` | Three upstream high IDs fixed; one unknown Go advisory remains.                    |
| Grafana 13.2.4                           |                    `0 / 12 / 15 / 1 / 1` | Twelve high findings remain.                                                       |
| Patched OSRM 26.10.0 local artifact      |                    `0 / 8 / 29 / 33 / 3` | Two high IDs fixed; eight high findings remain.                                    |
| Mailpit 1.31.6, development only         |                      `0 / 0 / 0 / 0 / 1` | No critical/high findings; production override keeps it disabled.                  |
| Prometheus 3.15.0 upstream baseline      |                      `0 / 3 / 9 / 1 / 1` | Baseline only; production uses the separately scanned patched local artifact.      |
| OSRM 26.10.0 upstream baseline           |                   `0 / 10 / 39 / 35 / 3` | Baseline only; production uses the separately scanned patched local artifact.      |

Counts are unique vulnerability IDs per artifact, with the highest severity per ID. The full Trivy JSON retains each critical/high advisory, installed package/version, fixed version when reported, and package origin. The before/after records remain in sections 16 and 19. No scanner findings were ignored.

The remaining OSRM high IDs were traced to the exact Debian packages in the final image: `bsdutils`, `util-linux` and its libraries (including `liblastlog2-2`), `libacl1`, `libsystemd0`/`libudev1`, ncurses/tinfo, and `perl-base`. Trivy reports no fixed versions for these installed versions. The core packages marked Essential or required by Essential utilities cannot be removed safely without replacing the runtime base or breaking standard package dependencies. The existing shell-based startup and health checks also rely on the upstream environment. The official Alpine variant still does not resolve from the OSRM registry. No package database or scanner result was altered to hide these findings.

Registry checks on 2026-10-18 still found no candidate images at `ghcr.io/goauthentik/server:2026.8.5`, `grafana/grafana:13.2.5`, `prom/prometheus:v3.15.1`, or `ghcr.io/project-osrm/osrm-backend:v26.11.0-debian`. The verified official SeaweedFS 4.48 index remained `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`; its linux/amd64 manifest remained `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. The patched SeaweedFS runtime was scanned and passed the documented S3/startup smoke, but it still has no registry manifest digest because it has not been published.

### Direct registry and package-policy recheck

At `2026-10-18T13:02:03Z`, `docker buildx imagetools inspect` verified the deployed upstream indexes and their linux/amd64 manifests. The full reference list and digests are recorded as `latestRegistryRecheck.verifiedReferences` in [goal15a-container-scan.json](security/goal15a-container-scan.json). SeaweedFS 4.48 resolves to index `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` and linux/amd64 manifest `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. This verifies the intended official release and platform; production Compose still selects the separate local patched build, whose registry digest is unavailable.

The same direct registry check returned `not found` for Authentik `2026.8.5`, `2026.8.6`, and `2026.11.0`; Grafana `13.2.5` and `13.3.0`; Prometheus `v3.15.1` and `v3.16.0`; and OSRM `v26.10.1-debian`, `v26.11.0-debian`, and `v26.10.0-alpine`. Grafana's published schedule places 13.3 on October 20, and Prometheus lists the first v3.16 pre-release for October 21; neither was yet available at this check ([Grafana schedule](https://grafana.com/docs/grafana/latest/upgrade-guide/when-to-upgrade/), [Prometheus release schedule](https://github.com/prometheus/prometheus/blob/main/RELEASE.md)). OSRM's release notes define monthly releases; v26.10.0 was the current release checked ([OSRM release process](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/releasing.md)). Authentik 2026.8.4 is the latest available image inspected, and its official release notes list that patch ([Authentik 2026.8 notes](https://docs.goauthentik.io/releases/2026.8/)). These registry checks do not establish vulnerability status for any future image: each new release must be pinned and rescanned before use.

The exact Authentik 2026.8.4 image was inspected with a network-disabled shell, without starting its service. Debian reports `libssl-dev`, `libssl3t64`, and `openssl` as held at `3.5.7-1~deb13u2`; Trivy's fixed version for the related high advisory is `3.5.7-1~deb13u3`. The critical `libxml2` CVE still has no fixed version in the scan database. No package hold was overridden and no unsupported Authentik derivative was built. The product-level fixes, custom-image publication, and a security-owner decision remain open.

### Authentication browser recheck

The dedicated synthetic `care-goal15-e2e-rerun` project was already running on the `.env.test` ports. Migrations and synthetic seed completed successfully, then the full Authentik browser suite passed **12/12, zero failures, zero skips in 4.6 minutes**. Its Playwright web servers ran the current API and Next.js source in development mode against the pinned Authentik services; this covers browser authentication and workflows, not a browser journey through the production API/web image artifacts. Goal 15A’s separate production-image synthetic runtime check remains the evidence for those exact images: API/web/worker health, migration completion, Caddy routes, Authentik health, and S3 put/get passed. The E2E project was left running; its synthetic database contains the test run's migration, seed, and workflow writes, and its containers/volumes were not stopped or removed.

The test output again contained transient Next.js destination-stream errors, a PostgreSQL client-query deprecation warning, and color-environment warnings. All 12 browser journeys passed. No production Compose project, production secret, or production volume was started or accessed. Validation and browser execution used `.env.production.example` and `.env.test` explicitly; `.env.production` was not opened or loaded.

Reproduction:

```bash
docker compose --env-file .env.test -p care-goal15-e2e-rerun \
  -f compose.yaml -f compose.e2e.yaml --profile development up -d --wait
bun --env-file=.env.test run migrate
bun --env-file=.env.test run seed
PLAYWRIGHT_BROWSERS_PATH=<cache> \
  bun --env-file=.env.test run --filter @care/web test:e2e
```

### Focused integration and repository gates

The synthetic API/worker integration run passed **6 API suites with 1,347 assertions** and **3 worker suites with 13 assertions**. API coverage includes invoice PDF generation and authorized retrieval/hash verification; the API PDF tests use an in-memory object store. The separate Goal 15A runtime smoke verified an S3 put/get against the patched SeaweedFS container. Reproduce the focused suites with:

```bash
bun --env-file=.env.test run test:integration --filter=@care/api --filter=@care/worker
```

The requested repository gates passed on the current worktree: `bun run lint` (33/33), `bun run format:check` (680 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (32/32). Strict Oxlint, Graphify update, production Compose validation with `.env.production.example`, and `git diff --check` also passed.

### Updated disposition

The container gate remains **Fail**. Authentik still has one critical and 20 high IDs, Grafana has 12 high IDs, and the patched OSRM artifact has eight high IDs. The production custom artifacts (including SeaweedFS, OSRM, and Prometheus) remain local builds without approved-registry manifest digests. A supported patched Authentik/Grafana/OSRM image or documented security-owner disposition is still required; registry publication, digest verification, and a rescan of each pushed artifact are required for custom images. The `UNKNOWN` Go advisory in Prometheus is not counted as critical/high but remains recorded for review.

The Goal 15A container work is **not complete** and the platform is **not cleared for production**. Accessibility, external production configuration, other release gates, and security-owner acceptance keep their independently verified status. This update does not promote any of them to Pass.

## 21. Goal 15A Authentik remediation candidate and final residuals — 2026-10-18

### Current image and vulnerability status

At `2026-10-18T13:10:32Z`, Trivy 0.76.0 scanned the exact linux/amd64 local image `care-platform-authentik:2026.8.4-openssl-deb13u3-urllib3-2.8.0`. The scan used the same vulnerability database snapshot as section 20 (`UpdatedAt` `2026-10-18T07:12:07.771859408Z`, downloaded at `2026-10-18T11:29:07.494039118Z`). It found **1 critical, 15 high, 44 medium, 55 low, and 1 unknown unique ID**. Compared with the exact official Authentik 2026.8.4 baseline on that database, five high IDs are gone; the critical count is unchanged. The raw scan, report hash, package instances, exact local artifact identity, and complete critical/high records are in `latestAuthentikPatchedCandidate` in [goal15a-container-scan.json](security/goal15a-container-scan.json). The local image ID/repo digest is not a registry manifest digest.

The derived image is based on the verified official `ghcr.io/goauthentik/server:2026.8.4@sha256:e7226ae116dac5aa0a5643803e735b010038f492c401e08e16b3bf1ac54c090c` image. It unholds and updates the three OpenSSL packages from `3.5.7-1~deb13u2` to the scanner-fixed `3.5.7-1~deb13u3`, updates the active application venv `urllib3` from `2.7.0` to the hash-verified `2.8.0` wheel, and removes unused global pip tooling. The venv retains `setuptools 83.0.0` and `msgpack 1.2.1`; the old `setuptools 70.3.0` and pip-vendored `msgpack 1.1.2` dist-info entries and global pip entrypoints are absent from the final runtime filesystem. The final scan no longer reports the old OpenSSL, urllib3, setuptools, or msgpack high IDs. No Trivy exclusions or status edits were made.

The Dockerfile is [infra/authentik/Dockerfile](../infra/authentik/Dockerfile). Production Compose uses the same local build image for Authentik server and worker. The image preserves the upstream `dumb-init -- ak` entrypoint and `authentik` runtime user. It passed a build using the synthetic `.env.production.example`; this is an unpublished candidate, not a deployable immutable registry reference.

### Remaining Authentik findings

All remaining Authentik critical/high findings are from Debian OS packages present in the final image. The scan reports no fixed version for these package versions; `CVE-2026-9538` is marked `fix_deferred`. A disposable `linux/amd64` inspection of the exact official base refreshed Debian package indexes at `2026-10-18T13:20:05Z`; candidate versions remained equal to installed versions for `libxml2`, `util-linux`, `ncurses-base`, `perl-base`, `libsystemd0`, and `libacl1`. `util-linux`, `bsdutils`, `perl-base`, and `ncurses-base` are Essential. Simulated package removal failed because base tools including `coreutils`, `sed`, `tar`, and `apt` depend on the flagged system libraries, so they were retained rather than breaking the runtime.

| Severity | Advisory IDs                                                                                                                 | Installed package(s) and version                                                                                                                                                                | Fixed package version in scan                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Critical | `CVE-2026-6653`                                                                                                              | `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`                                                                                                                                                  | None reported                                  |
| High     | `CVE-2026-74860`, `CVE-2026-86138`, `CVE-2026-86139`, `CVE-2026-86140`, `CVE-2026-86142`, `CVE-2026-86143`, `CVE-2026-86144` | `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`                                                                                                                                                  | None reported                                  |
| High     | `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, `CVE-2026-78410`                                                       | `bsdutils`, `libblkid1`, `liblastlog2-2`, `libmount1`, `libsmartcols1`, `libuuid1`, `login`, `mount`, and `util-linux`, all `2.41.5-0+deb13u1` except `login 1:4.16.0-2+really2.41.5-0+deb13u1` | None reported                                  |
| High     | `CVE-2025-69720`                                                                                                             | `libncursesw6`, `libtinfo6`, `ncurses-base`, `ncurses-bin`, all `6.5+20250216-2`                                                                                                                | None reported                                  |
| High     | `CVE-2026-16742`                                                                                                             | `libsystemd0`, `libudev1`, both `257.13-1~deb13u1`                                                                                                                                              | None reported                                  |
| High     | `CVE-2026-54369`                                                                                                             | `libacl1 2.3.2-2+b1`                                                                                                                                                                            | None reported                                  |
| High     | `CVE-2026-9538`                                                                                                              | `perl-base 5.40.1-6+deb13u1`                                                                                                                                                                    | None reported; Debian status is `fix_deferred` |

The libxml2 findings include denial-of-service, memory-safety, and XML processing advisories. Authentik is routed through Caddy and processes XML-related identity formats; Trivy does not assess which vulnerable code paths are reachable. The util-linux advisories describe privileged mount/namespace operations; the tested Authentik containers ran as `authentik`, were not privileged, and had no added capabilities, which limits those local privilege-escalation paths but does not remove the findings. These are mitigations, not a resolution or risk acceptance.

### Other remaining critical/high findings

The exact production inventory scan in section 20 remains the latest scan for other services. Findings remain in the upstream Grafana image and patched local OSRM image:

| Image                                                                                                                                       | Remaining findings  | Package evidence and available fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grafana/grafana:13.2.4@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f`                                            | 12 high, 0 critical | `CVE-2026-100349/100351/100352/100353/100354`: `github.com/getkin/kin-openapi v0.144.0`, fixes reported from `v0.146.0` through `v0.149.0`; `CVE-2026-21728` and `CVE-2026-28377`: `github.com/grafana/tempo v1.5.1-0.20260910130453-bcfe9f230c1d`, fixes reported in `v2.8.4`, `v2.9.2`, `v2.10.2` and `v2.10.3`; `CVE-2026-78667` and `CVE-2026-97031`: Go stdlib versions `v1.26.6`, `v1.26.7`, `v1.27.1`, fixed in `v1.26.9` or `v1.27.2`; `CVE-2026-78669`: `golang.org/x/net v0.58.0`/`v0.59.0`, fixed in `v0.60.0`; `CVE-2026-84304` and `CVE-2026-84445`: `google.golang.org/grpc v1.83.0`, fixed in `v1.83.1` and `v1.83.2`. The next candidate tags checked in section 20 were unavailable. The fixed versions make a supported upstream release or reviewed source rebuild necessary; the current image is not clean. |
| `care-platform-osrm:v26.10.0-debian-security` (local artifact ID `sha256:f4717f8bdf849d9dda43590474ee2ccd04a14a6d938db7a48dca35d065b482d3`) | 8 high, 0 critical  | `CVE-2025-69720` in ncurses/tinfo `6.5+20250216-2`; `CVE-2026-16742` in `libsystemd0`/`libudev1 257.13-1~deb13u1`; `CVE-2026-54369` in `libacl1 2.3.2-2+b1`; `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, and `CVE-2026-78410` in the util-linux family `2.41.5-0+deb13u1`; and `CVE-2026-9538` in `perl-base 5.40.1-6+deb13u1` (`fix_deferred`). The local Debian package update fixed `CVE-2026-103111` in PCRE2 and `CVE-2026-84782` in OpenSSL, reducing upstream OSRM from ten to eight high IDs. The remaining Debian candidate packages were not available from the current package index. This is a Docker local image ID, not a registry digest.                                                                                                                                                               |

All 12 Grafana and eight OSRM findings remain traceable by advisory, package, installed/fixed version, and status in the section 20 records in [goal15a-container-scan.json](security/goal15a-container-scan.json). No findings were suppressed. The official Grafana and OSRM image digests are pinned in scan evidence, but production Compose currently selects the patched local OSRM build, not the scanned official OSRM image.

### SeaweedFS digest and production image references

The intended SeaweedFS release remains 4.48. At `2026-10-18T13:02:03Z`, `docker buildx imagetools inspect` verified the official registry index `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` and the `linux/amd64` platform manifest `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. Production Compose explicitly targets `linux/amd64`; the commands remain `server -dir=/data -ip.bind=0.0.0.0 -s3 -s3.config=/run/secrets/seaweedfs_s3 -s3.port=8333`. The synthetic S3 startup, health, put, and get checks passed with the patched 4.48 candidate.

Production Compose is still configured to build `care-platform-seaweedfs:4.48-go1.26.9-xnet0.60.0` locally. That image has no registry manifest digest, and the official immutable 4.48 image retains three high Go findings. Therefore the official digest is verified evidence for the intended upstream release and architecture, but the patched artifact cannot yet be referenced by a verified production registry digest. The exact local artifact scan is clean at critical/high, but must not be substituted with its local Docker image ID. A production reference such as `registry/repository:4.48-patched@sha256:<verified-registry-digest>` can only be set after publication to an approved registry and verification/scanning of the pushed artifact.

The same digest limitation applies to local PostgreSQL, Caddy, Prometheus, OSRM, SeaweedFS, and Authentik candidates. Their Dockerfiles and base references are recorded in the inventory; local image IDs are not registry digests. API, web, worker, migration, and operator exact build artifacts each scan with zero critical/high findings, but their Compose build tags also do not constitute immutable pushed image references. Remote images with upstream digests, platforms, exact refs, and scan results are in the structured inventory. Digest pinning records identity and does not remediate a vulnerability.

### Build and synthetic runtime verification

The Authentik candidate build passed with synthetic configuration:

```bash
DOCKER_CONFIG=/home/woobb/.cache/codex-tmp/care-goal15a-docker-config \
  docker compose --env-file .env.production.example -p care-goal15a-authentik-build \
  -f compose.yaml -f compose.production.yaml build authentik-server
```

The exact final image scan passed with Trivy exit code 0; this means the artifact was inspected, not that it is vulnerability-free:

```bash
trivy --cache-dir <cache> image --image-src docker --skip-db-update --skip-java-db-update \
  --scanners vuln --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json \
  --output <report.json> \
  care-platform-authentik:2026.8.4-openssl-deb13u3-urllib3-2.8.0
```

The full synthetic Authentik browser suite passed **12/12, zero failures, zero skips, exit code 0 in 5.1 minutes** against the patched server and worker in `care-goal15-e2e-rerun`. Only those two containers were recreated with `--no-deps`; existing Postgres, Redis, SeaweedFS and Mailpit containers and volumes remained in the synthetic project. They were healthy after recreation. E2E used `.env.test`; no production project or volume was used. The suite ran the current API and Next.js source rather than the final API/web production image binaries. Earlier exact production-image runtime smokes in sections 16 and 19 remain the evidence for API/web/worker image health, migration completion, Caddy routing, Authentik health, and SeaweedFS S3 put/get; private invoice PDF generation and authorized retrieval were separately verified through the API. The latest E2E command and warnings are retained in `latestAuthentikPatchedE2E` in the JSON record.

This turn did not open or load `.env.production`. The custom image build used `.env.production.example`; E2E used `.env.test`; Trivy needed no application secrets. No report generated here includes secret values. This does not close the earlier historical process-output exposure review recorded in section 15.

### Quality gates and repeatable update procedure

The final repository checks passed: `bun run lint` (33/33 tasks), `bun run format:check` (681 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (32/32). Turbo replayed cached results for these workspace checks because application source and dependencies did not change in this container-only follow-up; the Authentik image itself was rebuilt separately. `bunx oxlint --deny-warnings --format=agent`, production Compose validation using an empty inherited environment plus `.env.production.example`, E2E Compose image resolution using `.env.test`, `git diff --check`, and `graphify update .` also passed. The focused integration evidence remains 6 API suites/1,347 assertions and 3 worker suites/13 assertions from section 20.

For a future security update, check the upstream product release and package advisory, then pin the chosen base tag and verified registry digest for the intended platform. Update exact Debian package versions and the urllib3 wheel version/hash in [infra/authentik/Dockerfile](../infra/authentik/Dockerfile); build both Authentik roles using only a synthetic env file; scan the final local image and record the Trivy version, database timestamp, local artifact identity, report hash, and per-ID package details. Compare against the previous scan, without excluding findings. After approved-registry publication, verify the pushed tag and platform manifest digest, configure the production reference as `registry/repository:version@sha256:<verified-digest>`, scan that exact remote digest, and repeat health, E2E, and object-storage checks. Apply the same publish/verify/rescan process to every locally rebuilt production image. A registry digest identifies the artifact; it does not establish that the artifact is secure.

### Required security-owner decisions and release gate

| Decision                                                | Status          | Required disposition                                                                                                                                                                                                                           |
| ------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentik `CVE-2026-6653` and 15 high IDs               | **Blocked**     | Await a supported upstream/Debian fix, or have the security owner assess the exact installed packages, exposure, mitigations, and formally accept the specific residual findings. The image remains behind Caddy and handles identity traffic. |
| Grafana 12 high IDs                                     | **Blocked**     | Use a supported patched release or security-owner disposition. Trivy reports fixed versions for the Go modules, but no candidate release tag was available at the registry check in section 20.                                                |
| OSRM 8 high IDs                                         | **Blocked**     | Await Debian package fixes or use a supported patched distribution after compatibility and image verification; otherwise obtain security-owner disposition for the exact IDs.                                                                  |
| Local custom images and immutable production references | **Blocked**     | Publish approved artifacts, verify each registry manifest digest and platform, update Compose to the exact immutable references, then rescan the pushed artifacts and repeat runtime checks.                                                   |
| Security-owner risk acceptance                          | **Not granted** | No residual finding is automatically accepted by this assessment.                                                                                                                                                                              |
| Production release                                      | **Fail**        | Container vulnerabilities/publication and independent accessibility, recovery, performance, external configuration, and organizational gates still block clearance.                                                                            |

The full inventory and exact references remain in `docs/security/goal15a-container-scan.json`; section 20 preserves the prior baseline, registry checks, and 18-image scan. Updated Authentik evidence is additive in section 21. Container security remains **Fail**, production image immutability remains **Blocked**, and the overall release remains **Fail**. Accessibility, recovery, performance, production preflight, and security-owner review retain their independently verified status; none is promoted to Pass here.

## 22. Goal 15 continuation — registry recheck and concurrent allocation evidence — 2026-10-18

### Current container and registry status

At `2026-10-18T13:27Z`, direct `docker buildx imagetools inspect` checks found no registry manifests for the next candidate tags below. No image reference or scan result was inferred from a local image ID. The exact check and unavailable references are recorded as `latestRegistryAvailabilityRecheck` in [goal15a-container-scan.json](security/goal15a-container-scan.json).

| Product    | Candidate references checked                                            | Result                    |
| ---------- | ----------------------------------------------------------------------- | ------------------------- |
| Authentik  | `ghcr.io/goauthentik/server:2026.8.5`, `:2026.8.6`, `:2026.9.0`         | Unavailable at check time |
| Grafana    | `grafana/grafana:13.2.5`, `:13.3.0`                                     | Unavailable at check time |
| Prometheus | `prom/prometheus:v3.15.1`, `:v3.16.0`                                   | Unavailable at check time |
| OSRM       | `ghcr.io/project-osrm/osrm-backend:v26.10.1-debian`, `:v26.11.0-debian` | Unavailable at check time |

The intended SeaweedFS release is still 4.48. Its official registry index digest remains verified as `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`; the `linux/amd64` platform manifest is `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. The pinned manifest is for the supported official 4.48 image. Production Compose currently builds the separately patched local candidate `care-platform-seaweedfs:4.48-go1.26.9-xnet0.60.0` (local artifact `sha256:a374e36140a81524c3bc7ec00e9b03aca79c4883f8d0a9c673d62bac6ca309df`), which is not a registry digest. The candidate's S3 startup command, `/data` storage path, port, health check, and synthetic put/get behavior were verified in the prior runtime smoke. The patched artifact still must be published through the approved registry, inspected by platform, scanned by immutable remote digest, and referenced by that digest before deployment.

Latest critical/high scan comparisons remain:

| Image or candidate                                                       | Before (C/H) | After (C/H) | Current disposition                                                                                                  |
| ------------------------------------------------------------------------ | -----------: | ----------: | -------------------------------------------------------------------------------------------------------------------- |
| Authentik 2026.8.4 official base → derived candidate                     |         1/20 |        1/15 | Blocked: one critical and 15 high Debian package findings remain; see section 21.                                    |
| Grafana 13.2.4                                                           |         0/12 |        0/12 | Blocked: 12 high bundled Go/application findings remain.                                                             |
| OSRM v26.10.0 Debian → patched local candidate                           |         0/10 |         0/8 | Blocked: eight high Debian package findings remain.                                                                  |
| Prometheus v3.15.0 → patched source build                                |          0/3 |         0/0 | No critical/high IDs in the scanned local candidate; publication and immutable digest remain outstanding.            |
| SeaweedFS 4.48 → patched local candidate                                 |          0/3 |         0/0 | No critical/high IDs in the scanned local candidate; publication and immutable digest remain outstanding.            |
| OpenTelemetry Collector and Mailpit                                      |     0/3 each |    0/0 each | Updated digest-pinned releases scan without critical/high IDs. Mailpit remains development-only.                     |
| API, web, worker, migration, operator, PostgreSQL, Redis, Caddy, AWS CLI |          0/0 |         0/0 | Exact artifacts were scanned; custom local images still need approved registry publication and immutable references. |

Trivy 0.76.0 used the database updated at `2026-10-18T07:12:07.771859408Z` and downloaded at `2026-10-18T11:29:07.494039118Z` for the latest recorded exact-artifact scans. Full image-by-image package findings, local artifact IDs, report hashes, platforms, exact registry references, and commands remain in the structured JSON evidence. The current deployable candidates retain **one critical and 35 high IDs** across Authentik (1/15), Grafana (0/12), and patched OSRM (0/8); none is accepted or suppressed. No security-owner acceptance exists. The current production Compose references include verified registry digests for Redis, OpenTelemetry Collector, Grafana, and Mailpit; Authentik, SeaweedFS, Prometheus, OSRM, PostgreSQL, Caddy, AWS CLI, and application images are local build references, not immutable registry references. The release image pinning criterion therefore remains **Blocked**.

### Additional concurrency verification

The synthetic PostgreSQL/API integration suite now races two distinct 6,000-cent allocations against a 9,000-cent performed service. Exactly one allocation committed; the competing request returned `BENEFIT_ALLOCATION_CONFLICT`. The persisted state contains one 6,000-cent service allocation, one `-6,000` ledger entry linked to that allocation, and one `benefit.service_allocated` outbox event. The focused run passed six API integration suites with **1,357 assertions** and three worker integration suites with **13 assertions**. The earlier complete Authentik browser E2E result remains 12/12 with zero skips against the synthetic `.env.test` project. This additional database test did not change application runtime code or the scanned images.

### Updated gate status and handoff

| Gate                                                                                               | Current status             | Evidence or remaining work                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production image inventory and exact-artifact scans                                                | Pass for inspection        | Every configured production image and local build candidate has scan evidence. No scan is represented as clean where it has critical/high findings.                                                                                                                                      |
| Actionable critical/high findings                                                                  | **Fail**                   | Authentik `CVE-2026-6653` plus 15 high IDs, Grafana 12 high IDs, and OSRM eight high IDs remain. Fixed-version updates and supported patched upstream tags were unavailable in the recorded checks; await a supported vendor/package fix or security-owner disposition for each finding. |
| SeaweedFS intended release and upstream digest                                                     | Pass                       | Official 4.48 `linux/amd64` registry manifest digest is verified; commands and storage compatibility passed synthetic runtime checks.                                                                                                                                                    |
| SeaweedFS patched deployable digest                                                                | **Blocked**                | Patched local image has no approved registry manifest digest. Publish, verify, scan, and pin the exact pushed artifact.                                                                                                                                                                  |
| Immutable production references                                                                    | **Blocked**                | Multiple custom and application images still use local tags. No image is ready for deployment until all required artifacts have approved immutable references and their pushed digests are rescanned.                                                                                    |
| Application builds and synthetic runtime smoke                                                     | Pass                       | Production Dockerfiles built with synthetic configuration; prior isolated stack verified API/web/worker startup, migration completion, Authentik/Caddy health, object-storage put/get, and invoice PDF generation/retrieval.                                                             |
| Authenticated browser and database concurrency checks                                              | Pass for recorded scope    | Authentik E2E 12/12; allocation race persisted a single consistent winner. Broader accessibility and workload items remain as recorded in sections 11–15.                                                                                                                                |
| Production configuration and secret isolation                                                      | Pass for this continuation | No `.env.production` read or load; Compose validation used `.env.production.example`; browser/integration work used `.env.test`; no production project or volume was started. Historical process-output exposure review remains open in section 15.                                      |
| Independent accessibility, recovery, performance, external configuration, and organizational gates | **Not cleared**            | Keep their separately recorded statuses; this container update does not promote them to Pass.                                                                                                                                                                                            |
| Overall production release                                                                         | **Fail**                   | Container vulnerabilities, unpublished custom images, outstanding immutable references, and independent readiness gates continue to block release.                                                                                                                                       |

Reproduce the focused integration check with `bun --env-file=.env.test run test:integration --filter=@care/api --filter=@care/worker`. Recheck upstream registry tags and package repositories before a later update because availability can change. The next container-security action is to obtain supported fixed artifacts and an approved publication path; then inspect the registry manifests for the intended platforms, pin the exact immutable references, scan those pushed digests, and repeat isolated runtime checks. No production deployment was attempted, and the Care Platform is not cleared for production.

## 23. Goal 15 final continuation — responsive audit, registry recheck, and release matrix — 2026-10-18

### Full Authentik E2E and expanded responsive checks

The full isolated Authentik Playwright run completed with **12 configured tests, zero failures, and zero skips**. The latest Playwright `.last-run.json` records `status: passed` and an empty `failedTests` array (written at 2026-10-18 13:46:30Z). The suite uses the dedicated `care-goal15-e2e-rerun` project and `.env.test`; no production project, secret, or volume was involved. The run continued to print a transient Next.js destination-stream error and PostgreSQL/color-environment warnings; none caused a test failure. No duration is claimed because the completed console summary was not retained.

The shared E2E review now checks selected visible workflow states in Benefits allocation and Billing, organization creation, billing and claims settings, document templates, reminder settings, Admissions, and planning. Those checkpoints are audited at 390×844, 768×1024, and 1440×900 for document overflow, visible control and field names, image `alt` attributes, and button target size of at least 24×24 CSS pixels. Screenshot states for Documents/Communications and caregiver Today run the same semantics and overflow checks at the capture viewport. Visit-details modal focus wrapping, Escape dismissal, focus return, and labeled rescheduling fields remain checked at all three sizes. These are targeted DOM/layout checks; they do not constitute a full screen-reader, rendered contrast, or WCAG audit, and every workflow action is not repeated at every width. The broader accessibility gate therefore remains **Fail** pending the review items below.

Reproduce the isolated browser run with the existing synthetic project started explicitly from `.env.test`, then:

```bash
PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BROWSERS_PATH=<cache> \
  bun --env-file=.env.test run --filter @care/web test:e2e
```

### Direct registry recheck

At `2026-10-18T13:48:31Z`, direct `docker buildx imagetools inspect` calls again found no manifests for the checked candidate releases: Authentik 2026.8.5/2026.8.6/2026.9.0; Grafana 13.2.5/13.3.0; Prometheus v3.15.1/v3.16.0; and OSRM v26.10.1-debian/v26.11.0-debian. The current official SeaweedFS 4.48 index was present at `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`; its `linux/amd64` manifest remains `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. This confirms the upstream intended release and architecture only. Production Compose still points to the separate patched local SeaweedFS build, which has no registry digest. The exact check is additive in `latestRegistryAvailabilityRecheck` in [goal15a-container-scan.json](security/goal15a-container-scan.json); the earlier 13:27Z check remains recorded in section 22.

### Current release-gate matrix

| Gate                | Status      | Current evidence and remaining work                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container security  | **Fail**    | Exact configured artifacts and local build candidates were scanned. Authentik retains one critical and 15 high IDs, Grafana 12 high IDs, and patched OSRM eight high IDs. Prometheus and patched SeaweedFS local candidates have zero critical/high IDs, but their deployable registry digests are missing. Obtain supported fixes or explicit security-owner dispositions, publish custom artifacts through the approved registry, verify immutable platform digests, and rescan those pushed artifacts. |
| Secret isolation    | **Blocked** | Bun, Next.js, tests, builds, Compose validation, and scanner commands now use guarded synthetic/example configuration; `.env.production` was not opened or loaded for this continuation. The historical `pgrep -af` shell-output exposure may have included proxy credentials. Determine what values were in the captured trace and rotate only confirmed exposed credentials through the normal process; no automatic rotation or exposure conclusion is recorded.                                       |
| Database recovery   | **Pass**    | Isolated PostgreSQL restore completed in 23.550 seconds and passed migration, forced-RLS, row/reference, and financial-history verification. These local measurements are not a production RTO/RPO commitment.                                                                                                                                                                                                                                                                                            |
| Document recovery   | **Pass**    | An authorized synthetic user retrieved a restored issued-invoice PDF and evidence package through application routes; invoice identity and SHA-256 were checked, and unauthorized invoice access returned no PDF. Six private objects were restored and verified.                                                                                                                                                                                                                                         |
| Worker recovery     | **Pass**    | A real worker SIGKILL/restart around a committed recurring Operations task produced exactly one task and occurrence. Reminder/recurrence transaction retry checks and outbox recovery passed; not every document or billing side effect was crash-injected, so this is limited to the tested handlers.                                                                                                                                                                                                    |
| Authentication      | **Pass**    | Latest complete synthetic Authentik E2E: 12 configured tests, zero failures/skips; `.last-run.json` records passed with no failed tests. Hydration/stream and tooling warnings remain under investigation but did not fail the journeys.                                                                                                                                                                                                                                                                  |
| Financial integrity | **Pass**    | Concurrent $60-equivalent allocations against one synthetic $90 service produced one committed 6,000-cent allocation and one `BENEFIT_ALLOCATION_CONFLICT`; exactly one linked ledger row and outbox event persisted. Focused API and worker PostgreSQL suites also passed.                                                                                                                                                                                                                               |
| API performance     | **Pass**    | The reproducible synthetic baseline completed 400 authorized reads at concurrency four across representative routes, with latency percentiles and throughput recorded in section 4. It is not a production SLO or hardware-capacity result.                                                                                                                                                                                                                                                               |
| Accessibility       | **Fail**    | Expanded responsive/semantic checks and the visit-details keyboard focus cycle passed their selected states at target widths. Complete focus and error-announcement coverage, rendered-state contrast, pagination/status semantics, and repeating every high-frequency action at every width remain outstanding. No WCAG conformance is claimed.                                                                                                                                                          |
| Configuration       | **Pass**    | Production Compose parsing, image resolution, networks, volumes, health checks, dependencies, Caddy settings, migrations, and worker startup/shutdown were reviewed with `.env.production.example` or synthetic configuration. Live production OIDC, TLS/domain, SMTP, object-storage settings, and preflight remain **Not tested**.                                                                                                                                                                      |

The required technical gates remain **Fail** for container security and accessibility and **Blocked** for historical secret-exposure review. The overall release remains **Fail**. No security-owner risk acceptance is recorded; the Care Platform is not cleared for production. Recovery, performance, and configuration checks above do not promote the remaining independent organizational, external-production, or operational requirements to Pass.

### Final repository checks

After the E2E review and report updates, `bun run lint` passed 33/33 tasks; `bun run format:check` passed for 681 files; `bun run i18n:check` passed for 3,528 messages; `bun run typecheck` passed 33/33 tasks; `bun run test` passed 51/51 tasks; and `bun run build` passed OpenAPI generation and 32/32 tasks, including the Next.js production build with `NODE_ENV=test`. Strict Oxlint, production Compose validation with an empty inherited environment plus `.env.production.example`, `git diff --check`, and `graphify update .` also passed. Exact container scan results are unchanged because no production runtime image inputs changed in this continuation; no new scan is claimed. The structured outcomes are in `latestQualityGateRun` in [goal15a-container-scan.json](security/goal15a-container-scan.json).

## 24. Goal 15 continuation — package repository and publication-path recheck — 2026-10-18

At `2026-10-18T13:56:11Z`, direct registry inspection again found no manifests for the candidate Authentik 2026.8.5/2026.8.6/2026.9.0, Grafana 13.2.5/13.3.0, Prometheus v3.15.1/v3.16.0, or OSRM v26.10.1/v26.11.0 Debian tags. The official SeaweedFS 4.48 index and linux/amd64 digest were verified in the same check and match section 23.

Disposable no-volume shell inspections of the exact digest-pinned Authentik 2026.8.4 and OSRM v26.10.0 Debian images refreshed their configured apt indexes and queried the remaining vulnerable packages. Candidate package versions were equal to installed versions: `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`, `util-linux 2.41.5-0+deb13u1`, `perl-base 5.40.1-6+deb13u1`, `ncurses-base 6.5+20250216-2`, `libsystemd0 257.13-1~deb13u1`, and `libacl1 2.3.2-2+b1`. No packages were installed, no image was changed, and no application entrypoint or service was started. This confirms the configured Debian repositories still offer no package fix for these versions at the recorded time; it does not establish code-path reachability.

The repository has no declared approved registry namespace, custom-image push script, or authenticated publishing workflow. GitHub metadata identifies the repository owner as `woobble`, and the user selected an existing GHCR organization, but that does not identify the approved package namespace or its publishing/authentication workflow. Production Compose builds the custom images as local tags. I did not select a destination or push images. The container blocker now requires the exact approved repository namespace and existing credential mechanism before custom artifacts can be published, digest-verified, rescanned, and pinned. The exact package and registry checks plus this publishing-path audit are recorded in [goal15a-container-scan.json](security/goal15a-container-scan.json). Container security remains **Fail**, immutable custom-image publication remains **Blocked**, and no security-owner risk acceptance is recorded.

## 25. Goal 15 continuation — complete responsive E2E and layout corrections — 2026-10-18

At `2026-10-18T14:13Z`, the complete synthetic Authentik Playwright suite passed **12/12 configured tests, zero failures, zero skips, exit code 0, in 4.4 minutes**. It used project `care-goal15-e2e-rerun` and `.env.test`; no production configuration, secret, project, or volume was used. The exact command was:

```bash
PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BROWSERS_PATH=<cache> \
  bun --env-file=.env.test run --filter @care/web test:e2e
```

Every shared review-screenshot checkpoint now checks 390×844, 768×1024, and 1440×900 for document overflow, accessible names on visible controls and fields, visible image `alt` attributes, and minimum button target dimensions. This includes the Services catalog and Operations worklist error/loading state. The expanded run exposed and verified fixes for two real layout defects: category editing forms used four columns at tablet width despite the constrained office content area, and the shared loading fallback's fixed-width skeleton widened a nested main landmark beyond its parent. The category forms now use two columns at medium sizes and four only at extra-large sizes; the fallback is a constrained status container with explicit responsive skeleton widths. The targeted Services and Operations tests passed after their fixes, followed by the full 12-test pass.

This improves the responsive checks but does not satisfy the full accessibility gate. Screen-reader review, comprehensive rendered-state contrast and error-announcement checks, and broader interaction coverage remain outstanding. The status remains **Fail** for accessibility and for container security; this E2E run does not alter any vulnerability disposition or registry publication blocker. A transient Next.js destination-stream/hydration warning and PostgreSQL/color-environment warnings were observed; all tests passed. The final result and prior run history are stored in `latestResponsiveAccessibilityE2E` in [goal15a-container-scan.json](security/goal15a-container-scan.json).

## 26. Goal 15A application runtime remediation and synthetic image smoke — 2026-10-18

### Bun runtime package remediation

The prior scans of the five Bun production targets (API, web, worker, migrate, and operator) each contained one actionable medium finding: `CVE-2026-85091` in Alpine `zlib 1.3.2-r0`, fixed by `1.3.2-r1`. This was an OS package in the final runtime layer, not a build-only dependency or false positive. The API, web, and worker Dockerfiles now install the fixed Alpine package in their runtime stages; migrate and operator inherit the API runtime. The lockfile and application dependencies did not need changes.

All five production targets rebuilt successfully for `linux/amd64` from the existing Dockerfiles using `.env.production.example` and an isolated Compose project. Trivy 0.76.0 rescanned each exact final local Docker artifact against the existing database (`UpdatedAt` `2026-10-18T07:12:07.771859408Z`, downloaded `2026-10-18T11:29:07.494039118Z`). Each target changed from `0 critical / 0 high / 1 medium / 0 low / 0 unknown` to **zero findings in all severities**. Counts use Critical/High/Medium/Low/Unknown order. No result was suppressed. These image IDs are local build identities, not registry manifest digests.

| Target   | Before reference and image ID                                                                                    | After local reference and image ID                                                                                   | After findings |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- |
| API      | `care-goal15a-build-api:latest` — `sha256:c128b4ceaba06f5275250b87dae60b866ec202cd85d10c910a1bca82ce131943`      | `care-goal15a-zlib-apps-api:latest` — `sha256:141a3f5de4b6aab21807b1ffa5bbbc76354217dabec332bed84f04a01595dc43`      | `0/0/0/0/0`    |
| Web      | `care-goal15a-build-web:latest` — `sha256:aeec84bbdaab3ad4246492ecea91b62d2c4fd47e1b75646133a9445fb82a6858`      | `care-goal15a-zlib-apps-web:latest` — `sha256:5c19a8a31e0b2a7d35224dcf86d05a6a65fba43b6287602d8d7c8d8eeeda4158`      | `0/0/0/0/0`    |
| Worker   | `care-goal15a-build-worker:latest` — `sha256:ecbbc6910b4e7f1442ee7bf5cda9add3a1c2ef66ac5935aca7b599adc7fc1755`   | `care-goal15a-zlib-apps-worker:latest` — `sha256:2f676b02c4e1cb98a81266d62365ae4d6e5704adb12de85115769eb8ca90aaa7`   | `0/0/0/0/0`    |
| Migrate  | `care-goal15a-build-migrate:latest` — `sha256:c153a56bc6209f1367193ae9d0c0deba079c708b1ffba867c996cde9c327bf8e`  | `care-goal15a-zlib-apps-migrate:latest` — `sha256:0cbaf6f1d6a37e6c7e1fd91fa531e163d80676b95732807cb00bfdce89406c8c`  | `0/0/0/0/0`    |
| Operator | `care-goal15a-build-operator:latest` — `sha256:d982b7ee674d7e2b53866e33f4b47d74463379db5b32438918db69e3799d926d` | `care-goal15a-zlib-apps-operator:latest` — `sha256:39c40c024ad932e0ed5249d81e86975f851a55b3fca7af36b3aef24905463058` | `0/0/0/0/0`    |

The build and scan commands were:

```bash
DOCKER_CONFIG=<private temporary Docker config> docker compose \
  --env-file .env.production.example -p care-goal15a-zlib-apps \
  -f compose.yaml -f compose.production.yaml \
  build api web worker migrate operator

trivy image --image-src docker --skip-db-update --skip-java-db-update \
  --scanners vuln --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
  --format json --output <report.json> <exact-local-image-reference>
```

The per-image report hashes, historical before-scan hashes, exact CVE package records, build identities, platform, and database metadata are in `latestApplicationRuntimeRescan` in [goal15a-container-scan.json](security/goal15a-container-scan.json). The other custom infrastructure candidates retain their previously reported scan results; this update does not replace those records.

### Synthetic production Compose smoke

Compose validation used an explicit, mode-restricted synthetic env file and a private loopback-only Caddy port override. Project `care-goal15a-zlib-runtime-smoke` used its own Compose networks and named volumes. No production project, production secret, or production volume was accessed. The synthetic stack started PostgreSQL, Redis, SeaweedFS, Authentik server/worker, Mailpit, API, web, worker, and Caddy. Database and Redis health passed; migration and SeaweedFS bucket initialization exited successfully; API, web, worker, Authentik, and SeaweedFS reported healthy. The API and web started from the five patched application build artifacts.

Through Caddy, the web root, API `/health/ready`, and Authentik `/-/health/ready/` returned HTTP 200. A synthetic S3 object was uploaded, downloaded, byte-compared, and deleted successfully. This confirms the retained SeaweedFS server command, S3 config, startup, bucket initialization, and basic object operations remain compatible. The separate synthetic Authentik E2E suite remains 12/12 passing. It uses the dedicated E2E application servers and therefore is not a full browser journey through the exact production API/web image artifacts.

#### Exact-image invoice PDF and private-storage smoke

A second disposable project, `care-goal15a-prod-pdf-smoke`, completed the browser journey through the exact locally built and scanned API, web, and worker artifacts. The API image identity was `sha256:141a3f5de4b6aab21807b1ffa5bbbc76354217dabec332bed84f04a01595dc43`; web was `sha256:5c19a8a31e0b2a7d35224dcf86d05a6a65fba43b6287602d8d7c8d8eeeda4158`; worker was `sha256:2f676b02c4e1cb98a81266d62365ae4d6e5704adb12de85115769eb8ca90aaa7`. The stack also used the locally patched Authentik, PostgreSQL, Caddy, and SeaweedFS images recorded in `runtimeValidation.imageArtifacts` in the JSON scan record. All services reported healthy; migrations and SeaweedFS bucket initialization completed successfully.

The focused Playwright smoke authenticated a synthetic office administrator through Authentik, created and issued an invoice, downloaded its private PDF through the production API and SeaweedFS S3 path, parsed the PDF, checked private/no-store response headers, compared the stored SHA-256 and invoice identity, and confirmed an anonymous request returned no PDF bytes. Caddy served the web and API routes over the generated local CA. The test used reserved `.home.arpa` names, loopback-only Caddy ports, and a disposable Authentik database; no production secrets, volumes, or environment files were used. The browser-only local-certificate allowance and host resolver mapping are confined to `apps/web/container-smoke` and do not change application or deployment security settings.

Reproduction commands (start from fresh synthetic configuration and disposable project volumes; export only values from that synthetic setup before invoking Playwright):

```bash
docker compose --env-file <synthetic.env> -p care-goal15a-prod-pdf-smoke \
  -f compose.yaml -f compose.production.yaml -f <loopback-home-arpa-override.yaml> \
  --profile development config --quiet
docker compose --env-file <synthetic.env> -p care-goal15a-prod-pdf-smoke \
  -f compose.yaml -f compose.production.yaml -f <loopback-home-arpa-override.yaml> \
  --profile development up -d --no-build

# From apps/web, with synthetic WEB_ORIGIN, API_PUBLIC_URL, OIDC_ISSUER,
# MIGRATION_DATABASE_URL, and Authentik test token exported:
CARE_SYNTHETIC_HOSTS='care.home.arpa,api.care.home.arpa,login.care.home.arpa' \
NODE_OPTIONS="--require=$PWD/container-smoke/hosts.cjs" \
  ./node_modules/.bin/playwright test \
  --config container-smoke/playwright.config.ts \
  container-smoke/invoice-pdf.spec.ts

docker compose --env-file <synthetic.env> -p care-goal15a-prod-pdf-smoke \
  -f compose.yaml -f compose.production.yaml -f <loopback-home-arpa-override.yaml> \
  --profile development down --volumes --remove-orphans
```

The successful smoke run used the exact API/web/worker local image identities above. Registry publication and immutable remote references remain separate blockers; local Docker image IDs are not registry manifest digests.

Reproduction command template (generate fresh synthetic env/secret files with the repository's test setup; do not use `.env.production`):

```bash
docker compose --env-file <synthetic.env> -p care-goal15a-zlib-runtime-smoke \
  -f compose.yaml -f compose.production.yaml -f <loopback-ports.yaml> \
  --profile development config --quiet
docker compose --env-file <synthetic.env> -p care-goal15a-zlib-runtime-smoke \
  -f compose.yaml -f compose.production.yaml -f <loopback-ports.yaml> \
  --profile development up -d --no-build
# After recording checks, stop only this dedicated disposable project:
docker compose --env-file <synthetic.env> -p care-goal15a-zlib-runtime-smoke \
  -f compose.yaml -f compose.production.yaml -f <loopback-ports.yaml> \
  --profile development down --volumes --remove-orphans
```

### Registry publication blocker and remaining findings

The user approved `ghcr.io/woobble/care-platform` and stated that workflow authentication is configured. The checked-in repository has no publishing job or push script: `.github/workflows/ci.yml` grants `contents: read`, and the other checked-in workflows are CodeQL and dependency review. The available GitHub CLI login is `woobble` with `repo` but without `write:packages`; a non-secret `docker push` attempt for `ghcr.io/woobble/care-platform:api-goal15a-20261018` returned `denied`. No artifact was published and no registry digest was produced. The local API tag created for that attempt is not evidence of publication. The stated workflow authentication was not accessible from this execution environment.

The patched local Prometheus 3.15.0 candidate uses Go 1.26.9 and x/net 0.60.0 and has zero critical/high findings; the official upstream baseline had three high Go findings. It still needs publication and a verified registry digest. The official SeaweedFS 4.48 registry image remains verified at index `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`, with `linux/amd64` manifest `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. Production currently uses the separately patched local SeaweedFS build, whose local image ID and S3 smoke are recorded; the official upstream digest cannot stand in for the different patched artifact. The patched SeaweedFS image, the five application artifacts, Prometheus, and other locally built production images still need publication, verified registry digests, immutable Compose references, and scans against those remote artifacts.

Actionable residual findings remain release blockers: patched Authentik has one critical and 15 high IDs, Grafana has 12 high IDs, and the patched OSRM image has eight high IDs. Authentik's critical libxml2 advisory and current Authentik/OSRM OS-package findings have no fixed versions in the current scan data; repository checks found no newer Debian package candidates. Grafana's Go dependencies have fixed versions reported, but direct registry checks at `2026-10-18T15:19:08Z` found no 13.2.5 or 13.3.0 image. The official Grafana Ubuntu variant retained the same findings. Exact package versions, advisory IDs, fixed-version data, and origins are retained in the structured Trivy report. Authentik is publicly reachable through the intended login host; private networking is not treated as a waiver. Grafana and OSRM are optional profiles with restricted ingress, but their findings remain actionable and are not accepted. No security-owner risk acceptance is recorded, and no finding is suppressed.

### Quality gates

The final root checks passed: `bun run lint` (33/33), `bun run format:check` (685 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (OpenAPI generation and 32/32). `bunx oxlint --deny-warnings --format=agent`, `git diff --check`, Graphify update, and production Compose validation with an empty inherited environment and `.env.production.example` also passed. The latest full synthetic Authentik E2E passed 12/12 with zero failures or skips; the focused `container-smoke` browser test additionally verified Authentik sign-in, invoice issuance, and private PDF retrieval through the exact production API image and SeaweedFS.

### Current Goal 15A gate status

| Gate                                                | Status  | Evidence and remaining work                                                                                                                                                                                             |
| --------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production image inventory and local artifact scans | Pass    | All production references are inventoried; latest local infrastructure scans plus fresh scans of all five final Bun images are recorded. No pushed artifact is claimed as scanned.                                      |
| Application production builds                       | Pass    | API, web, worker, migrate, and operator built from production Dockerfiles.                                                                                                                                              |
| SeaweedFS upstream release resolution               | Pass    | Official 4.48 index and linux/amd64 manifest were directly verified.                                                                                                                                                    |
| Patched SeaweedFS immutable registry digest         | Blocked | Patched candidate has only a local artifact identity; publication was denied.                                                                                                                                           |
| Synthetic runtime compatibility                     | Pass    | Exact scanned API/web/worker artifacts completed startup, Authentik sign-in, invoice issuance, private PDF retrieval through SeaweedFS, PDF parsing, stored hash/identity checks, and anonymous non-disclosure.         |
| GHCR publication and custom-image immutability      | Blocked | Approved namespace is known; authenticated publishing path is unavailable here and registry rejected the push.                                                                                                          |
| Actionable critical/high findings                   | Fail    | Patched Authentik critical/high, Grafana high, and patched OSRM high findings remain without security-owner dispositions. Patched Prometheus has zero critical/high; its upstream findings remain a traceable baseline. |
| Other release gates and production clearance        | Fail    | Accessibility and historical secret-isolation review remain independently Fail/Blocked; no other gate is promoted by this container update.                                                                             |

Goal 15A remains **incomplete**, and the Care Platform is **not cleared for production**. The next required input is the name/location of the configured authenticated publishing workflow or a runner where it can execute. Then publish the patched artifacts, verify and scan every exact registry digest, pin immutable Compose references, and resolve or obtain explicit security-owner dispositions for the remaining actionable critical/high findings.

## 27. Goal 15A continuation — Grafana runtime remediation and signed-plugin residuals — 2026-10-18

### Grafana inventory, build, and exact artifact scan

Production Compose now builds Grafana as `care-platform-grafana:13.2.4-kin-openapi0.149.0-pruned` from [infra/grafana/Dockerfile](../infra/grafana/Dockerfile). The Dockerfile starts from the verified official `grafana/grafana:13.2.4` index digest `sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f`, builds the Grafana server at source commit `af4a33e3786594ad72f72d97e6744010330c2977` using the Go 1.26.9 builder pinned to `sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade`, upgrades `github.com/getkin/kin-openapi` from v0.144.0 to v0.149.0, and keeps the official signed Prometheus datasource plugin. The platform configures only Prometheus; unused bundled datasource plugins are removed from the final filesystem. No signature validation setting was weakened.

The exact linux/amd64 local final image was built successfully and inspected as `sha256:9d2d78f40b5961ad953f79c2ade9b97cbca4002aeb0e639472502b146243b8ee`. Trivy 0.76.0 scanned that final image with the vulnerability database updated at `2026-10-18T07:12:07.771859408Z` (downloaded at `2026-10-18T11:29:07.494039118Z`). The official Grafana 13.2.4 baseline was 0 critical / 12 high / 15 medium / 1 low / 1 unknown; the custom final image is **0 critical / 4 high / 14 medium / 1 low / 1 unknown** (four high package instances across three unique CVE IDs). The five kin-openapi high advisories are absent from the rebuilt server. All four remaining high instances are in the retained signed Prometheus plugin: `CVE-2026-78667` (`stdlib` v1.27.1, fixed in 1.27.2), `CVE-2026-78669` (`stdlib` v1.27.1 and `golang.org/x/net` v0.59.0, fixed in 1.27.2 and 0.60.0), and `CVE-2026-97031` (`stdlib` v1.27.1, fixed in 1.27.2). The JSON Trivy report SHA-256 is `9839aa13ae55f1cd48ab5b8fa7926ca3e5ae91230f409e462216e83bd8b7113a`; exact installed/fixed package data is in `latestGrafanaPatchedCandidate` in [goal15a-container-scan.json](security/goal15a-container-scan.json).

The plugin fixes are available according to Trivy, but the official Grafana plugin catalog currently lists 13.2.3 as the latest Prometheus datasource release, matching the bundled plugin; no newer supported signed plugin/image was available in the checked Grafana 13.2.4 distribution. Grafana documents that the Prometheus plugin can be updated independently starting with 13.2, so the catalog should be checked again before a future rebuild ([plugin update documentation](https://github.com/grafana/grafana/blob/main/docs/sources/datasources/prometheus/_index.md), [official plugin changelog](https://github.com/grafana/grafana-prometheus-datasource/blob/main/CHANGELOG.md)). An experimental rebuilt plugin was rejected after Grafana reported its signature invalid; the final candidate retains the official signed plugin and does not bypass signature enforcement. Grafana remains an optional, loopback-bound observability service without a Caddy route, but these findings are not waived because of that exposure boundary. Keep the profile disabled until a supported signed fix is available and rescanned, or the security owner explicitly accepts these exact residual findings.

### SeaweedFS registry digest revalidation

At `2026-10-18T15:56:55Z`, a direct Docker Registry v2 request confirmed the intended official `chrislusf/seaweedfs:4.48` index at `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`. Its `linux/amd64` descriptor points to `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`; fetching that digest directly returned HTTP 200 with the same `Docker-Content-Digest`. This independently revalidates the upstream tag-to-platform-manifest mapping. Production Compose still builds the separately patched SeaweedFS artifact locally, so this verified upstream digest is not a digest for the patched deployable image and cannot satisfy its immutable-reference gate. The patched local artifact's scan and S3/runtime compatibility evidence remain recorded in the preceding sections.

The same direct registry check returned HTTP 404 for the candidate Grafana `13.2.5`/`13.3.0`, Prometheus `v3.15.1`/`v3.16.0`, Authentik `2026.8.5`/`2026.8.6`/`2026.9.0`/`2026.11.0`, and OSRM `v26.10.1-debian`/`v26.11.0-debian` tags. These are time-specific registry observations, not claims about later releases; exact results and the SeaweedFS manifest verification are in `latestRegistryManifestRefresh` in [goal15a-container-scan.json](security/goal15a-container-scan.json).

### Synthetic runtime and production configuration

Production Compose resolved `grafana` to the exact local candidate tag and linux/amd64 platform using an empty inherited environment plus `.env.production.example` and a synthetic, mode-restricted Grafana password file. A fresh project, `care-goal15-grafana-final-smoke`, used only its own disposable Grafana/Prometheus volumes and private network. Grafana `/api/health` returned database `ok`, version `13.2.4`, and the expected source commit. Prometheus `/-/ready` returned ready both locally and from the Grafana container. The provisioned Prometheus datasource health endpoint returned HTTP 200 / `OK`, and a Prometheus `up` query through Grafana `/api/ds/query` returned HTTP 200 with three frames and zero query errors. The test containers and network were removed. Docker initially returned socket EOF during volume cleanup; after it became available again, I verified the remaining volume was labeled for `care-goal15-grafana-final-smoke`, removed it, and confirmed no smoke containers or project volumes remained. The cleanup commands targeted only the two disposable Grafana smoke projects; the separate synthetic Authentik E2E project was not targeted. No production secret, environment file, project, or volume was read or started.

Reproduction commands (use a newly generated synthetic password file; never use `.env.production`):

```bash
env -i PATH=/usr/bin:/bin DOCKER_CONFIG=<synthetic-docker-config> docker compose \
  --env-file .env.production.example --env-file <synthetic-grafana.env> \
  -p care-goal15-grafana-final-smoke -f compose.yaml -f compose.production.yaml \
  --profile observability config --format json
env -i PATH=/usr/bin:/bin DOCKER_CONFIG=<synthetic-docker-config> docker compose \
  --env-file .env.production.example --env-file <synthetic-grafana.env> \
  -p care-goal15-grafana-final-smoke -f compose.yaml -f compose.production.yaml \
  --profile observability build grafana
trivy --cache-dir <scanner-cache> image --image-src docker --skip-db-update \
  --skip-java-db-update --scanners vuln --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
  --format json --output <report.json> \
  care-platform-grafana:13.2.4-kin-openapi0.149.0-pruned
# Start only the fresh synthetic project with the same explicit environment,
# check Grafana health and the Prometheus datasource/query, then remove its volumes.
```

The final Compose tag is a local build reference, not a registry digest. The user selected `ghcr.io/woobble/care-platform` and confirmed workflow authentication is configured. The repository and this execution environment expose no publishing workflow/runner: the checked-in workflows contain no image-publish job, the available GHCR login lacks `write:packages`, and a push was denied. No Grafana or other custom artifact was published. The local image ID above is not used as a registry digest. Once the authenticated workflow is available, publish the exact candidate, verify its linux/amd64 manifest digest directly at GHCR, pin the version and digest in Compose, and scan that exact registry artifact before considering it deployable.

### Current container gate and independent release status

| Gate                                            | Status                  | Current evidence                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafana candidate build and final-artifact scan | Pass for local artifact | Exact image inspected and scanned; 0 critical, 4 high instances / 3 unique CVEs, 14 medium, 1 low, 1 unknown.                                                                                                                                           |
| Grafana synthetic runtime compatibility         | Pass for tested scope   | Health, Prometheus connectivity, configured datasource health, and `up` query passed in the isolated project.                                                                                                                                           |
| Grafana immutable registry reference            | Blocked                 | Candidate is unpublished; no GHCR manifest digest is claimed.                                                                                                                                                                                           |
| Actionable critical/high findings               | Fail                    | Authentik remains at 1 critical / 15 high, Grafana at 4 high instances / 3 IDs, and OSRM at 8 high; no security-owner acceptance is recorded. Prometheus and the patched application images remain at zero critical/high in their recorded local scans. |
| Overall production release                      | **Fail**                | Container publication and residual findings remain open; accessibility and historical secret-isolation gates retain their independently recorded Fail/Blocked status. No other gate is promoted here.                                                   |

Previously recorded repository quality gates remain the last full root run; this continuation ran focused Grafana build, Trivy scan, synthetic Compose/runtime checks, and report validation only. See `latestGrafanaPatchedCandidate` for this continuation's exact command metadata. The Care Platform remains **not cleared for production**.

## 28. Goal 15 continuation — localized pagination accessibility — 2026-10-18

Review found that `DataPagination` rendered localized visible Previous/Next text, but the shared `PaginationPrevious` and `PaginationNext` wrappers supplied hard-coded English `aria-label` values. Since the link text can be visually hidden at smaller breakpoints, German screen-reader users would hear English action names. `DataPagination` now passes the existing localized `Common.actions.previous` and `Common.actions.next` messages as the active links' accessible names. Numbered page links already expose the active page with `aria-current="page"`.

The focused Office-shell E2E set the synthetic `CARE_LOCALE=de` cookie, opened the Demo Care client list (42 synthetic clients) at page size 10, and verified the German pagination landmark, `Weiter` and `Zurück` link names, navigation from page 1 to page 2, and the current-page marker. `office-shell.spec.ts` passed **1/1, zero failures, exit code 0** in 41.2 seconds using `.env.test` and the isolated `care-goal15-e2e-rerun` stack. Existing transient Next.js destination-stream and PostgreSQL query warnings recurred; the test passed. The E2E project remains isolated and running. No production configuration or data was used.

Reproduce from `apps/web` with the dedicated E2E stack healthy:

```bash
NODE_ENV=test PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BROWSERS_PATH=<browser-cache> \
  bun --env-file=../../.env.test run test:e2e -- office-shell.spec.ts
```

This closes the localized pagination-name defect and verifies current-page semantics on this route. Accessibility remains **Fail** because full dialog/Sheet coverage, rendered-state contrast, broad error-announcement checks, reduced-motion coverage across workflows, and keyboard review of every high-frequency action are still incomplete. No WCAG conformance is claimed.

After this UI change, the root quality gates passed: `bun run lint` (33/33), `bun run format:check` (685 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (OpenAPI generation and 32/32 tasks). Strict Oxlint, production Compose config validation with `.env.production.example`, and `git diff --check` also passed. The focused Office-shell E2E was the only E2E rerun for this localized change; the prior full Authentik suite remains 12/12 with zero skips.

## 29. Goal 15A continuation — OSRM minimal runtime remediation — 2026-10-18

### Finding and remediation

The previous production OSRM candidate, `care-platform-osrm:v26.10.0-debian-security`, was the official Debian runtime with OpenSSL package updates. Its exact local linux/amd64 scan had **0 critical / 8 high / 29 medium / 33 low / 3 unknown** findings. The eight high IDs were `CVE-2025-69720` (ncurses/tinfo), `CVE-2026-16742` (systemd/udev), `CVE-2026-54369` (libacl), `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, and `CVE-2026-78410` (util-linux/bsdutils family), and `CVE-2026-9538` (perl-base). They all came from Debian packages in the full runtime image; Trivy reported no fixed versions in the checked package repository. The exact old-image report SHA-256 was `ade9106bee78666bc957c51e87d5846a9bb051724029456645bf0bad625e0e1b`.

The final image now starts from the pinned official OSRM v26.10.0 Debian release, but copies only `/usr/local/bin/osrm-routed` into the pinned Google Distroless Debian 13 C++ runtime. The source index digest is `sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f`; its `linux/amd64` manifest is `sha256:84074e1e66bd7eedc7fe52ece0f4deb2e6865454855ae77675c5f753d281fd58`. The final base is `gcr.io/distroless/cc-debian13:latest@sha256:480c5ff295373a2223ae2a08b7793e98c8f22c90f6ae9b20fe1f61feffda72ea`, the directly verified `linux/amd64` manifest under index digest `sha256:159783207c2cd44c2aa5715961d13c8612368ac9bd450f887e3f08fc8ea461e3`. Distroless publishes and updates this image family under its Debian 13 support policy ([official image catalog and support policy](https://github.com/GoogleContainerTools/distroless#what-images-are-available)). A direct Trivy scan of this exact runtime base found 0 critical / 0 high / 23 medium / 8 low / 0 unknown.

This is runtime reduction rather than an ignore rule: the final image does not contain the vulnerable full Debian utilities/libraries, shell, or package manager. It retains the C/C++ runtime supplied by Distroless, the official `osrm-routed` binary, and a small static launcher. The launcher validates the selected dataset name, checks the required `.osrm.fileIndex` sidecar, and `exec`s the same `osrm-routed --algorithm mld <dataset>` command used previously. Its health mode validates the configured route probe and checks that OSRM returns HTTP 200 with response code `Ok`. Production Compose overrides the previous Bash startup and health scripts, but keeps the `linux/amd64` platform, read-only `/data` mount, private network, no host port, and five-minute start period. The container continues to run as UID 0 because generated dataset directories use mode `0700`, preserving the existing mounted-storage permission contract.

### Final build and scan

The final linux/amd64 image built successfully as `care-platform-osrm:v26.10.0-distroless-debian13-go1.26.9`. Its local Docker image identity is `sha256:8401847786c21571ac8227253a75ce985f4ef72e8c603a3c5150ad1f16c0ba76`. This is a **local build identity, not a registry manifest digest**. Trivy 0.76.0 (binary SHA-256 `1f889576636db0623539cb339df7d06c40ebf39e7919489eafa1160e29808f19`) scanned that exact final image with the database updated at `2026-10-18T07:12:07.771859408Z` and downloaded at `2026-10-18T11:29:07.494039118Z`. The final scan is **0 critical / 0 high / 23 medium / 8 low / 0 unknown**; the static launcher also has zero critical/high findings. The JSON report SHA-256 is `cc88e67d08570e5d208d66c24687434a5da1c419709721ee95064c9ed48c96f7`. No scanner exclusions or ignore rules were added.

### Synthetic runtime compatibility

The tracked fixture in `infra/osrm/testdata/` contains a three-node synthetic OSM graph, a dataset name, and a route probe. The pinned official OSRM image successfully ran `osrm-extract`, `osrm-partition`, and `osrm-customize` against that fixture. The production Compose routing profile was then started in the disposable `care-goal15-osrm-final` project using `.env.production.example` and a temporary override that mounted only the generated synthetic files read-only. `docker compose up --wait` reported the service **Healthy**; running the in-container launcher health mode returned successfully for the synthetic route. The project container and network were removed; no named volumes were created or removed.

Compose configuration was rendered under `env -i` with the explicit example env file and showed the expected image tag, `linux/amd64`, launcher entrypoint, reset command, read-only synthetic data mount, no published ports, `care-private` network, and launcher healthcheck. No `.env.production`, production project, secret, or production volume was used. No application, identity, storage, Caddy, or worker configuration was changed by this OSRM-only runtime update.

Reproduce the build, scan, and isolated routing smoke with the checked-in synthetic fixture:

```bash
docker buildx build --load --platform linux/amd64 \
  --tag care-platform-osrm:v26.10.0-distroless-debian13-go1.26.9 \
  --file infra/osrm/Dockerfile infra/osrm
trivy --cache-dir <scanner-cache> image --image-src docker --skip-db-update \
  --skip-java-db-update --platform linux/amd64 --scanners vuln \
  --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json \
  --output <report.json> care-platform-osrm:v26.10.0-distroless-debian13-go1.26.9

mkdir -p /tmp/care-osrm-synthetic/current
cp infra/osrm/testdata/* /tmp/care-osrm-synthetic/current/
docker run --rm -v /tmp/care-osrm-synthetic:/data \
  ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f \
  osrm-extract -p /opt/car.lua /data/current/synthetic.osm
docker run --rm -v /tmp/care-osrm-synthetic:/data \
  ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f \
  osrm-partition /data/current/synthetic.osrm
docker run --rm -v /tmp/care-osrm-synthetic:/data \
  ghcr.io/project-osrm/osrm-backend:v26.10.0-debian@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f \
  osrm-customize /data/current/synthetic.osrm
# Use a disposable Compose override that mounts only /tmp/care-osrm-synthetic at /data.
docker compose --profile routing --project-name care-osrm-synthetic \
  --env-file .env.production.example -f compose.yaml -f compose.production.yaml \
  -f <synthetic-osrm-override.yaml> up -d --wait --no-build osrm
docker compose --profile routing --project-name care-osrm-synthetic \
  --env-file .env.production.example -f compose.yaml -f compose.production.yaml \
  -f <synthetic-osrm-override.yaml> exec --no-TTY osrm \
  /usr/local/bin/care-osrm-launcher healthcheck
docker compose --profile routing --project-name care-osrm-synthetic \
  --env-file .env.production.example -f compose.yaml -f compose.production.yaml \
  -f <synthetic-osrm-override.yaml> down --remove-orphans
```

### Remaining container-security blockers

OSRM's prior eight high findings are resolved in the exact local runtime candidate, with no security-owner risk acceptance needed for those absent packages. Authentik still has one critical and 15 high IDs, and Grafana still has four high package instances across three IDs; neither has an approved risk acceptance. The platform still uses unpublished local custom images, including this OSRM candidate and the patched SeaweedFS image, so there is no verified GHCR digest or scan of those registry artifacts. The user approved `ghcr.io/woobble/care-platform` and said workflow authentication is configured, but the connected `woobble/care` repository has no publish workflow and this shell's GitHub CLI session lacks `write:packages`; the configured authenticated runner has not been identified here. Goal 15A remains **incomplete**, and the platform remains **not cleared for production**.

After this section's container update, the repository quality gates passed: `bun run lint` (33/33), `bun run format:check` (685 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (OpenAPI generation and 32/32 tasks, including the Next.js production build with `NODE_ENV=test`). Strict Oxlint, synthetic production Compose validation, OSRM final-image build and Trivy scan, synthetic route health smoke, `git diff --check`, and Graphify update also passed. The latest full Authentik E2E remains 12/12 with zero failures or skips; it was not rerun because this continuation changed only the optional OSRM routing runtime. Prior focused API/worker integration and invoice PDF retrieval evidence remains recorded above. These results do not resolve Authentik or Grafana critical/high findings or the registry publication blocker.

## 30. Goal 15 continuation — shared-form validation accessibility and output review — 2026-10-18

### Form validation accessibility

A focused review of `RHFActionForm` found that its validation summary nested one `role="alert"` inside another, invalid native controls were not associated with the summary or marked invalid, and failed submissions did not reliably focus the first invalid field while the form fieldset was being disabled during validation. The shared form now exposes one alert, associates invalid native controls through `aria-invalid` and `aria-describedby`, clears those attributes after correction, and focuses the first visible invalid named control after the form's disabled state settles. A focused Authentik client E2E explicitly exercised the Zod/RHF validation path and verified a single announcement, required text, first-field focus, the error association, and cleanup after correction. It passed **1/1, zero failures, exit code 0** in 1.4 minutes with `.env.test` and the isolated synthetic E2E stack. The two failed diagnostic attempts exposed the focus timing issue and were followed by the passing run; their temporary Playwright output directories were removed. No production environment or data was used.

This closes the tested shared-form validation defect, not the accessibility gate. Full dialog/Sheet coverage, rendered-state contrast, reduced-motion coverage across workflows, and keyboard review of every high-frequency action remain incomplete. No WCAG conformance is claimed.

### Process-output exposure review

During this continuation, a process-list command included shell-wrapper arguments in its output; those arguments contained expanded environment setup. The exact values and full exposure extent are not independently established in this review. No values were copied into repository files or reproduced in this report. This is a second process-output exposure requiring review alongside the earlier historical capture documented in section 15. The secret-isolation gate remains **Blocked** pending review of the relevant tool output, identification of any non-synthetic values, and the security owner's decision on appropriate credential rotation. This report does not assert that a production credential was exposed or that no credential was exposed. No `.env.production` was read or loaded during this continuation.

The focused test reproduction command was:

```bash
PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BROWSERS_PATH=<browser-cache> \
  bun --env-file=.env.test run --filter @care/web test:e2e -- \
  e2e/authentik-client.spec.ts --output=<temporary-playwright-output>
```

Accessibility remains **Fail**, container security remains **Fail**, secret isolation remains **Blocked**, and the platform remains **not cleared for production**. This focused result does not change the independent status of recovery, performance, production configuration, or other release gates.

### Full Authentik E2E and final repository gates

The full browser suite was rerun after the shared-form change against a fresh synthetic Compose project, `care-goal15-authentik-e2e`, using `compose.yaml`, `compose.e2e.yaml`, and `compose.authentik-patched-e2e.yaml`. The patched local Authentik image, PostgreSQL, Redis, Mailpit, and official SeaweedFS all reached healthy status; SeaweedFS initialization, migrations, the Demo Care seed, and the fixed-date synthetic pilot seed succeeded. The runner used `.env.test` only. Host ports 19060 and 19061 were already allocated, so only the synthetic host mappings were moved to Authentik 19160, S3 19161, and filer 19162; the OIDC and S3 test endpoints were overridden to match. The full Authentik E2E passed **12/12, zero failures, zero skips, exit code 0** in 5.0 minutes. The run verified the shared-form validation assertions in the normal client workflow. The dedicated containers, network, and disposable PostgreSQL/Redis/SeaweedFS volumes were removed afterward with `down --volumes --remove-orphans`; no other Compose project or volume was used.

Reproduction (with the selected ports free and the local patched Authentik image available):

```bash
export CARE_E2E_AUTHENTIK_PORT=19160 CARE_E2E_S3_PORT=19161 CARE_E2E_FILER_PORT=19162
export AUTHENTIK_WEB__BASE_URL=http://localhost:19160
export OIDC_ISSUER=http://localhost:19160/application/o/care-platform/
export S3_ENDPOINT=http://localhost:19161
docker compose --env-file .env.test --project-name care-goal15-authentik-e2e \
  -f compose.yaml -f compose.e2e.yaml -f compose.authentik-patched-e2e.yaml \
  --profile development up -d --wait
docker compose --env-file .env.test --project-name care-goal15-authentik-e2e \
  -f compose.yaml -f compose.e2e.yaml -f compose.authentik-patched-e2e.yaml \
  --profile bootstrap run --rm --no-deps seaweedfs-init
bun --env-file=.env.test run migrate
bun --env-file=.env.test run seed
PILOT_DEDICATED_TEST_DATABASE=true PILOT_TEST_DATABASE_PORT=15438 \
  PILOT_REFERENCE_DATE=2026-10-12 bun --env-file=.env.test run pilot:seed
PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BROWSERS_PATH=<browser-cache> \
  bun --env-file=.env.test run --filter @care/web test:e2e
# Remove only the dedicated synthetic project after the run:
docker compose --env-file .env.test --project-name care-goal15-authentik-e2e \
  -f compose.yaml -f compose.e2e.yaml -f compose.authentik-patched-e2e.yaml \
  down --volumes --remove-orphans
```

After the final E2E fixture change, the repository gates passed: `bun run lint` (33/33), `bun run format:check` (685 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (32/32 tasks, including the Next.js production build under `NODE_ENV=test`). `bunx oxlint --deny-warnings --format=agent` passed. Graphify was refreshed after source changes. The final `git diff --check` result is recorded with the closing workspace audit.

These browser and repository checks do not resolve the container registry publication blocker or Authentik/Grafana critical/high findings. Accessibility remains **Fail**, secret isolation remains **Blocked**, production external configuration remains untested, and the platform remains **not cleared for production**. This continuation does not change the independently verified status of recovery, performance, or other release gates.

## 32. Goal 15B — controlled GHCR publication and provenance gate — 2026-10-18

### Production image inventory and scan baseline

The production Compose configuration requires 15 images: 13 locally patched artifacts (API, web, worker, migration runner, operations CLI, PostgreSQL, Authentik shared by server and worker, SeaweedFS, AWS CLI initializer, Caddy, Grafana, Prometheus, and OSRM), plus digest-pinned upstream Redis and OpenTelemetry Collector images. Mailpit is development-only. Production Compose still points at local image names for the 13 patched candidates. No patched candidate below has a verified GHCR manifest digest.

The existing exact local candidate scans recorded in [goal15a-container-scan.json](security/goal15a-container-scan.json) used Trivy **0.76.0**, platform **linux/amd64**, and vulnerability database `UpdatedAt=2026-10-18T07:12:07.771859408Z`. The application scan set was observed at `2026-10-18T14:28:18Z`; the broader inventory scan was completed at `2026-10-18T12:43:40Z`. The changed migration runner was rescanned at the same database timestamp. Grafana, Redis, and OpenTelemetry were rescanned in this update with Trivy **0.76.0**, platform **linux/amd64**, and database `UpdatedAt=2026-10-18T13:11:41.355239553Z`. The table reports unique Critical/High vulnerability IDs, not package-instance counts. Local Docker IDs identify those scan artifacts and must not be used as registry digests.

| Production image              | Last scanned image artifact or immutable reference                                                                                                                                                                                                                     |             Critical / High IDs |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------: |
| API                           | `care-goal15a-zlib-apps-api:latest` — `sha256:141a3f5de4b6aab21807b1ffa5bbbc76354217dabec332bed84f04a01595dc43`                                                                                                                                                        |                           0 / 0 |
| Web                           | `care-goal15a-zlib-apps-web:latest` — `sha256:5c19a8a31e0b2a7d35224dcf86d05a6a65fba43b6287602d8d7c8d8eeeda4158`                                                                                                                                                        |                           0 / 0 |
| Worker                        | `care-goal15a-zlib-apps-worker:latest` — `sha256:2f676b02c4e1cb98a81266d62365ae4d6e5704adb12de85115769eb8ca90aaa7`                                                                                                                                                     |                           0 / 0 |
| Migration runner              | `care-goal15b-migrate:local` — `sha256:cb9ddaf277695b9732d96ee1d8c45a8a302346d7e12bf967f4f19a1796d97e1b`                                                                                                                                                               |                           0 / 0 |
| Operations CLI                | `care-goal15a-zlib-apps-operator:latest` — `sha256:39c40c024ad932e0ed5249d81e86975f851a55b3fca7af36b3aef24905463058`                                                                                                                                                   |                           0 / 0 |
| PostgreSQL                    | `care-platform-postgres:18.6-go1.26.9` — `sha256:c4484c2bbb7e6c8593d69ae18926f3ae7111605b8311df6855e8987564f5afdc`                                                                                                                                                     |                           0 / 0 |
| Authentik (server and worker) | `care-platform-authentik:2026.8.4-openssl-deb13u3-urllib3-2.8.0` — `sha256:28d4c261350d2b96a57463295e73dc77b18b55a51e1aeea7daa297dccf77679e`                                                                                                                           |                      **1 / 15** |
| Redis                         | `redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0` (linux/amd64 child `sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23`); [Trivy report](security/goal15b-redis-trivy.json)                              |                           0 / 0 |
| OpenTelemetry Collector       | `otel/opentelemetry-collector-contrib:0.163.1@sha256:1175b03003053962012f5a231f5567f66a3e8fdb960c7835c0e48f7aa1555806` (linux/amd64 child `sha256:45c3ed5eb9eb71e3e6ade7fa67aed000e5f68bb22fe730a6fa66a2504077cfce`); [Trivy report](security/goal15b-otel-trivy.json) |                           0 / 0 |
| SeaweedFS                     | `care-platform-seaweedfs:4.48-go1.26.9-xnet0.60.0` — `sha256:a374e36140a81524c3bc7ec00e9b03aca79c4883f8d0a9c673d62bac6ca309df`                                                                                                                                         |                           0 / 0 |
| AWS CLI initializer           | `care-platform-aws-cli:2.37.4-al2023-patched` — `sha256:62e1021512afaf5e73eb67beef0269215ef406c466bb3710fe067d5513e28be7`                                                                                                                                              |                           0 / 0 |
| Caddy                         | `care-platform-caddy:2.11.7-go1.26.9` — `sha256:3f7fd8a878e0880f26bfbf8c5ceb417865c86453e6c99b2485aa1e96501dc7ae`                                                                                                                                                      |                           0 / 0 |
| Grafana                       | `care-platform-grafana:13.2.4-kin-openapi0.149.0-pruned` — `sha256:b380e5624fea8b1b2bc12ccddd405227ec8e4a915f17abd1ca2f0d5f99591bc8`                                                                                                                                   | **0 / 3** (4 package instances) |
| Prometheus                    | `care-platform-prometheus:v3.15.0-go1.26.9-xnet0.60.0` — `sha256:fd24214cf8d6927b89b218423c48f10feecb2ae4d422280006ca56965ecfc89c`                                                                                                                                     |                           0 / 0 |
| OSRM                          | `care-platform-osrm:v26.10.0-distroless-debian13-go1.26.9` — `sha256:8401847786c21524ac8227253a75ce985f4ef72e8c603a3c5150ad1f16c0ba76`                                                                                                                                 |                           0 / 0 |

The pre-remediation upstream references and each recorded before/after scan are preserved in the `beforeAfter` records of [goal15a-container-scan.json](security/goal15a-container-scan.json). These include PostgreSQL `1 Critical / 24 High → 0 / 0`, SeaweedFS `0 / 3 → 0 / 0`, Caddy `0 / 3 → 0 / 0`, OpenTelemetry `0 / 3 → 0 / 0`, Prometheus `0 / 3 → 0 / 0`, and OSRM `0 / 10 → 0 / 0`; Authentik moved from `1 / 20` to `1 / 15`. Grafana's upstream baseline increased from `0 / 11` to `0 / 12` when Trivy's refreshed database added CVE-2026-100349; the latest signed local image is `0 / 3`. Redis remained `0 / 0`. Mailpit was scanned at `0 / 0` after updating from its `0 / 3` development-only baseline; it is not in production Compose.

The remaining Authentik findings are `CVE-2026-6653` (Critical) and 15 High IDs: `CVE-2025-69720`, `CVE-2026-16742`, `CVE-2026-54369`, `CVE-2026-74860`, `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, `CVE-2026-78410`, `CVE-2026-86138`, `CVE-2026-86139`, `CVE-2026-86140`, `CVE-2026-86142`, `CVE-2026-86143`, `CVE-2026-86144`, and `CVE-2026-9538`. They remain in the final Authentik runtime: `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`, ncurses `6.5+20250216-2`, systemd/udev `257.13-1~deb13u1`, `libacl1 2.3.2-2+b1`, util-linux `2.41.5-0+deb13u1`, and `perl-base 5.40.1-6+deb13u1`. The scan contained no fixed Trixie version for these installed packages; the Perl advisory is deferred. Authentik serves identity requests through Caddy but remains an externally reachable application surface. Routing and container privilege restrictions do not resolve these findings.

Grafana retains three unique High IDs in four package instances in its bundled, signed Prometheus datasource plugin binary: `CVE-2026-78669` is reported for both `golang.org/x/net v0.59.0` (fixed at `v0.60.0`) and Go stdlib `v1.27.1` (fixed at `v1.27.2`); `CVE-2026-78667` and `CVE-2026-97031` are also reported for Go stdlib `v1.27.1` (fixed at `v1.26.9` or `v1.27.2`). The patched main Grafana executable and removal of unused bundled plugins do not replace the active datasource binary. A local rebuild of the plugin backend from the official v13.2.3 source at commit `6d21418acde6ce31c9f7a6418a88758842a881bb` with Go 1.27.2 and `x/net` 0.60.0 removed these three IDs from Trivy, but replacing the binary invalidated the vendor `MANIFEST.txt` signature: Grafana did not register the Prometheus plugin and `/api/ds/query` returned `plugin not registered`. That experimental image was rejected and is not a deployable remediation. The official plugin release remains v13.2.3; no signed corrected plugin build was available in the registry checks. Keep Grafana blocked pending a supported signed corrected release/build or the security owner's decision on the exact package findings and exposure. The official [Prometheus datasource changelog](https://github.com/grafana/grafana-prometheus-datasource/blob/main/CHANGELOG.md) records v13.2.3 as the latest release observed in this assessment.

#### Security-owner disposition packet — decision pending

These are the only remaining Critical/High findings in the 13 patched local production candidates. Package status and fixed-version evidence below is from the recorded Trivy 0.76.0 scan data; “none reported” means the database did not provide a fixed package version for this installed Debian release at scan time.

| Image / severity     | Advisory IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Affected package(s), installed version                                                                                                                                | Fixed version / status                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Authentik / Critical | [`CVE-2026-6653`](https://avd.aquasec.com/nvd/cve-2026-6653)                                                                                                                                                                                                                                                                                                                                                                                                   | `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`                                                                                                                        | None reported; affected in final runtime                                        |
| Authentik / High     | [`CVE-2025-69720`](https://avd.aquasec.com/nvd/cve-2025-69720)                                                                                                                                                                                                                                                                                                                                                                                                 | `libncursesw6`, `libtinfo6`, `ncurses-base`, `ncurses-bin 6.5+20250216-2`                                                                                             | None reported; affected                                                         |
| Authentik / High     | [`CVE-2026-16742`](https://avd.aquasec.com/nvd/cve-2026-16742)                                                                                                                                                                                                                                                                                                                                                                                                 | `libsystemd0`, `libudev1 257.13-1~deb13u1`                                                                                                                            | None reported; affected                                                         |
| Authentik / High     | [`CVE-2026-54369`](https://avd.aquasec.com/nvd/cve-2026-54369)                                                                                                                                                                                                                                                                                                                                                                                                 | `libacl1 2.3.2-2+b1`                                                                                                                                                  | None reported; affected                                                         |
| Authentik / High     | [`CVE-2026-74860`](https://avd.aquasec.com/nvd/cve-2026-74860), [`CVE-2026-86138`](https://avd.aquasec.com/nvd/cve-2026-86138), [`CVE-2026-86139`](https://avd.aquasec.com/nvd/cve-2026-86139), [`CVE-2026-86140`](https://avd.aquasec.com/nvd/cve-2026-86140), [`CVE-2026-86142`](https://avd.aquasec.com/nvd/cve-2026-86142), [`CVE-2026-86143`](https://avd.aquasec.com/nvd/cve-2026-86143), [`CVE-2026-86144`](https://avd.aquasec.com/nvd/cve-2026-86144) | `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`                                                                                                                        | None reported; affected                                                         |
| Authentik / High     | [`CVE-2026-76642`](https://avd.aquasec.com/nvd/cve-2026-76642), [`CVE-2026-78408`](https://avd.aquasec.com/nvd/cve-2026-78408), [`CVE-2026-78409`](https://avd.aquasec.com/nvd/cve-2026-78409), [`CVE-2026-78410`](https://avd.aquasec.com/nvd/cve-2026-78410)                                                                                                                                                                                                 | `bsdutils`, `libblkid1`, `liblastlog2-2`, `libmount1`, `libsmartcols1`, `libuuid1`, `mount`, `util-linux 2.41.5-0+deb13u1`; `login 1:4.16.0-2+really2.41.5-0+deb13u1` | None reported; affected                                                         |
| Authentik / High     | [`CVE-2026-9538`](https://avd.aquasec.com/nvd/cve-2026-9538)                                                                                                                                                                                                                                                                                                                                                                                                   | `perl-base 5.40.1-6+deb13u1`                                                                                                                                          | Debian status `fix_deferred`; no fixed version reported                         |
| Grafana / High       | [`CVE-2026-78669`](https://avd.aquasec.com/nvd/cve-2026-78669)                                                                                                                                                                                                                                                                                                                                                                                                 | `golang.org/x/net v0.59.0` and Go stdlib `v1.27.1` in bundled Prometheus datasource binary                                                                            | `x/net v0.60.0`; Go `v1.27.2` reported fixed; signed candidate remains affected |
| Grafana / High       | [`CVE-2026-78667`](https://avd.aquasec.com/nvd/cve-2026-78667), [`CVE-2026-97031`](https://avd.aquasec.com/nvd/cve-2026-97031)                                                                                                                                                                                                                                                                                                                                 | Go stdlib `v1.27.1` in bundled Prometheus datasource binary                                                                                                           | `v1.26.9` or `v1.27.2` reported fixed; candidate still has `v1.27.1`            |

**Decision requested from the security owner:** for Authentik, select a supported patched replacement/build and rescan, or provide a written risk disposition tied to the exact image digest and listed IDs, including owner, exposure/reachability assessment, compensating controls, and review/expiry date. For Grafana, request/await a signed corrected Prometheus plugin release or provide the same written disposition for its three High IDs. No exception is granted by this report. Trivy does not assess exploitability or code reachability. Authentik handles externally reachable identity traffic; Grafana's vulnerable packages are inside its active Prometheus datasource backend. Current network placement and least privilege are context, not a waiver. The unsigned local rebuild was rejected because it prevented plugin registration. The image workflow has no ignore-rule or residual-acceptance bypass and will not publish until all current preflight scans are free of Critical/High IDs.

Upstream before/after evidence remains in sections 20–31: the patched Prometheus artifact reduced three High IDs to zero (one UNKNOWN advisory remains); the final Distroless OSRM artifact reduced the upstream ten High IDs to zero; the custom SeaweedFS 4.48 build has zero Critical/High findings. Their exact local artifacts are not published identities. The official SeaweedFS release is independently pinned and reverified against the registry during this continuation: `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`, with the `linux/amd64` manifest `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. Production continues using the patched local SeaweedFS image and its existing `server -dir=/data ... -s3.config=/run/secrets/seaweedfs_s3 -s3.port=8333` startup and storage configuration.

### Controlled GHCR workflow

Added [container-images.yml](../.github/workflows/container-images.yml) and the allow-listed [production-image composite action](../.github/actions/production-image/action.yml). It runs only by manual dispatch from `main`. The default `publish_images=false` path has `contents: read` only. Its build matrix builds all 13 patched production artifacts for `linux/amd64` and scans their local final image IDs; a separate read-only job scans the exact pinned Redis and OpenTelemetry registry digest references with the same Trivy version. Any Critical or High ID fails preflight. The separate publish job receives `packages: write` only when explicitly requested and only runs after both preflight jobs pass. It authenticates with the job-scoped `GITHUB_TOKEN`, builds from the same checked-in Dockerfiles, emits BuildKit SBOM and provenance attestations, and tags each artifact in the approved single repository as `ghcr.io/woobble/care-platform:<service>-sha-<commit>-run-<run>-attempt-<attempt>`. An optional validated release label is also run-unique; no moving `latest` tag is written.

After push, the action checks that the GHCR tag resolves to Buildx's returned registry digest and that the manifest advertises `linux/amd64`; it then scans the exact `tag@sha256:<digest>` reference with Trivy 0.76.0. Per-image Trivy JSON reports are retained as workflow artifacts, and the database update timestamp is included in each job summary. No finding suppression or scanner exclusion was added. The action pins each third-party workflow action by full commit SHA. The tag construction was corrected to use tags within `ghcr.io/woobble/care-platform`; actionlint/YAML and allow-list checks passed locally. Neither manual preflight job nor publication was invoked in Actions during this assessment; exact local scans instead confirm that Authentik and signed-plugin Grafana currently fail the security gate. No GHCR tag, registry digest for a patched image, or remote scan is claimed.

The workflow builds directly from the Dockerfiles and never loads Compose environment files. The root `.dockerignore` excludes `.env` and `.env.*` from application build contexts. GHCR credentials are only passed to the login action in the publish-only job; no application secrets are used as build arguments or emitted to artifacts. No production env file, secret, volume, or production infrastructure was used.

During this change, `migrate` was given the explicit Docker target `runtime` in `compose.production.yaml`. Previously, the Dockerfile's last stage (`operator`) could be selected by default and add the PostgreSQL client to the migration runtime. The migration runner only needs the Bun application runtime; the operator retains its separate PostgreSQL client target. This narrows the migration image without changing its startup command or database configuration.

### Build, scan, and runtime evidence

The current migration target built successfully from `apps/api/Dockerfile` with `--target runtime`, Buildx **0.38.0**, and a disposable configuration at `/tmp/care-goal15b-buildx`. The exact local Docker image ID is `sha256:cb9ddaf277695b9732d96ee1d8c45a8a302346d7e12bf967f4f19a1796d97e1b`; Trivy **0.76.0** scanned it on `linux/amd64` against the same recorded database timestamp and found **0 Critical / 0 High**. Report SHA-256: `7de4e0aacf3af2d337b2535399e5576c21f9e4de25624f82bdab04ed1ef7cacc`. The first build attempt could not write Buildx activity state beneath the read-only default home path and produced no image; the retry used the disposable configuration. No image was pushed.

Reproduce the workflow's safe preflight from GitHub Actions on `main` with `publish_images` left false. To reproduce the changed migration target locally without Compose or environment files:

```bash
BUILDX_CONFIG=/tmp/care-goal15b-buildx docker buildx build --load \
  --platform linux/amd64 --target runtime \
  --tag care-goal15b-migrate:local \
  --file apps/api/Dockerfile .
trivy --cache-dir <scanner-cache> image --image-src docker \
  --skip-db-update --skip-java-db-update --platform linux/amd64 \
  --scanners vuln --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
  --format json --output <report.json> care-goal15b-migrate:local
```

The successful scan used the downloaded Trivy database without updating it during the scan; database metadata is the timestamp recorded above. The scanner result and local image ID are not a registry publication or registry digest verification.

The final signed-plugin Grafana artifact was rebuilt from `infra/grafana/Dockerfile` and scanned as exact local image ID `sha256:b380e5624fea8b1b2bc12ccddd405227ec8e4a915f17abd1ca2f0d5f99591bc8` (`linux/amd64`). The final scan reported **0 Critical / 3 unique High IDs (4 package instances)**, 10 Medium IDs, 1 Low ID, and 1 Unknown ID. The High IDs and package versions are listed above. Its JSON report is preserved as [goal15b-grafana-signed-trivy.json](security/goal15b-grafana-signed-trivy.json), SHA-256 `ca2d771e04583c54235d7dc6effc5a9473e7cca23c92684b1987580a85fb9b8a`. The exact scan used Trivy container image `aquasec/trivy:0.76.0` (registry digest `sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222`) and database timestamp `2026-10-18T13:11:41.355239553Z`:

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -v <trivy-cache>:/root/.cache/ -v <report-dir>:/reports \
  aquasec/trivy:0.76.0 image --image-src docker --platform linux/amd64 \
  --skip-db-update --skip-java-db-update --scanners vuln \
  --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json \
  --output /reports/grafana.json \
  care-platform-grafana:13.2.4-kin-openapi0.149.0-pruned
```

An experimental Grafana image with the rebuilt v13.2.3 backend scanned at **0 Critical / 0 High** (local image ID `sha256:be97f97f7d82b1a519cd5bde8f3eadaefc541f4ab405d1876c9b249d0f14aa66`; report SHA-256 `642d46dc719c55a5ea1db338c13f6081c5e77634e3e07fc1bd85564b48465ae5`). The builder used the verified official `golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d` index, whose `linux/amd64` manifest is `sha256:3b15ba438c60ab8fabe5fee3b11025c0049e358b31feff384648f11fc8e335f8`. Runtime verification rejected the candidate: its backend SHA-256 `0bf00acfcbcc8a4ac11a16de2eeefcbe50db5c63bf215ba1a1b34a2120ec4ece` no longer matched the signed upstream manifest entry `ee2b4e699130b6a4c0382df20abd4b6e88580d81940150aedc45823a464d7966`; Grafana omitted the Prometheus plugin and `/api/ds/query` returned HTTP 404 `plugin not registered`. That scan is an experimental result, not a remediation. The signed plugin image was rebuilt and rescanned after reverting that modification, and the synthetic runtime check passed as recorded above.

The signed-plugin Grafana candidate was started in the dedicated synthetic `care-goal15b-grafana` Compose project with only its own disposable Grafana/Prometheus volumes and private network. Grafana `/api/health` reported database `ok`, version `13.2.4`, and source commit `af4a33e3786594ad72f72d97e6744010330c2977`; Prometheus `/-/ready` returned ready; the provisioned datasource health endpoint returned `OK`; and the `up` query through Grafana `/api/ds/query` returned three frames with zero query errors. The project was removed with `down --volumes --remove-orphans`. No host ports, real secrets, production volumes, or production services were used. Existing synthetic Authentik, object-storage, private invoice PDF, Caddy, and application-image runtime checks remain recorded in sections 20–31.

The migration runner was also executed from the exact `care-goal15b-migrate:local` linux/amd64 artifact against the custom PostgreSQL 18.6 image in a new internal-only `care-goal15b-migration` project. It mounted the repository's role-initialization script and PostgreSQL 18 volume root at `/var/lib/postgresql`, used synthetic database credentials, applied every migration successfully, and exited **0**. The project-scoped PostgreSQL volume and network were removed. This did not use production volumes or secrets.

During a read-only diagnostic, `ps -eo args` emitted Codex shell-wrapper command arguments containing inherited environment setup in tool output. No values were copied into repository files or repeated in this report; the output was not assessed for credential contents, so the exact exposure is unverified. No `.env.production` was read or loaded. Include this output in the existing secret-isolation/security-owner review; that independent gate remains **Blocked**.

### Repository and container verification

Final repository gates passed: `bun run lint` (33/33), `bun run format:check` (691 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (32/32 tasks, including OpenAPI generation). `bunx oxlint --deny-warnings --format=agent`, `git diff --check`, and `actionlint` **1.7.12** passed. Production Compose rendered successfully under an empty inherited environment using `.env.production.example` and an explicit synthetic Grafana password; `config --images` returned 16 service references for 15 unique production images, with Authentik shared by server and worker. This was config-only. API, web, worker, migrate, and operator currently resolve to Compose-generated local names (`care-platform-prod-*`) and have build contexts; they are not wired to the GHCR tags until verified registry digests are available. Graphify was refreshed to 12,417 nodes and 37,604 edges. The latest full Authentik E2E remains the prior **13/13** run in section 31; it was not rerun because this continuation changed only the Grafana and migration container candidates and did not change Authentik or application authentication code.

The user identified `ghcr.io/woobble/care-platform` and indicated workflow authentication is configured. This repository had no image publication workflow, so the manual gated workflow was added; no Actions workflow was dispatched and no image was published. GHCR authentication, package permissions, returned digests, and remote scans of patched artifacts therefore remain unverified.

### Gate status and required decisions

| Gate                                                           | Status                              | Current disposition                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 15-image production inventory and preflight workflow           | **Implemented; not run in Actions** | Exact local scans cover all production images; Authentik and signed-plugin Grafana predictably fail preflight. Run the manual preflight on the committed `main` revision after supported remediations or risk dispositions.                |
| Authentik Critical/High findings                               | **Blocked**                         | Obtain a supported patched release or security-owner review and documented disposition for all 16 IDs. No acceptance is recorded.                                                                                                          |
| Grafana High findings                                          | **Blocked**                         | Signed-plugin image retains 3 High IDs. Rebuilt plugin candidate was rejected after Grafana refused its modified signature; obtain a signed corrected release/build or a documented security-owner disposition. No acceptance is recorded. |
| GHCR publication, digest verification, and remote digest scans | **Not run**                         | Neither the manual preflight nor publication was invoked. Do not update production image references until publication and digest scans succeed.                                                                                            |
| Production deployment clearance                                | **Fail**                            | Independent accessibility, recovery, performance, external configuration, secret-isolation, organizational, and other runtime gates retain their previously verified statuses. This container workflow does not promote any of them.       |

This Goal 15B update does not claim immutable references for the unpublished patched images, does not claim scans of registry copies, and does not clear the Care Platform for deployment.

## 31. Goal 15 continuation — Office keyboard and reduced-motion audit — 2026-10-18

### Focused accessibility result

Added `apps/web/e2e/accessibility-keyboard.spec.ts` and reusable browser checks for keyboard traversal and reduced-motion behavior. The synthetic Office-admin journey covered `/clients`, `/employees`, `/services`, `/admissions`, `/planning`, `/benefits`, `/billing/invoices`, `/billing/claims`, `/documents`, `/operations/worklist`, and `/administration/users` at **390×844, 768×1024, and 1440×900**. Every route/viewport state also ran the existing semantic-name, field-label, image-alt, 24×24 target, and horizontal-overflow checks. The test presses real Tab keys, checks that encountered stops remain mapped to visible controls and expose a focus indicator (including browser-native focus for date/time widgets), then emulates reduced motion and checks that computed transition and animation durations are at most 1 ms. It passed **1/1 test, zero failures, exit code 0** against the isolated `care-goal15-keyboard-e2e` project.

The Playwright web and API servers ran the current source in development mode; this is not a browser test of the deployable web image. Next.js's development toolbar was hidden for traversal because it is not part of the production UI. A diagnostic traversal on Services at 390×844 encountered 40 distinct stops from 43 selector-matched visible DOM candidates; Chromium's native widgets and application focus behavior make the DOM selector count an upper bound, so the reusable check verifies each stop encountered and requires multiple distinct stops rather than claiming a one-to-one audit of every DOM candidate. Native date inputs can be the document's active element while CSS `:focus` is false because Chromium focuses an internal native widget; that case is treated as browser-native focus and was not visually assessed pixel-by-pixel. These limits, plus the outstanding screen-reader, rendered-state contrast, and exhaustive dialog/error-announcement coverage, keep Accessibility **Fail**. No WCAG conformance is claimed.

The test used only `.env.test`, synthetic user/workflow data, and disposable service volumes. Authentik, PostgreSQL, Redis, Mailpit, and SeaweedFS in the dedicated project were healthy during the run. No production environment, secret, volume, or infrastructure was used. The subsequent full Authentik browser suite passed **13/13 tests, zero failures, zero skips, exit code 0 in 5.5 minutes**, including this keyboard/reduced-motion test and the added caregiver Tab checks. The run emitted the previously observed transient Next.js destination-stream and color-environment warnings; the affected journeys passed and the warning causes remain unisolated. The project `care-goal15-keyboard-e2e` was then stopped and removed with its own `down --volumes --remove-orphans` command; verification found no remaining containers or volumes with that project label.

Reproduction with the dedicated synthetic project healthy and seeded:

```bash
env CARE_E2E_POSTGRES_PORT=15439 CARE_E2E_REDIS_PORT=16383 \
  CARE_E2E_AUTHENTIK_PORT=19260 CARE_E2E_S3_PORT=19261 \
  CARE_E2E_FILER_PORT=19262 CARE_E2E_SMTP_PORT=11039 \
  CARE_E2E_MAILPIT_PORT=18038 \
  DATABASE_URL=postgres://care_app:<synthetic-password>@127.0.0.1:15439/care \
  MIGRATION_DATABASE_URL=postgres://care_owner:<synthetic-password>@127.0.0.1:15439/care \
  WORKER_DATABASE_URL=postgres://care_worker:<synthetic-password>@127.0.0.1:15439/care \
  AUTHENTIK_WEB__BASE_URL=http://localhost:19260 \
  OIDC_ISSUER=http://localhost:19260/application/o/care-platform/ \
  S3_ENDPOINT=http://localhost:19261 PLAYWRIGHT_HTML_OPEN=never \
  PLAYWRIGHT_BROWSERS_PATH=<browser-cache> CARE_UI_REVIEW_DIR=<temporary-review-dir> \
  bun --env-file=.env.test run --filter @care/web test:e2e -- \
  e2e/accessibility-keyboard.spec.ts --output=<temporary-playwright-output>
```

The full synthetic browser suite was run with the same explicit environment and project as above, selecting the complete suite rather than the single file. The full-suite invocation was:

```bash
env CARE_E2E_POSTGRES_PORT=15439 CARE_E2E_REDIS_PORT=16383 \
  CARE_E2E_AUTHENTIK_PORT=19260 CARE_E2E_S3_PORT=19261 \
  CARE_E2E_FILER_PORT=19262 CARE_E2E_SMTP_PORT=11039 \
  CARE_E2E_MAILPIT_PORT=18038 \
  DATABASE_URL=postgres://care_app:<synthetic-password>@127.0.0.1:15439/care \
  MIGRATION_DATABASE_URL=postgres://care_owner:<synthetic-password>@127.0.0.1:15439/care \
  WORKER_DATABASE_URL=postgres://care_worker:<synthetic-password>@127.0.0.1:15439/care \
  AUTHENTIK_WEB__BASE_URL=http://localhost:19260 \
  OIDC_ISSUER=http://localhost:19260/application/o/care-platform/ \
  S3_ENDPOINT=http://localhost:19261 PLAYWRIGHT_HTML_OPEN=never \
  PLAYWRIGHT_BROWSERS_PATH=<browser-cache> CARE_UI_REVIEW_DIR=<temporary-review-dir> \
  bun --env-file=.env.test run --filter @care/web test:e2e -- \
  --output=<temporary-playwright-output>
```

This accessibility update does not change the container disposition: the patched Authentik candidate retains one critical and 15 high IDs, and Grafana retains four high package instances across three IDs, without security-owner acceptance. The final OSRM Distroless runtime resolved its previous eight high IDs and has zero critical/high findings (section 29). Locally built custom images still lack published immutable GHCR digests. Overall release remains **Fail** and the platform remains **not cleared for production**. Other release gates retain their independently verified status.

### Final repository checks for this continuation

After the E2E run, the requested root gates passed: `bun run lint` (33/33), `bun run format:check` (686 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), and `bun run build` (OpenAPI/client generation and 32/32 tasks, including the production Next.js build under `NODE_ENV=test`). Strict `bunx oxlint --deny-warnings --format=agent` passed after the final helper cleanup. Production Compose configuration rendered successfully under an empty inherited environment with `.env.production.example`; this was config-only and started no services. `git diff --check` passed, and Graphify refreshed the code graph to 12,409 nodes and 37,596 edges. The full Authentik E2E result above used only synthetic configuration and was followed by removal of its project-labeled disposable volumes. No `.env.production` was accessed.

## 33. Goal 15B final container-security status — 2026-10-18

The 15 production image inventory and exact scan references are in section 32. Redis and OpenTelemetry digest indexes and linux/amd64 child manifests were reverified directly from their registries and rescanned with Trivy 0.76.0; both returned zero Critical/High findings. The official SeaweedFS 4.48 index and linux/amd64 child digest were also reverified; production still uses the separately patched, locally scanned SeaweedFS candidate because the upstream image retains High findings. The migration runner and signed-plugin Grafana image both built locally, scanned, and passed isolated synthetic runtime checks.

The signed Grafana runtime remains at zero Critical / three High IDs across four package instances. A locally rebuilt backend scanned at zero Critical/High but was rejected because replacing the bundled binary invalidated Grafana's vendor signature and prevented Prometheus query registration. Authentik remains at one Critical / 15 High IDs. Neither image has a supported remediation or security-owner risk acceptance recorded. The manual preflight workflow now covers 13 patched builds plus the two pinned upstream images, but it was not run in Actions; its current scans predict failure, so its GHCR publication job cannot proceed. No patched image has a verified GHCR digest, and no registry image reference was published or claimed.

All requested repository gates passed in this continuation (section 32), as did actionlint, synthetic production Compose validation, Grafana health/datasource/query checks, and PostgreSQL migration execution. Only dedicated synthetic networks and volumes were used and removed. No `.env.production`, production secrets, production volumes, or production services were accessed. The separate process-output exposure noted in section 32 remains for security-owner review. Authentik/Grafana security decisions, immutable references for the patched images, and independent accessibility, recovery, performance, external-configuration, and secret-isolation gates remain open. The Care Platform is **not cleared for production deployment**.

## 34. Goal 15B exact production build and full image rescan — 2026-10-18

### Production build targets and exact artifacts

Rendered production Compose with every profile enabled to include profile-gated production services. `config --quiet` succeeded using the explicit synthetic `.env.production.example` plus a synthetic Grafana password. `config --images` identified 15 production images: 13 custom local build targets and two digest-pinned upstream images. Mailpit appears only when all profiles are requested and remains development-only.

The following unique Critical/High CVE-ID counts compare the immediately preceding Goal 15A scan with this exact-artifact rescan. Both used Trivy 0.76.0 on linux/amd64, but the vulnerability database changed from `2026-10-18T07:12:07.771859408Z` to `2026-10-18T18:32:29.177029985Z`; interpret count changes with that snapshot difference. `0/0` means no Critical or High IDs were reported.

| Production image            | Goal 15A baseline C/H | Exact final artifact C/H |
| --------------------------- | --------------------: | -----------------------: |
| API                         |                   0/0 |                      0/0 |
| Web                         |                   0/0 |                      0/0 |
| Worker                      |                   0/0 |                      0/0 |
| Migration runner            |                   0/0 |                      0/0 |
| Operations CLI              |                   0/0 |                      0/0 |
| PostgreSQL                  |                   0/0 |                      0/0 |
| Authentik server and worker |                  1/20 |                 **1/15** |
| Redis                       |                   0/0 |                      0/0 |
| OpenTelemetry Collector     |                   0/0 |                      0/0 |
| SeaweedFS patched candidate |                   0/0 |                      0/0 |
| AWS CLI initializer         |                   0/0 |                      0/0 |
| Caddy                       |                   0/0 |                      0/0 |
| Grafana                     |                  0/12 |                  **0/3** |
| Prometheus                  |                   0/3 |                      0/0 |
| OSRM                        |                  0/10 |                      0/0 |

The production Dockerfiles were rebuilt without starting any Compose services. Buildx state was directed to a writable temporary Docker config after the first attempt failed because the default Buildx activity directory was read-only. The successful command was:

```bash
DOCKER_CONFIG=/tmp/care-goal15b-docker-config CARE_GRAFANA_ADMIN_PASSWORD=synthetic-only-check \
  docker compose -p care-goal15b-production-build --profile '*' \
  -f compose.yaml -f compose.production.yaml \
  --env-file .env.production.example build --pull
```

The five application image build outputs were tagged locally with the exact names resolved by production Compose. Their Docker image IDs below are image/config IDs for those local artifacts; they are not registry manifest digests. Every listed reference was scanned successfully with Trivy 0.76.0, `linux/amd64`, and vulnerability database `UpdatedAt=2026-10-18T18:32:29.177029985Z`. The scan summary includes each image ID, scan time, all Critical/High package instances, installed versions, fixed versions, and registry references where available: [goal15b-container-rescan.json](security/goal15b-container-rescan.json).

| Production image            | Exact local reference or pinned registry reference                                                                     | Scanned image ID / registry digest                                                                                                                                              | Critical / High unique IDs |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------: |
| API                         | `care-platform-prod-api:latest`                                                                                        | `sha256:28daf73b145d64d83936ab2baf16a46a6252cd492140ec1a596dec462b29ea8f`                                                                                                       |                      0 / 0 |
| Web                         | `care-platform-prod-web:latest`                                                                                        | `sha256:4cda6d0737c433745bb85b1bc17cd1ee26603712034d0acf8a4f8b766c18bd55`                                                                                                       |                      0 / 0 |
| Worker                      | `care-platform-prod-worker:latest`                                                                                     | `sha256:82e7fc45ef8f99d314ffbede90d30e36ae8c3fee3f6d20fa4877718548be63d4`                                                                                                       |                      0 / 0 |
| Migration runner            | `care-platform-prod-migrate:latest`                                                                                    | `sha256:4e12cf9c7734a256976f1a253b4898be4d2d3098a4f77770155052fa64f33e97`                                                                                                       |                      0 / 0 |
| Operations CLI              | `care-platform-prod-operator:latest`                                                                                   | `sha256:daab523ed756f4686d1171927189d8cdb24c4d69b819148158c4fa8bc8df10fc`                                                                                                       |                      0 / 0 |
| PostgreSQL                  | `care-platform-postgres:18.6-go1.26.9`                                                                                 | `sha256:9ba6287e4c50e23d7d51423c993da3026ef26db9116df4af7815b09160e11636`                                                                                                       |                      0 / 0 |
| Authentik server and worker | `care-platform-authentik:2026.8.4-openssl-deb13u3-urllib3-2.8.0`                                                       | `sha256:74bcbd6cdffb0102442e5859b39d951dbca9db98d5d4bc98727166ea26d72234`                                                                                                       |                 **1 / 15** |
| Redis                       | `redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`                               | registry index `sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0`; linux/amd64 `sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23` |                      0 / 0 |
| OpenTelemetry Collector     | `otel/opentelemetry-collector-contrib:0.163.1@sha256:1175b03003053962012f5a231f5567f66a3e8fdb960c7835c0e48f7aa1555806` | registry index `sha256:1175b03003053962012f5a231f5567f66a3e8fdb960c7835c0e48f7aa1555806`; linux/amd64 `sha256:45c3ed5eb9eb71e3e6ade7fa67aed000e5f68bb22fe730a6fa66a2504077cfce` |                      0 / 0 |
| SeaweedFS patched candidate | `care-platform-seaweedfs:4.48-go1.26.9-xnet0.60.0`                                                                     | `sha256:d20bbd3ba9324e49ab3437ed0963636db0b5f6450ebb23298268e457de638788`                                                                                                       |                      0 / 0 |
| AWS CLI initializer         | `care-platform-aws-cli:2.37.4-al2023-patched`                                                                          | `sha256:78cbd169d636c82bf720f110cd20b9df437544da10d0e528364e7adbd8e0ec09`                                                                                                       |                      0 / 0 |
| Caddy                       | `care-platform-caddy:2.11.7-go1.26.9`                                                                                  | `sha256:d8318a89e462c92b124e348e46d1217f3d487ff3a350b8a09bbe4ec23ec0a5a0`                                                                                                       |                      0 / 0 |
| Grafana                     | `care-platform-grafana:13.2.4-kin-openapi0.149.0-pruned`                                                               | `sha256:01e3bab00a9db27658f2645c60dd33f68542135c026cd6ebaaa9504823fa6559`                                                                                                       |                  **0 / 3** |
| Prometheus                  | `care-platform-prometheus:v3.15.0-go1.26.9-xnet0.60.0`                                                                 | `sha256:039daba2bf3b77afaa4672af31c3f2a57287c705b2a92b3faff03d7264b6789c`                                                                                                       |                      0 / 0 |
| OSRM                        | `care-platform-osrm:v26.10.0-distroless-debian13-go1.26.9`                                                             | `sha256:6e5d51aaf1ed1d6aeebe3cc51bfdb5db0d59bc9ed2ac010b8f2f4a78cd202bb4`                                                                                                       |                      0 / 0 |

The updated exact-artifact counts preserve the earlier before/after records in sections 16, 19, and 32. Key remediation comparisons remain PostgreSQL `1/24 → 0/0`, Authentik upstream-to-derived `1/20 → 1/15`, SeaweedFS upstream-to-patched `0/3 → 0/0`, Caddy `0/3 → 0/0`, OpenTelemetry `0/3 → 0/0`, and OSRM `0/10 → 0/0`. Grafana retains three High IDs in four package instances. The fresh exact production scan found no new Critical/High IDs in the other 13 images.

### Authentik hardening and residual findings

The production Authentik image now strips all inherited SUID bits in a root build step, verifies none remain before switching to the `authentik` runtime user, and runs with `no-new-privileges:true` for both server and worker. The exact production build ran as UID 1000; the Dockerfile build step is the authoritative all-filesystem SUID check. The separate runtime check also confirmed `systemd-homed`, `Archive::Tar`, and global pip tooling are absent. The isolated E2E image and the final production Compose image have identical root filesystem layer digests and identical runtime config except for Compose image labels.

These controls reduce privilege escalation and remove unused tooling; they do not remediate the scanner findings. The final production artifact still has one Critical and 15 High IDs. The Critical `CVE-2026-6653` and seven High IDs `CVE-2026-74860`, `CVE-2026-86138`, `CVE-2026-86139`, `CVE-2026-86140`, `CVE-2026-86142`, `CVE-2026-86143`, and `CVE-2026-86144` are in `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`. The remaining High findings map to ncurses `6.5+20250216-2`, systemd/udev `257.13-1~deb13u1`, acl `2.3.2-2+b1`, util-linux `2.41.5-0+deb13u1`, and perl-base `5.40.1-6+deb13u1`. No fixed Trixie package version was reported by Trivy or available from the checked Trixie repositories. Debian’s tracker marks the installed Trixie libxml2 version vulnerable and lists Forky/sid as fixed ([CVE-2026-6653 tracker](https://security-tracker.debian.org/tracker/CVE-2026-6653)). The exact IDs and every affected package instance are listed in the linked JSON report.

`CVE-2026-16742` is reported on systemd libraries although the Debian advisory describes a `systemd-homed` issue and the affected executable is absent ([Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-16742)). `CVE-2026-9538` is reported on `perl-base` although `Archive::Tar` is absent. These are documented as evidence for a possible non-applicable disposition, not suppressed or removed from the scan counts. The util-linux findings also remain counted after SUID removal and `no-new-privileges`; the mitigation reduces privilege paths but is not a package fix. Authentik has an externally reachable identity surface, so no residual risk is accepted here.

### Grafana and SeaweedFS disposition

Grafana has three unique High IDs across four instances in its signed bundled Prometheus datasource plugin: `CVE-2026-78669` in `golang.org/x/net v0.59.0` and Go stdlib `v1.27.1`, plus `CVE-2026-78667` and `CVE-2026-97031` in Go stdlib `v1.27.1`. Trivy reports fixes at x/net `v0.60.0` and Go `v1.27.2`. Replacing the vendor-signed plugin executable with a locally rebuilt binary broke signature validation and Prometheus query registration, so that candidate remains rejected. No signed upstream plugin release with the corrected dependencies was available in this check; the official release list still shows v13.2.3 as latest ([Grafana releases](https://github.com/grafana/grafana-prometheus-datasource/releases)). Keep Grafana blocked pending a supported signed update or security-owner disposition.

SeaweedFS 4.48 was verified from the registry with index digest `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` and linux/amd64 child digest `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`. Trivy scanned that exact index digest for linux/amd64 and found 0 Critical / 3 High IDs (`CVE-2026-78667`, `CVE-2026-78669`, `CVE-2026-97031`) in Go 1.26.8 and x/net 0.58.0. The production custom 4.48 candidate was rebuilt from the pinned source, with patched Go/x/net, and scanned at 0/0. The existing SeaweedFS startup and volume configuration were exercised by the synthetic stack and object-storage integration coverage. Do not replace the candidate with the vulnerable upstream artifact. The patched final artifact still has only a local image ID, not a GHCR manifest digest; its immutable production reference remains unresolved.

Redis and OpenTelemetry registry index digests and their linux/amd64 child manifests were rechecked with `docker buildx imagetools inspect` and scanned at 0/0. The SeaweedFS upstream index and child digest are verified as described above, but the deployable patched image has no registry digest. The 13 custom images remain local tags with local Docker image IDs; none has a GHCR digest. The readiness report therefore does not claim immutable registry references for the patched production artifacts.

### Isolated compatibility, safety, and release gate

The full Authentik browser E2E suite passed **13/13** in 6.2 minutes against the isolated synthetic project with the SUID-stripped Authentik image, PostgreSQL, Redis, SeaweedFS, and Mailpit. Authentik server/worker readiness and the supporting containers were healthy; migrations and seed completed before the suite. The E2E artifact had the same root filesystem layers and runtime config as the exact production Compose Authentik build, except for Compose labels. Next.js emitted its known destination-stream/hydration and color-environment warnings during passing journeys. Only temporary configuration derived from `.env.test`, synthetic data, dedicated ports, and disposable project volumes were used. The project and its volumes were removed after the run. Earlier exact-image Caddy, invoice-PDF, object-storage, migration, Grafana, and worker checks remain documented in sections 26–33. The latest production Compose build has identical root filesystem layers and runtime config to the previously smoke-tested API, worker, migrate, and operator artifacts; the web filesystem layers changed.

The latest-web invoice-PDF smoke was attempted against the exact scanned local image IDs in isolated project `care-goal15b-prod-pdf-smoke`, using a synthetic env file, synthetic TLS keypair, loopback-only Caddy, a dedicated Postgres volume, and an additional project-local network attachment solely to make the disposable database reachable by the host test runner. Compose config validation, migrations, seed, and `up --wait` completed; PostgreSQL, Redis, Authentik, SeaweedFS, API, web, worker, Mailpit, and Caddy reported healthy. Authentik discovery through Caddy returned HTTP 200. The browser journey did not pass: after OIDC login, the production web page redirected to its session-error route instead of displaying the expected no-active-organization state, so invoice creation, PDF generation, private retrieval, and anonymous-denial assertions did not run. Direct browser calls to the production web image's `/api/auth/list-accounts` and `/api/auth/get-access-token` endpoints returned HTTP 200 for the synthetic user, so the server-rendered post-login failure remains unexplained. One attempt also had a canceled Authentik dynamic-module fetch; the same module returned HTTP 200 through Caddy when retried directly. Treat the latest-web authentication/PDF runtime check as **blocked and failing**, not passed. The disposable project and its volumes were removed; no production secrets or volumes were used.

Reproduction uses newly generated synthetic files under `$SYNTHETIC_DIR` (never `.env.production`):

```bash
DOCKER_CONFIG=/tmp/care-goal15b-docker-config docker compose \
  -p care-goal15b-prod-pdf-smoke --profile development \
  --env-file "$SYNTHETIC_DIR/compose.env" \
  -f compose.yaml -f compose.production.yaml \
  -f "$SYNTHETIC_DIR/compose.override.yaml" \
  up -d --no-build --wait --wait-timeout 300

NODE_ENV=development CARE_DISABLE_DOTENV=true \
  bun --env-file="$SYNTHETIC_DIR/playwright.env" run seed

cd apps/web
CARE_DISABLE_DOTENV=true PLAYWRIGHT_HTML_OPEN=never \
  PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" \
  CARE_SYNTHETIC_HOSTS=care.home.arpa,api.care.home.arpa,login.care.home.arpa \
  NODE_EXTRA_CA_CERTS="$SYNTHETIC_DIR/caddy.crt" \
  NODE_OPTIONS="--require=$PWD/container-smoke/hosts.cjs" \
  node --env-file="$SYNTHETIC_DIR/playwright.env" ./node_modules/.bin/playwright test \
  --config container-smoke/playwright.config.ts \
  container-smoke/invoice-pdf.spec.ts --reporter=dot --trace=off
```

The test environment needs the synthetic Caddy certificate, host mapping, Compose override, and disposable project volumes; the smoke attempt reported above was cleaned up afterward.

Production Compose validation was config-only. Application images were built from the production Dockerfiles; no production services, volumes, or secrets were used. `.env.production` was not accessed or loaded. The successful build and scan commands require no production secrets. Exact Trivy invocation and scan times are in the linked report; the common database update time was `2026-10-18T18:32:29.177029985Z`.

The manual GHCR workflow remains undispatched and no image was pushed. Its global preflight correctly blocks publication while Authentik and Grafana have Critical/High findings. After a passing scan, it generates digest-scoped SLSA provenance with the pinned [GitHub `actions/attest` v4.2.2 action](https://github.com/actions/attest/blob/v4.2.2/action.yml) and verifies the signer workflow. No security-owner risk acceptance is recorded. Required decisions are: disposition all 16 Authentik IDs (including the two evidence-backed possible non-applicable matches), disposition the three Grafana IDs or await a signed corrected plugin, and publish the patched SeaweedFS artifact only after the complete production scan gate passes so its final registry digest can be pinned. Do not add scanner ignores without an explicit evidence-backed decision. For each future security refresh, update the pinned base/dependency versions, rebuild all production profiles with synthetic configuration, rescan the exact final artifacts, verify each registry manifest and platform, then update Compose with the published `tag@sha256:digest` and retain the before/after report.

Full repository gates passed after the image/config implementation: `bun run lint` (33/33), `bun run format:check` (692 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33), `bun run test` (51/51), `bun run build` (32/32 including OpenAPI/client generation), `bunx oxlint --deny-warnings --format=agent`, and `actionlint` 1.7.12. After this final documentation-only update, `bun run format:check` (692 files) and `git diff --check` passed again. Graphify refreshed to 12,423 nodes and 37,610 edges. Production Compose synthetic config validation, all 15 exact local/registry image scans, the isolated Authentik E2E, and direct registry digest verification also passed. The separate exact latest-web invoice-PDF browser smoke failed at post-login authorization as documented above; it remains a release blocker alongside the unresolved Authentik/Grafana findings and missing immutable references for custom images.

Container status remains **Blocked** and overall release status remains **Fail**. The Care Platform is **not cleared for production deployment**. Accessibility, recovery, performance, secret-isolation, and other independent gates retain their previous statuses and are not promoted by these container results.

## 35. Goal 15B GHCR publication and provenance gate hardening — 2026-10-18

The GHCR workflow and its composite build action now put a vulnerability gate before registry publication. A dedicated job downloads Trivy 0.76.0's vulnerability database once and shares the snapshot with all local, upstream, and post-publication scans. Buildx loads the exact `linux/amd64` candidate into the runner's local image store. Trivy scans that candidate before the GHCR login step; any Critical or High finding fails the job before a registry push can occur. The action then pushes the already-scanned local artifact under a run-unique tag, resolves the manifest digest from GHCR, checks the advertised platform, and compares the registry manifest's config digest with the locally scanned image config digest. When a release label is supplied, its run-unique tag must resolve to the same manifest digest.

The action scans the immutable `tag@sha256:digest` from GHCR with the same Trivy version and database snapshot as the local scan. It blocks on Critical or High results. This registry rescan happens after the unique candidate tag is uploaded; if it fails, the run fails and emits no attestation, image-lock record, or production Compose update, but the run-unique candidate tag remains in GHCR for review or cleanup. Only after the remote gate passes does the action generate GitHub SLSA provenance for the verified registry digest, push the attestation to OCI, and run `gh attestation verify` against the OCI attestation bundle while requiring this repository's `.github/workflows/container-images.yml` signer and a GitHub-hosted runner. The exact digest, local config digest, platform, source commit, scan counts, scanner/database versions, workflow reference, and provenance-verification result are retained in a per-image record. A final job requires exactly the 13 custom production images and combines their verified records into `care-platform-ghcr-image-lock.json`.

Tags are unique to the image name, source commit, workflow run ID, and run attempt. The workflow does not create a mutable `latest` or release alias. The immutable lock is retained as a workflow artifact; it does not change production Compose configuration automatically. After an authorized registry run succeeds, review that lock and make a separate change pinning each custom production service to its exact `tag@sha256:digest`; retain the independent Redis and OpenTelemetry digest references already in Compose.

The workflow was **not dispatched** and no image was published. The existing exact-artifact scan predicts that the pre-publication gate will fail on Authentik (**1 Critical / 15 High IDs**) and Grafana (**0 Critical / 3 High IDs**). The GHCR manifest digests for the 13 custom images therefore remain unavailable, and immutable Compose references for those images are still blocked. No scanner findings were ignored and no security-owner risk acceptance is recorded. The current blocker is a real vulnerability disposition/remediation requirement, not a registry-publishing workaround.

This workflow edit passed `actionlint` 1.7.12, `bash -n` for all 15 embedded action/workflow scripts, synthetic validation of a 13-image immutable-lock assembly using the local gojq compatibility CLI, and `git diff --check`. Synthetic production Compose configuration also rendered under an empty inherited environment with `.env.production.example` and synthetic Grafana passwords; the inventory was 15 production images plus one development-only Mailpit image. Read-only inspection confirmed that all 13 current custom local image tags still resolve to the image IDs in the exact-artifact scan record; this is an identity check, not a refreshed vulnerability scan. No containers were started. These static checks do not prove a GHCR login, remote image scan, attestation push, or OCI provenance verification. The publication path remains unexecuted until the actionable findings are remediated or receive a documented security-owner decision and an authorized workflow run is requested. Workflow procedure after those blockers are resolved:

```bash
gh workflow run container-images.yml --ref main -f publish_images=false
```

That dispatch exercises the build and local pre-publication scan gates only. Publishing requires the explicit `publish_images=true` input and must follow security-owner review; it is intentionally not run here. No `.env.production`, production secret, production service, or production volume was used for this change. The overall container gate remains **Blocked**, the overall release status remains **Fail**, and the Care Platform is **not cleared for production deployment**.

## 36. Goal 15B upstream patch availability recheck — 2026-10-18

At `2026-10-18 20:04 UTC`, I rechecked the official upstream release feeds and queried candidate image tags directly from their registries. Authentik's official release feed still identifies `2026.8.4` as the latest stable release ([release](https://github.com/goauthentik/authentik/releases/tag/version/2026.8.4)); `ghcr.io/goauthentik/server:2026.8.5`, `:2026.8.6`, and `:2026.9.0` were not found. Grafana's latest official server release remained `v13.2.4` ([release](https://github.com/grafana/grafana/releases/tag/v13.2.4)); Docker Hub did not have `grafana/grafana:13.2.5` or `:13.3.0`. The official signed Prometheus datasource release feed remained at `v13.2.3` ([release](https://github.com/grafana/grafana-prometheus-datasource/releases/tag/v13.2.3)), whose scanned bundled dependencies still include Go stdlib v1.27.1 and `golang.org/x/net` v0.59.0.

The Debian tracker still marks the installed Trixie libxml2 version vulnerable for `CVE-2026-6653` and records Forky/sid as fixed, with no Trixie fix ([Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-6653)). No supported upstream image or Trixie package update was available in this recheck to remove the Authentik findings. The existing local scan report remains the current exact-artifact scan evidence (`Trivy 0.76.0`, database `2026-10-18T18:32:29.177029985Z`); this availability check did not rebuild or rescan any image. It does not change the security disposition: Authentik remains at 1 Critical / 15 High IDs, Grafana at 0 Critical / 3 High IDs, and neither has security-owner risk acceptance.

Registry check commands:

```bash
docker buildx imagetools inspect ghcr.io/goauthentik/server:2026.8.5
docker buildx imagetools inspect ghcr.io/goauthentik/server:2026.8.6
docker buildx imagetools inspect ghcr.io/goauthentik/server:2026.9.0
docker buildx imagetools inspect grafana/grafana:13.2.5
docker buildx imagetools inspect grafana/grafana:13.3.0
```

## 37. Goal 15C production OIDC session regression — 2026-10-18

The latest production web image reproduced the post-login `/?error=auth` failure because its OIDC discovery request used the public Authentik issuer, `login.care.home.arpa`, while the production web and API containers had no Docker DNS route for that host. The existing Caddy service already routes the Authentik hostname and shares `care-edge` with web and API, but only Caddy itself advertised the hostname. Better Auth consequently failed provider discovery and returned `PROVIDER_NOT_FOUND` from `POST /api/auth/sign-in/social`.

`compose.production.yaml` now adds `${AUTHENTIK_HOST}` as a Caddy alias on `care-edge`. Web and API resolve the unchanged issuer through Caddy, which forwards to Authentik. No issuer, OAuth, cookie, authorization, tenant-scoping, or TLS policy was relaxed. The shared `signInWithAuthentik` test helper now asserts that provider registration returns HTTP 200 before completing the browser flow. A focused production-image regression covers the provider response, callback session, Authentik account, access token, and no-membership page.

### Verified image and isolated runtime evidence

The isolated project was `care-goal15c-oidc-smoke`. It used synthetic environment files, a disposable CA/keypair, loopback-only Caddy and Postgres ports, and disposable Compose volumes. Production `.env.production`, production secrets, production services, and production volumes were not read or used. Explicit Compose validation used `--env-file <synthetic-compose-env>` and the project's isolated override.

| Runtime artifact | Exact local image ID                                                                                             | Result                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Web              | `sha256:4242cad1a7ae0a2d36186cf0bc8815c1404021a160bd00e6f3b8837dcdb7b31d`                                        | OIDC and invoice PDF journeys passed                       |
| API              | `sha256:939bf877b260323a70215c5d57427433d7ef45023b83ba1b4adf596d1f0c8998`                                        | OIDC discovery returned HTTP 200 and the configured issuer |
| Worker           | `sha256:27ed6541caa733a9ec02abaea09d8227b5ab1804f0d22002f61e7d0789fc95f7`                                        | Healthy throughout the smoke runs                          |
| Caddy            | `care-platform-caddy:2.11.7-go1.26.9`, `sha256:9003d2622c1993b6deeb5bc0255c3d74b3320cf84a55af528a7e2c019b7da579` | Authentik, web, and API routes healthy                     |

From both the web and API containers, OIDC discovery returned HTTP 200 and its advertised issuer exactly matched `OIDC_ISSUER`. The focused OIDC regression passed 1/1: provider registration was HTTP 200 with no error code; the browser returned with a Better Auth session, an `authentik` account, and an access token. The login completed to the expected no-active-organization page before synthetic tenant membership was assigned.

The production-image invoice smoke passed three consecutive final runs (and additional earlier runs). Each authenticated a synthetic office administrator, selected the disposable Demo Care tenant, issued an invoice, downloaded and parsed its private PDF, matched the PDF SHA-256 to the stored document row, and confirmed anonymous retrieval redirected to `/` and returned no PDF bytes. API, web, worker, Authentik, SeaweedFS, Caddy, PostgreSQL, Redis, and Mailpit reported healthy during these runs.

The complete 13-test Playwright suite was also attempted against this production-image stack with `container-smoke/full-e2e.config.ts`, synthetic variables, browser-only local TLS allowance, and trace capture disabled. Four tests passed: `accessibility-keyboard`, `admission-planning`, `care-delivery-evidence`, and `substitution-access`. Nine failed: `authentik-client` and `ui-foundation-caregiver` hit page-navigation timeouts; `benefits-billing` hit a `networkidle` timeout after a successful action; `documents-communications` could not resolve the synthetic hostname in Playwright's Node-side API request context; and five later logins received HTTP 429 from Better Auth after repeated synthetic login traffic. The rate limit was left in place. This full suite is **not green** and remains a separate runtime verification blocker; the focused OIDC and invoice journeys passed. Error artifacts from the failed run were removed after the sanitized results were recorded.

### Reproduction and release gate

Run the focused browser checks against fresh disposable volumes with explicit synthetic Compose and Playwright environment files, using the production Compose files plus an isolated test override:

```bash
docker compose --project-name care-goal15c-oidc-smoke \
  --env-file <synthetic-compose-env> \
  -f compose.yaml -f compose.production.yaml -f <isolated-smoke-override> \
  config --quiet

PLAYWRIGHT_USE_EXISTING_SERVERS=true \
PLAYWRIGHT_BASE_URL=https://care.home.arpa:<loopback-tls-port> \
WEB_ORIGIN=https://care.home.arpa:<loopback-tls-port> \
API_INTERNAL_URL=https://api.care.home.arpa:<loopback-tls-port> \
node --env-file=<synthetic-playwright-env> ./node_modules/.bin/playwright test \
  --config container-smoke/oidc-diagnostic.config.ts --reporter=dot --trace=off

PLAYWRIGHT_USE_EXISTING_SERVERS=true \
PLAYWRIGHT_BASE_URL=https://care.home.arpa:<loopback-tls-port> \
WEB_ORIGIN=https://care.home.arpa:<loopback-tls-port> \
API_INTERNAL_URL=https://api.care.home.arpa:<loopback-tls-port> \
node --env-file=<synthetic-playwright-env> ./node_modules/.bin/playwright test \
  --config container-smoke/playwright.config.ts --reporter=dot --trace=off
```

Goal 15C's OIDC session regression is **resolved and focused-runtime verified**. The full production-image browser suite remains **Fail** at 4/13. Goal 15B's container gate remains **Blocked** by the documented Authentik and Grafana findings and missing immutable GHCR references; no security-owner acceptance was added. Overall release readiness remains **Fail**, and the Care Platform is **not cleared for production deployment**. Accessibility, recovery, performance, and other release gates retain their independent statuses above.

Repository quality gates passed after the focused regression changes: `bun run lint` (33/33 packages), `bun run format:check` (694 files), `bun run i18n:check` (3,528 messages), `bun run typecheck` (33/33 packages), `bun run test` (51/51 tasks), `bun run build` (32/32 tasks including OpenAPI and API-client generation), and `bunx oxlint --deny-warnings --format=agent`. Final `git diff --check` is recorded after the documentation update. The 13-test production-image browser suite result remains separate and is not represented as green by these repository checks.
