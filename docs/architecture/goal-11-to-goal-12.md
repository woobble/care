# Goal 11 → Goal 12 handoff

## A. Implementation summary

**Goal 11 status: Complete.** Each existing billing.settings.manage, claims.settings.manage and operations.reminder_settings.manage capability now independently reveals the existing Management → Administration navigation item. All required gates and 29 isolated browser tests pass. Authenticated Office E2E and actual settings API authorization remain unverified because isolated OIDC discovery is unavailable. Goal 12 and Goal 13 are preparation only.

Production scope is exactly `apps/web/src/app/(office)/layout.tsx`: three entries were appended to the existing administrationLinks visibility list:

- billing.settings.manage → `/billing/settings`
- claims.settings.manage → `/billing/claims/settings`
- operations.reminder_settings.manage → `/operations/reminder-settings`

These records participate only in the existing canReadAdministration decision. The rendered sidebar item is still the single existing Administration item at `/administration`; no individual settings items were added. Existing Administration gates, including audit.read, remain present. Definitions, filtering, mapping and group ordering are unchanged.

Changed test files:

- `apps/web/scripts/office-navigation.fixture.ts`: optionally executes the actual Administration layout and landing page with the same synthetic authenticated grants as the real Office layout; supplies safe synthetic count/provider responses and real catalogs.
- `apps/web/scripts/office-navigation.test.ts`: adds both-locale tests for every settings subset, each old Administration gate, mixed grants, no/unrelated grants, and repeated/reordered input. Assertions inspect real layout props and rendered entry-point/secondary navigation links.
- `apps/web/e2e/support/office-navigation-app.tsx`: optionally displays the server-rendered Administration HTML inside the existing real OfficeShell fixture.
- `apps/web/e2e/office-navigation.spec.ts`: adds scoped permission/landing screenshot matrices and keyboard/mobile checks to the existing navigation workflow. Existing Goal 10 cases remain.
- This handoff. Ignored Graphify and review artifacts were refreshed.

No new production abstraction, permission registry, framework, dependency, route, grant or API was introduced. No production file outside Office layout was changed. No deviation from the requested production scope.

Before/after sizes against starting commit `af81f24`, counting newline-delimited lines and UTF-8 bytes:

| File                      | Before lines / bytes | After lines / bytes |
| ------------------------- | -------------------: | ------------------: |
| Office layout             |          181 / 6,448 |         184 / 6,700 |
| Navigation server fixture |           60 / 2,316 |          83 / 3,347 |
| Navigation layout tests   |           79 / 2,551 |         201 / 7,617 |
| Navigation browser tests  |         307 / 11,946 |        506 / 20,525 |
| Navigation browser app    |           41 / 1,241 |          48 / 1,488 |

The Administration landing page/layout, settings pages/actions, Billing navigation, OfficeShell/mobile drawer, selector, labels, cookie/shortcut, matching precedence and Goal 10 visit ownership are unchanged.

## B. Architectural and permission decisions

The three capabilities already qualify for settings entry points in `administration/page.tsx` and the Configuration links in `administration/layout.tsx`. Their corresponding settings pages also check the existing capabilities. The outer Office layout was the narrower discoverability layer; adding these cases there reuses the current structure instead of duplicating or replacing its logic.

The layout still reads authenticated, tenant-selected permission grants through the existing utilities. It evaluates whether any existing Administration capability is present and reveals one existing item. Duplicated grants and combinations cannot duplicate an item because the fixed navigation definitions are filtered once. Input grant order cannot reorder groups/items.

This does not grant tenant-member, organization/facility, employee, audit, document-template, Billing/Claims read or Operations read access. No permission definitions, backend checks, scopes or RLS rules changed. Menu discoverability does not establish destination API authorization; additional read/resource scopes can still be required by the settings workflows.

