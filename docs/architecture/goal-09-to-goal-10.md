# Goal 09 → Goal 10 handoff

## A. Goal 09 implementation summary

**Status: Complete.** Exactly four duplicated destructive error banners now reuse the existing ErrorNotice. All required checks pass. Scoped server-rendered/browser evidence is available; full authenticated Office E2E remains unverified because isolated OIDC discovery is unavailable. Goal 10 and Goal 11 are preparation only.

Production files modified:

| Route                 | Condition preserved verbatim | Message preserved verbatim                |
| --------------------- | ---------------------------- | ----------------------------------------- |
| Employees list        | `query.error`                | `t('Errors.generic')`                     |
| Employees list        | `employeesResult.error`      | `t('Employees.loadFailed')`               |
| Operations work queue | `query.error`                | `translate(errorMessageKey(query.error))` |
| Operations work queue | `queueResult.error           |                                           | organizationLookup.failed` | `t('loadFailed')` |

Each route adds ErrorNotice to its existing page-patterns import and uses it at the same document position. The component remains unchanged: a role-alert paragraph with the existing destructive colors, border/radius and p-3 spacing. Employee load failure intentionally changes from p-4 (16px) to p-3 (12px). The other three banners produce identical styled output.

Error conditions remain independent, including when both notices coexist. API calls, organization lookup, permission checks, filters, counts, pagination, empty states, rows/cards/actions, navigation and successful states are unchanged. Operations permission denial, completed-task status and truncation warning retain their original JSX and semantics. No RHFActionForm/result/validation, backend, schema, migration, API, theme, translation or authentication changes.

Test/wiring files:

- Created `apps/web/scripts/error-notices.fixture.tsx`: renders the actual async route functions with synthetic API responses and real translation catalogs, PageHeader and ErrorNotice. It isolates request/Next boundaries and non-target complex children; it does not add a production route or auth bypass.
- Created `apps/web/scripts/error-notices.test.ts`: six route-level Bun tests in both locales, exercising 28 scenario combinations and explicit rendered HTML/request assertions. The existing web test command already includes scripts.
- Created `apps/web/e2e/error-notices.spec.ts`: six Playwright cases across both locales and 390/768/1440px, each covering Employee query/load/normal and Operations query/load/normal states. Uses the existing isolated browser configuration, production CSS and server-rendered synthetic fixtures; no new framework/dependency/server.
- Updated `apps/web/playwright.forms.config.ts` to discover both narrow browser suites. `test:forms` now explicitly selects the original RHF file, retaining its independent 13-case scope; new `test:presentation` selects the notice file.
- Created this handoff; refreshed ignored local Graphify output.

Sizes against starting commit `53d091b`, counting newline-delimited lines and UTF-8 bytes:

| File                       | Before lines / bytes | After lines / bytes |
| -------------------------- | -------------------: | ------------------: |
| Employee list              |         423 / 17,367 |        409 / 17,078 |
| Operations work queue      |         756 / 29,110 |        744 / 28,839 |
| Web package manifest       |           49 / 1,513 |          50 / 1,639 |
| Isolated Playwright config |             15 / 458 |            15 / 485 |
| Route-rendering fixture    |                    — |          94 / 3,272 |
| Route regression tests     |                    — |         136 / 5,311 |
| Presentation browser tests |                    — |         158 / 6,430 |

No files removed. Test code is scoped to these four notices; no shared UI abstraction was added.

## B. Verification results

| Exact command                                                                                                                   | Result                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun run architecture:check`                                                                                                    | Pass: 159 existing violations; zero new or resolved baseline entries               |
| `bun run architecture:test`                                                                                                     | Pass: 15 tests / 33 assertions                                                     |
| `bun run lint`                                                                                                                  | Pass: 33 tasks                                                                     |
| `bun run typecheck`                                                                                                             | Pass: 33 tasks                                                                     |
| `bun run test`                                                                                                                  | Pass: 51 tasks; web 38 tests / 607 assertions                                      |
| `bun run test:integration`                                                                                                      | Pass: 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80 |
| `bun run i18n:check`                                                                                                            | Pass: 3,585 keys in English/German parity; static scan passes                      |
| `bun run build`                                                                                                                 | Pass: OpenAPI generation and 32 build tasks                                        |
| `bun run format:check`                                                                                                          | Pass                                                                               |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                               |
| `bunx oxlint --fix`                                                                                                             | Pass                                                                               |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                               |
| `bun run --filter @care/web typecheck`                                                                                          | Pass                                                                               |
| `bun test apps/web/scripts/error-notices.test.ts`                                                                               | Pass: six tests / 134 assertions                                                   |
| `graphify update .`                                                                                                             | Pass: AST-only; 13,094 nodes / 39,606 edges / 689 communities; zero API cost       |

Browser commands executed successfully:

```bash
ERROR_NOTICE_BASELINE_DIR=/tmp/care-goal09/before ERROR_NOTICE_CSS=/tmp/care-goal09/styles.css ERROR_NOTICE_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-09 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/tmp/care-goal09/config XDG_CACHE_HOME=/tmp/care-goal09/cache bun run --filter @care/web test:presentation
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/tmp/care-goal09/config XDG_CACHE_HOME=/tmp/care-goal09/cache bun run --filter @care/web test:forms
```

Results: six presentation browser cases and all thirteen existing form browser cases pass. Test generation/build commands were sequenced to avoid concurrent API-client generation. Turbo reused unchanged workspace results where applicable. A test-only lint suppression was moved to cover a formatter-split sequential await; final strict lint is clean.

The six Bun tests execute the actual server route functions in separate processes, avoiding mock pollution of existing feature tests. They verify absent/present notices, unchanged localized messages, role-alert markup, banner order, both independent errors together, queue failure versus organization lookup failure (including both), successful empty loading, unchanged API request/query/tenant headers, unchanged no-access early return with no API requests, and separate role-status completion/truncation notices. Request access, comboboxes, pagination and filter disclosure are isolated boundaries; these are presentation regressions, not an authentication test.

### Screenshots, metrics and accessibility

Before changing the production routes, twelve baseline HTML fixtures and the current built production stylesheet were saved in `/tmp/care-goal09/`. After the change, the same synthetic scenarios were rendered and captured in Chromium using the same CSS, light theme and viewport sizes.

Evidence is in **`artifacts/goal-09/`** (ignored local review artifacts):

- 72 PNG screenshots: six scenarios × two locales × three widths × before/after.
- 36 JSON metric reports with positions, sizes, padding, colors, border/radius, axe rule findings and first-three-tab sequences.
- 30 screenshot pairs are byte-identical by SHA-256. Only the six Employee load-error pairs differ.
- Employee load-error padding measures 16px → 12px. For example, German at 390px retains x=16/y=153/width=358 and changes height 82 → 74px. Colors, border, radius and message remain identical; following content moves up by the expected 8px.
- All other notice geometry is identical. Text wraps correctly at the tested widths. Tab order matches before/after, with no interactive element added to the passive banners.
- Scoped axe scans of all tested alert states report **zero violations before and after**, including contrast checks supported by Chromium. No success notice was transformed into an alert.

Representative files:

- `artifacts/goal-09/de-employees-load-390-before.png`
- `artifacts/goal-09/de-employees-load-390-after.png`
- `artifacts/goal-09/en-operations-query-1440-after.png`
- `artifacts/goal-09/de-employees-load-390-metrics.json`

The screenshots show actual route output with synthetic empty responses and the production stylesheet. They omit the authenticated Office shell and stub non-target complex controls. They do not establish real OIDC/API transport, full-page hydration, drawer behavior, every theme/font environment or end-to-end workflow coverage. A bounded read-only discovery request using `.env.test`'s OIDC issuer returned no response; authenticated Office E2E was therefore not started. No real employee/client/tenant data appears in the evidence.

Additional read-only source audit (`bun /tmp/care-goal09/verify-extraction.ts`): both entire route ASTs match their starting versions after expanding exactly four ErrorNotice elements and normalizing only the accepted Employee load padding. It ignores source positions, redundant parentheses and insignificant multiline JSX whitespace. All predicates, translations, API calls, permissions, statuses, navigation and other JSX match. Shared ErrorNotice is byte-identical. Backend, public OpenAPI, generated API clients, catalogs, architecture baseline and unrelated production files remain unchanged.

Graphify rebuilt its aggregated HTML for the >5,000-node graph. Community changes received hub-derived fallback labels (122 renamed); semantic relabeling/document extraction remains outside the AST-only refresh. Temporary check logs are in `/tmp/care-goal09/`.

## C. Remaining UI debt

Confirmed outside Goal 09:

- Other routes still contain inline error/status markup, including Visit detail and Client detail. The four requested notices are complete; this is not an invitation for an application-wide rollout.
- Employee, receivables and work-queue empty states use different plain/card treatments; Clients and Operations dashboard reuse EmptyState. Different page widths, gaps and mobile table/card breakpoints remain.
- RHFActionForm remains 820 lines, with the Goal 08 opt-in result path intentionally limited to Clients personal data. Other action contracts remain legacy.
- Office topbar context reflects one active navigation item, not a full breadcrumb hierarchy. Detail PageHeaders provide their own owner/back links.
- Direct Office visit-detail URLs do not match a navigation item and fall back to Overview; the page itself defaults its back/eyebrow link to Planning. This is the focused Goal 10 candidate below.
- Full authenticated browser, navigation, screen-reader and dark-theme verification was not possible in this environment. The isolated banner evidence is complete at its stated scope and does not prove those broader properties.

## D. Goal 10 preparation: Office navigation

Inspected:

- `app/(office)/layout.tsx`, `components/office-shell.tsx` and `components/office-mobile-navigation.tsx`.
- `app/care/layout.tsx`, shared PageHeader, NavigationProgress and relevant Office route structure.
- Office visit-detail route, intercepted visit modal and shared `visit-detail.tsx`, including safePlanningReturnTo/back links.
- Administration landing links and permission rules.
- English/German Navigation catalogs, `e2e/office-shell.spec.ts`, `e2e/accessibility-keyboard.spec.ts` and existing browser support utilities.

### Current hierarchy and entry points

| Group                                        | Visible destinations and permission gates                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace / Arbeitsbereich                   | Overview `/operations` and Operations `/operations/worklist`: operations.read; Planning `/planning`: schedule.read; Clients `/clients`: client.read; Admissions `/admissions`: onboarding.read; Employees `/employees`: employee.read                  |
| Services & finance / Leistungen & Abrechnung | Services: service.read; Benefits: benefits.read; Billing `/billing`: billing.read; Payer claims `/billing/claims`: claims.read; Documentation `/documentation`: care_documentation.review; Service evidence `/service-evidence`: service_evidence.read |
| Management / Verwaltung                      | Documents: documents.read; Communications: communications.read; Administration `/administration`: visible when any listed administration capability is present                                                                                         |

Administration visibility checks tenant member, organization, facility, team, qualification/employee, document-template and audit read/manage capabilities; it does not simply require tenant.members.read. The runtime href is the Administration landing page, which filters its own links. Its list also includes billing/claims settings. Settings-only visibility may deserve a separate role/grant review because the shell's administration visibility list is narrower; do not change policy on inference alone.

Overview and Operations are related but distinct destinations: a dashboard and a work queue, not duplicate routes. Tasks, recurring tasks, deadlines and issue history are discovered within Operations pages. Visit execution/review details are entered from planning and related resources; Office has no `/visits` sidebar/list entry. Documentation review and service evidence have separate gated destinations. Claims has its own entry inside the Billing path hierarchy. Record-scoped subpages such as Client benefits retain Clients as their navigation owner; do not automatically reroute them to global Benefits.

### Desktop, mobile and active state

At md (768px) and above, OfficeShell shows a persistent collapsible sidebar. Collapse state is stored in `care-office-sidebar`; the existing Ctrl/Meta+B shortcut operates on desktop. Collapsed links have aria-label/title, hidden visual labels and focus rings. The sidebar is an aside/complementary region; mobile supplies a separate named nav landmark.

Below md, a lazy-loaded Sheet uses the same NavigationGroups and active item. Selecting a link closes it. Resizing to desktop closes the drawer; close-focus returns to the trigger on mobile or the page-context span on desktop. These existing behaviors should be preserved. The topbar context is focusable programmatically (tabIndex=-1), identifies the selected owner label and otherwise falls back to Overview.

Active-item selection filters only the already permission-visible groups. Overview matches exactly `/operations`. Operations owns nested `/operations/*` paths. Other items use exact/segment-prefix matching, then the longest href wins. This correctly distinguishes `/billing/claims/:id` from its Billing parent and preserves standard Client/Employee nested highlighting.

A read-only evaluation of the actual current helper and selection order gives:

| Path                        | Selected item                       |
| --------------------------- | ----------------------------------- |
| `/operations`               | overview                            |
| `/operations/tasks/fixture` | operations                          |
| `/planning`                 | planning                            |
| `/billing/claims/fixture`   | claims                              |
| `/visits/fixture`           | none; topbar falls back to Overview |

`app/(office)/visits/[id]/visit-detail.tsx` imports Planning actions and defaults its validated return target to `/planning`; its eyebrow/back link also names Planning. The unmatched direct visit URL is therefore a confirmed source-level context inconsistency, not a finding from a live usability study. During intercepted modal navigation, actual pathname/background behavior must be verified in the isolated application before asserting the same runtime symptom.

Office and Caregiver shells are intentionally different. Care uses a compact Today/Calendar navigation, user/tenant-scoped draft context and visit_execution.read gate, without Office's permission-grouped sidebar. Care links do not currently use the Office active-item helper. Goal 10 should not merge or redesign these shells.

Navigation labels already exist in both languages: Planning / Einsatzplanung, Overview / Übersicht, Operations / Büroorganisation, etc. PageHeader eyebrow links are route-owned; there is no need for a global breadcrumb framework to fix the selected issue. The current navigation browser suite covers collapse/expand, themes, focus, mobile drawer, reduced motion, hover/active styles and responsive widths; the accessibility suite covers high-frequency Office routes. Neither current source coverage nor the blocked authenticated browser run proves direct visit-owner highlighting.

### Recommended first improvement

Make direct Office `/visits/:id` pages retain **Planning** as their active navigation owner **when the Planning item is already visible**. Reuse that active owner for desktop sidebar, mobile drawer and topbar context. Keep all routes, labels, hierarchy, permissions, return links and data calls unchanged.

Measurable benefit: at an authorized direct visit URL, zero selected links/Overview fallback becomes exactly one Planning link with aria-current=page and Planning/Einsatzplanung topbar context. Users retain their workflow location while reviewing a visit. Do not add a new Visit navigation destination, expose a missing Planning grant or introduce a complete redesign.

## E. Goal 10 execution plan

First scope:

1. Record active selections for direct `/visits/<synthetic-id>` with Planning present/absent, `/planning`, `/operations`, nested Operations, `/billing/claims/<id>`, Client/Employee details and unrelated lookalike prefixes.
2. Extend the existing active-item ownership logic only: let the permission-visible Planning item own the `/visits/` segment prefix. Retain exact/segment-prefix behavior and the current longest-match rule elsewhere. Keep the logic pure; a small shared helper is justified only if it enables meaningful focused tests without coupling components to route code.
3. Continue deriving every desktop/mobile/topbar active state from the same selected item. Do not add groups/items, fetch permissions on the client or change authorization. With Planning absent, never synthesize a Planning link or label; retain the existing unmatched-route fallback unless a separate documented decision requires otherwise.
4. Preserve lazy drawer behavior, link-close handling, focus return, keyboard shortcut, sidebar cookie, collapsed labels/tooltips, existing back links, safe return targets and all Next interception routes. Verify intercepted modal behavior separately when runtime infrastructure permits.
5. Test matching/selection as actual behavior, plus rendered desktop/mobile aria-current counts and topbar text in both locales. Preserve Claims precedence, Operations dashboard exclusion, nested-record ownership and nonmatching `/visits-other` paths. Use synthetic data only.
6. Capture before/after collapsed/expanded desktop (1440/768px) and mobile drawer (390px) contexts. With isolated OIDC available, test a direct visit URL and opening/closing its intercepted modal. Without it, use existing narrow fixture infrastructure for shell rendering and explicitly report the application/interception gap.
7. Check keyboard focus visibility, accessible link names, exactly one current link per navigation surface, trigger/close focus behavior, overflow and axe. No new interactive controls or translation keys should be needed.
8. Run architecture checks/tests, lint, typecheck, unit/integration, i18n, build, formatting and strict lint, plus relevant browser regressions. Sequence generation-dependent gates. Refresh Graphify and create the next handoff.

Likely files: `components/office-shell.tsx`, a small pure navigation helper and tests if needed, existing/narrow Office navigation browser fixtures, browser/test wiring only where necessary, and `docs/architecture/goal-10-to-goal-11.md`. Server Office layout and catalogs should need no changes; change them only if current evidence demonstrates a requirement compatible with this scope. No backend or API changes.

Explicit exclusions: route changes, new navigation destinations, permission policy changes, settings-only administration visibility, full breadcrumb design, global regrouping/relabeling, Caregiver navigation, backend/API/database changes, UI tokens/themes, unrelated presentation rollout and Goals 11 implementation. Goal 11's concrete scope must be chosen from the completed Goal 10 audit rather than invented in this handoff.

## F. Copy-ready Goal 10 prompt

> Implement Goal 10 in woobble/care: improve Office navigation context for direct visit-detail URLs. Read docs/architecture/goal-09-to-goal-10.md, architecture overview/module boundaries, frontend i18n docs, applicable AGENTS.md and relevant installed Next.js guides. Inspect current worktree, Graphify, Office layout/shell/mobile drawer, route structure, visit-detail/back-link behavior, permission filtering and navigation tests. Preserve unrelated changes; no multi-agent mode.
>
> Extend the existing active-item matching so the already permission-visible Planning item owns the `/visits/` segment prefix. Reuse the single selected item across desktop sidebar, mobile drawer and topbar context. A direct `/visits/:id` should select exactly one Planning link and show Planning/Einsatzplanung rather than an unmatched Overview fallback. Do not add links or expose Planning when its item is absent. Preserve all current routes, labels, grants, API calls, fallback behavior for other unmatched paths, Claims longest-prefix precedence, Operations exact-dashboard matching and nested Client/Employee ownership.
>
> Keep the change small. Reuse existing shell/UI/navigation infrastructure; extract a pure matching helper only if needed for meaningful tests. Preserve collapsed/expanded sidebar behavior, cookie/shortcut, mobile Sheet loading/close/focus, accessible link names, return links, safePlanningReturnTo and interception routes. Do not change Office hierarchy, breadcrumbs, Caregiver navigation, themes, backend/API/database contracts, authentication or authorization. Do not implement Goal 11.
>
> Add focused selection and rendered navigation regressions in English/German, including Planning present/absent, direct visit detail, lookalike prefixes, nested Claims/Operations/record pages and exactly one current link per navigation surface. Capture desktop/mobile before/after contexts, check keyboard/focus/overflow and axe. Run actual direct/intercepted Office flows only with isolated OIDC and the test stack; otherwise use scoped synthetic fixtures and report that full authenticated/interception behavior remains unverified. No production data or auth bypass.
>
> Run architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, build, format:check, strict oxlint and relevant browser regressions. Avoid concurrent commands that regenerate the API client. Refresh Graphify. Create mandatory docs/architecture/goal-10-to-goal-11.md with implementation/files/sizes, exact verification and gaps, remaining navigation debt, and a focused evidence-based Goal 11 plan and copy-ready prompt. Complete the implementation and handoff and report precise results/limitations.