The landing page continues filtering each card independently. Its nested Administration layout continues filtering its own links independently, including Audit. Settings-only users see only their existing applicable settings destination(s), plus the existing Administration Overview link in the secondary navigation. All previous Administration visibility is retained; unrelated/no grants do not gain the item.

The shell, matcher and hierarchy need no changes: once the existing item is present, `/administration` naturally selects it in desktop/mobile navigation and uses its localized label in the topbar. No settings-path aliases were added. The existing brand link still follows its first-visible-item rule; when Administration is the sole destination, both the brand and the one Administration menu item point there. Browser item counts use the semantic sidebar-menu-button marker rather than counting every anchor with that href.

## C. Verification results

| Exact command                                                                                                                   | Final result                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun test apps/web/scripts/office-navigation.test.ts apps/web/src/lib/office-navigation.test.ts`                                | Pass: 13 tests / 210 assertions                                                    |
| `bun run architecture:check`                                                                                                    | Pass: 159 existing violations; zero new or resolved baseline entries               |
| `bun run architecture:test`                                                                                                     | Pass: 15 tests / 33 assertions                                                     |
| `bun run lint`                                                                                                                  | Pass: 33 tasks                                                                     |
| `bun run typecheck`                                                                                                             | Pass: 33 tasks                                                                     |
| `bun run test`                                                                                                                  | Pass: 51 tasks; web 51 tests / 817 assertions                                      |
| `bun run test:integration`                                                                                                      | Pass: 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80 |
| `bun run i18n:check`                                                                                                            | Pass: 3,585 English/German keys; static scan passes                                |
| `bun run build`                                                                                                                 | Pass: OpenAPI generation and 32 build tasks                                        |
| `bun run format:check`                                                                                                          | Pass                                                                               |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                               |
| `bunx oxlint --fix`                                                                                                             | Pass                                                                               |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                               |
| `bun run --filter @care/web typecheck`                                                                                          | Pass                                                                               |
| `graphify update .`                                                                                                             | Pass: AST-only; 13,150 nodes / 39,699 edges / 699 communities; zero API cost       |

Browser commands:

```bash
ADMINISTRATION_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-11/before ADMINISTRATION_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-11 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal11/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal11/cache bun run --filter @care/web test:navigation
```

Result: **all ten navigation browser tests pass**, including the six Goal 10 cases and four new localized cases. The complete existing isolated configuration was also run from apps/web:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal11/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal11/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: **29 tests pass**: ten navigation, six presentation and thirteen form cases. Build completed before the final generation-dependent gates; unchanged workspace tasks used Turbo cache where applicable.

### Actual-layout and actual-page coverage

The tests execute OfficeLayout and its async workspace component, AdministrationLayout, and AdministrationPage. Request/session/cookie/API boundaries are synthetic; permission values are supplied to the real filtering code rather than substituted into a duplicated navigation definition.

Coverage includes all eight subsets of the three settings capabilities (singletons, pairs, all, none), all seven previously supported Administration gates individually including Audit, settings mixed with existing grants, five unrelated read capabilities, repeated and reversed grants, unchanged group/item ordering, the `/administration` destination and both locales. It also retains all pure Goal 10 matching/precision/precedence tests.

Rendered card hrefs and secondary navigation are inspected to prove independent landing-page filtering. For isolated settings grants, unrelated administrative cards/links are absent. Audit-only visibility remains intact and its existing secondary Audit link remains present; no new Audit card was added to the landing page.

Additional compatibility audit: 34 real Administration layout/landing renders are byte-identical before/after. All existing/unrelated/no-grant Office layout props also match. Removing exactly the three new capability/href records makes the entire Office layout AST match HEAD, proving the rest of its requests, permission checks, filtering, hierarchy, ordering and props are unchanged. Baseline source provenance is recorded in `artifacts/goal-11/before/source.json`.

### Screenshots, accessibility and boundaries

Ignored local review evidence is in **`artifacts/goal-11/`**:

- 84 PNGs and 84 JSON scenario reports: seven permission cases × three surfaces × two locales × before/after.
- Cases: each settings permission alone, all three together, unrelated client.read, no grants, and audit.read only.
- Surfaces: expanded/collapsed desktop at 1440×900 and mobile drawer at 390×900. The actual Administration layout/landing HTML is displayed with the production stylesheet.
- All 18 audit/unrelated/no-grant control pairs are byte-identical by SHA-256. The 24 newly visible settings pairs differ only as intended: the existing Management/Administration entry and selected state/context become available. Landing content remains identical.
- Settings-only `/administration` selects exactly one Administration menu item with its existing destination, data-active and aria-current. Both localized group/context labels, collapsed title/aria-label and existing icon are verified.
- Actual keyboard Tab/Enter reaches the menu item with visible focus. The real mobile Sheet retains its focus trap, Escape close, link-close and trigger focus restoration. Goal 10 collapse/shortcut/cookie and visit tests pass unchanged.
- No unexpected horizontal overflow. Full-fixture axe scans report **zero violations** for the tested before/after states, including rendered contrast checks.

Representative files:

- `artifacts/goal-11/en-settings-1-expanded-before.png`
- `artifacts/goal-11/en-settings-1-expanded-after.png`
- `artifacts/goal-11/de-settings-4-mobile-after.png`
- `artifacts/goal-11/en-audit.read-expanded-after.png`

The fixture uses the real shell, selector, drawer and server-rendered Administration components. It stubs request/auth/API transport, pathname/Link integration and unrelated topbar controls. The server HTML is not a fully hydrated Next page; href correctness is asserted, and synthetic pathname changes use the existing bridge. Initial browser failures correctly exposed an overly broad locator counting the brand link and a test treating an ordinary unhydrated anchor reload as Next navigation. Both test assumptions were corrected; no production behavior was changed to accommodate them.

An earlier process/temporary-file handle was unavailable on continuation. Baselines were recreated from the unchanged HEAD Office layout with the same current fixture boundaries, and evidence/logs were saved under durable ignored workspace artifacts. The final browser run completed successfully. Commands and results are in `artifacts/goal-11/logs/`.

A bounded read-only `.env.test` OIDC discovery probe returned no response. **Full authenticated Office E2E and actual settings-only API authorization/tenant-scope behavior remain unverified.** Broad backend integration gates passed, but they are not claimed as proof of these specific settings-only scenarios. No production auth bypass, live customer data or new permissions were used.

Backend/public OpenAPI/generated clients, catalogs, permission definitions/grants, routes, settings forms/actions and navigation matcher/shell remain unchanged. Architecture baseline is untouched. Graphify refreshed its aggregated HTML; 120 changed communities received hub-derived fallback labels. Semantic document extraction/relabeling remains outside this AST-only update.

## D. Remaining technical debt

Confirmed and separate from this completed slice:

- With only a settings-management grant, `/administration` is now correctly selected, but `/billing/settings`, `/billing/claims/settings` and `/operations/reminder-settings` still have no primary owner match. OfficeShell falls back to Overview. Adding the corresponding normal read grant restores Billing, Claims or Operations ownership through existing matching. Goal 11 intentionally added no aliases.
- `billing/claims/settings/page.tsx` renders a PageHeader eyebrow link to `/billing/claims` without conditioning it on canRead. The same component computes claims.read and shows noClaimsPermission when absent; Claims list also displays that warning and suppresses its records without claims.read.
- `operations/reminder-settings/page.tsx` requires reminder-settings management before rendering, but its header action always points to `/operations`. That dashboard explicitly returns noAccess without operations.read.
- The Billing settings note links to organization administration independently of organization.read. This is a separate setup-link concern, not the contextual return-control scope proposed below.
- Administration and Billing secondary navigation use generic muted/hover links without a current-destination marker. This is a concrete source observation, not an assertion of a WCAG violation or a mandate for a new design system.
- Primary topbar remains an owner label rather than breadcrumbs. Broader grouping/label changes lack user-study evidence. Full app hydration, screen-reader and authenticated API/settings workflows remain unverified here.

## E. Goal 12 preparation

Inspected the post-Goal-11 server groups, pure selector, OfficeShell/topbar, Administration layout/landing, BillingNavigation, the three settings pages, Claims list, Operations dashboard and existing server/browser fixtures.

### Candidate evaluation

| Candidate                                 | Reproducible user impact                                                                                                                                                                                             | Safety, size and test feasibility                                                                                                                                                                 | Decision                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Settings owner fallback                   | Real filtered groups expose Administration but the three settings URLs still return no owner; with normal read grants they select their current owners. The synthetic browser reproduces Billing's Overview context. | Small pure-helper change and good fixtures, but must preserve native owner precedence and exact paths. Changes orientation, not the inappropriate contextual destinations below.                  | Valid future candidate; do not add aliases in the chosen next slice.                                          |
| Permission-aware settings return controls | Claims settings and Reminder settings present controls targeting read-gated pages even when the corresponding read grant is absent. Existing target pages visibly report missing permission/no access.               | Two existing PageHeader controls, using booleans/utilities/translations already present. No new abstraction or backend rule. Actual-page/header tests and synthetic browser checks are practical. | **Recommended Goal 12.** Prevents a concrete read-permission dead end using already-available Administration. |
| Secondary navigation current state        | Administration/Billing secondary links do not identify the current destination.                                                                                                                                      | Useful orientation improvement, but server layout path context/client boundary and consistent styling need a separate design/testing decision. No demonstrated authorization dead end is solved.  | Defer.                                                                                                        |

This selection considers reproducible impact, permission safety, implementation size, browser-test feasibility, architectural simplicity and compatibility risk. It does not automatically choose settings-path aliases merely because the previous handoff noted that mismatch.

### Exact problem and desired behavior

**Problem:** settings-management access is independent of Claims/Operations read access. Two contextual return controls assume those read capabilities and can take a settings-only user to a missing-permission view. Goal 11 now supplies a discoverable Administration parent that already exposes the applicable settings entry point.

**First scope: permission-aware contextual return destinations on only these two pages:**

1. `app/(office)/billing/claims/settings/page.tsx`, PageHeader eyebrow:
   - With claims.read, retain the current Claims label/link to `/billing/claims` exactly.
   - Without claims.read but with claims.settings.manage, link to `/administration` using existing `Navigation.administration` text.
   - Without either capability, do not fabricate an Administration link. Render the existing Claims label as noninteractive text while preserving the page's current permission alerts and data gates.
2. `app/(office)/operations/reminder-settings/page.tsx`, existing PageHeader action:
   - With reminder-settings management and operations.read, retain the current dashboard destination/label exactly.
   - With reminder-settings management but no operations.read, reuse the same button treatment for `/administration` with existing `Navigation.administration` text.
   - Preserve the current no-access early return when management permission is absent.

The server components already have permissions, hasPermission and root translations. Reuse them; do not introduce a shared permission registry, new client state, route history heuristics or a generic return-navigation framework.

### Constraints and acceptance criteria

- **Authorization/tenant:** no grants, scopes, API requests, payloads, auth or destination authorization change. Administration fallback is shown only when the corresponding existing settings-management grant makes that parent visible under Goal 11. Do not infer full API access from a header link.
- **Compatibility:** normal read-capable users retain exact current labels/hrefs and layout. Claims read-only users keep their Claims link. Reminder users without management retain no-access behavior. Settings forms/actions, query handling, validation, data gating and alerts remain unchanged.
- **Visual/accessibility/localization:** reuse PageHeader/Link/existing Button styling and catalog keys in both locales. Accessible names must name the actual destination. Preserve keyboard order; noninteractive denied-state text must not become a fake link. Add no decorative UI, breadcrumb system or catalog keys.
- **Regression tests:** execute actual page functions with synthetic request/grant boundaries, inspect/render the actual PageHeader, and cover owner-read plus manage, manage-only, owner-read-only, neither, and unrelated grants. Assert exact destinations/labels and unchanged API calls and denied views. Retain Goal 10/11 navigation tests.
- **Browser/screenshot strategy:** compare normal and manage-only header states at desktop/mobile widths in both locales using existing isolated shell tooling and synthetic data. Verify keyboard reachability, visible focus, link targets, layout fit and axe. If full settings pages require unavailable infrastructure, scope fixtures to headers rendered by the actual page functions and explicitly report that boundary. Run authenticated target navigation only when isolated OIDC/settings stack is available.
- **Exclusions:** primary route-owner aliases/topbar behavior, global hierarchy, Administration visibility, Billing organization setup link, secondary navigation markers, other pages, forms/actions, grants, backend/API/database changes, Caregiver navigation and Goal 13 implementation.
- **Definition of done:** the two contextual controls choose an available destination for the tested capability sets; ordinary read-capable behavior remains identical; no restricted parent link is synthesized; localized route/header/browser tests and all quality gates pass; Graphify and `docs/architecture/goal-12-to-goal-13.md` are complete.

Measurable benefit: settings-only users get a contextual return to their available Administration parent instead of a control leading to an owner page that reports missing read access. Primary settings-owner context remains an explicitly deferred issue.

## F. Copy-ready Goal 12 prompt

> Implement Goal 12 in woobble/care: make the contextual return controls on Claims settings and Operations reminder settings respect the user's existing read permissions. Read docs/architecture/goal-11-to-goal-12.md, architecture overview/module boundaries, applicable AGENTS.md, frontend i18n docs and relevant installed Next.js guides. Inspect the verified worktree/Graphify, both actual page functions, target permission handling, Goal 11 Administration visibility and existing fixtures. Preserve unrelated changes; no multi-agent mode.
>
> Change only the PageHeader eyebrow on app/(office)/billing/claims/settings/page.tsx and the existing PageHeader action on app/(office)/operations/reminder-settings/page.tsx. Claims read users keep the current Claims link/label. A Claims settings manager without claims.read gets an Administration link at `/administration` using existing Navigation.administration text. With neither capability, keep the Claims label as plain text and preserve permission alerts/data gates. Reminder settings managers with operations.read keep the existing dashboard link/label; managers without it get `/administration` using the same existing button treatment and label vocabulary. Preserve the existing early no-access return without reminder management.
>
> Reuse already-fetched server permissions, translations, PageHeader, Link and Button. Do not grant access, change APIs/data queries/forms/actions, add returnTo/history heuristics, introduce new abstractions, change catalogs or redesign navigation. Do not alter Administration visibility, primary route-owner aliases/topbar, secondary navigation, Billing organization setup links, Caregiver navigation or Goal 13. Destination pages/backend remain authoritative; management alone does not prove every settings API operation is authorized.
>
> Add meaningful actual-page/header regressions for read+manage, manage-only, read-only, neither and unrelated capability sets in English/German. Verify exact link labels/hrefs, no synthesized restricted parent, unchanged denied behavior and API calls. Retain Goal 10/11 matching/visibility tests. Capture scoped before/after desktop/mobile header evidence and check keyboard/focus/overflow/axe using existing synthetic fixtures; run authenticated settings navigation only if isolated OIDC/test infrastructure is available and clearly report remaining gaps. Use no production data or auth bypass.
>
> Run architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, build, format:check, strict oxlint and relevant browser checks. Sequence generated-client builds safely. Refresh Graphify. Create mandatory docs/architecture/goal-12-to-goal-13.md with status/files/sizes, permission/navigation decisions, exact verification and limitations, remaining debt and a focused evidence-based Goal 13 plan and copy-ready prompt. Complete the implementation and handoff; do not implement Goal 13.
