# Goal 12 → Goal 13 handoff

## A. Implementation summary

**Goal 12 status: Complete.** Claims and Reminder settings now choose their existing contextual destinations from the server-fetched grants. Required repository gates and focused browser checks pass. Full authenticated Office E2E and destination API authorization remain unverified because isolated OIDC discovery is unavailable. Goal 13 is preparation only.

Production changes are limited to two existing PageHeader props:

| Page / grants                                                   | Result                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Claims: claims.read + claims.settings.manage                    | Existing Claims link, `/billing/claims`                               |
| Claims: claims.read only                                        | Exact same existing Claims link                                       |
| Claims: claims.settings.manage only                             | Existing localized Navigation.administration label, `/administration` |
| Claims: neither / unrelated grants                              | Existing localized Claims label as ordinary text                      |
| Reminder: operations.reminder_settings.manage + operations.read | Existing dashboard label and `/operations`                            |
| Reminder: management without operations.read                    | Existing localized Administration label and `/administration`         |
| Reminder: no management, including operations.read only         | Exact original early no-access paragraph; no header or settings query |

Claims reuses canRead and canManage. Reminder reuses hasPermission and the already fetched permissions. Its Button remains asChild with variant="secondary", containing one Link. The early return is unchanged. No new component, abstraction, dependency, permission, translation key or API call was added.

Changed files and sizes against starting commit `570dd6c1128c280e42198a343c38f1cd313c9c55` (newline-delimited lines / UTF-8 bytes):

| File                                                              |       Before |        After |
| ----------------------------------------------------------------- | -----------: | -----------: |
| `apps/web/src/app/(office)/billing/claims/settings/page.tsx`      | 702 / 26,403 | 710 / 26,616 |
| `apps/web/src/app/(office)/operations/reminder-settings/page.tsx` |  247 / 9,586 |  255 / 9,864 |
| `apps/web/scripts/office-navigation.fixture.ts`                   |   83 / 3,347 |  170 / 6,620 |
| `apps/web/scripts/office-navigation.test.ts`                      |  201 / 7,617 | 401 / 14,791 |
| `apps/web/e2e/office-navigation.spec.ts`                          | 506 / 20,525 | 682 / 27,224 |
| `docs/architecture/goal-12-to-goal-13.md`                         |          New | 144 / 25,153 |

The existing server fixture now supports settings-page scenarios, root translations and synthetic organization/payer/settings responses, records requests and employee lookup calls, and renders the actual returned PageHeader and alerts. Tests extend the existing navigation server and browser suites. The browser app/builder, Playwright config, package scripts, primary navigation, Administration, Billing secondary navigation and all forms/actions remain unchanged. Ignored review artifacts and Graphify output were refreshed. No production scope deviation.

## B. Architectural decisions

The pages already fetch authenticated, tenant-selected permission grants. Presentation uses those same grants without client permission evaluation or additional requests. A read grant takes precedence on Claims, including read-only users; settings management does not imply Claims read access. Reminder management still controls the entire main render, with operations.read deciding only its existing action destination.

Goal 11 already exposes `/administration` for both relevant management grants. Reusing that parent avoids offering these settings-only users a read-only destination that they lack permission to open. Plain Claims text for callers with neither capability supplies no fabricated navigation. Accessible names describe the chosen destination in each locale.

No route ownership, history, returnTo, registry or generic return-link framework is needed. Tenant context, API authorization and resource scoping remain authoritative. Link visibility is not proof of API access. AST comparison confirms each production page is identical outside its existing PageHeader eyebrow/actions value, including data requests, filters, errors, forms, actions and Reminder's early return.

## C. Verification

All commands were run from the repository root unless stated otherwise. Build completed before generation-dependent root tests and integration checks. Unchanged tasks used Turbo cache where applicable; integration tasks executed against isolated infrastructure.

| Exact command                                                                                                                   | Final result                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun test apps/web/scripts/office-navigation.test.ts apps/web/src/lib/office-navigation.test.ts`                                | 17 tests / 440 assertions, pass                                                    |
| `bun run --filter @care/web typecheck`                                                                                          | Pass                                                                               |
| `bun run build`                                                                                                                 | 32 tasks, pass; OpenAPI/client generation succeeds                                 |
| `bun run architecture:check`                                                                                                    | 159 existing violations; zero new/resolved baseline entries                        |
| `bun run architecture:test`                                                                                                     | 15 tests / 33 assertions, pass                                                     |
| `bun run lint`                                                                                                                  | 33 tasks, pass                                                                     |
| `bun run typecheck`                                                                                                             | 33 tasks, pass                                                                     |
| `bun run test`                                                                                                                  | 51 tasks; web 55 tests / 1,047 assertions, pass                                    |
| `bun run test:integration`                                                                                                      | 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80, pass |
| `bun run i18n:check`                                                                                                            | 3,585 English/German messages; parity/static scan pass                             |
| `bun run format:check`                                                                                                          | Pass                                                                               |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                               |
| `bunx oxlint --fix`                                                                                                             | Pass                                                                               |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                               |
| `graphify update .`                                                                                                             | AST-only update; 13,178 nodes / 39,728 edges / 686 communities; no API cost        |

Graphify reports that 112 community names use hub-based fallback names after clustering changed; no semantic labeling was requested. Graph metadata is not an authorization check.

### Actual page functions and compatibility

The server tests execute the real Office layout and settings page functions, using process-isolated Bun module mocks at request/session/API boundaries. The actual PageHeader, Link anchor markup, Button and real English/German catalogs render the header. Async BillingNavigation and interactive form hydration are outside this focused renderer; they are not replaced with production bypasses.

Both locales cover Claims read+manage, read-only, manage-only, neither, unrelated, duplicate/reordered grants; and Reminder read+manage, manage-only, read-only, neither, unrelated and duplicate/reordered grants. Tests check exact href/name, ordinary text without href/role/tabindex/button semantics, existing permission alerts, section/form gates, API-call decisions, tenant header preservation, empty organization selection and API failures. Reminder denial checks the exact original HTML and absence of calls, lookup, forms and sections. Goal 10 selection/visit ownership and Goal 11 Administration visibility/landing tests remain passing.

Additional before/after audit executes both original page sources and final sources for both locales, five grant sets per page, and empty/selected/failing API scenarios. All 60 reports are identical after removing only headerHtml: alerts, complete API options, employee lookups, form/section counts and exact denied HTML. Saved provenance and reports are in `artifacts/goal-12/before/source.json` and `artifacts/goal-12/render-comparison.json`. Temporary baseline source/fixture files were removed. An Oxc AST audit independently confirms changes are confined to the two intended props (`logs/scope-audit.log`).

All 21 checked files—OpenAPI, the 18 generated client files and the two catalogs—remain byte-identical to HEAD. No backend, migration, permission or architecture-baseline file changed.

### Browser commands and evidence

The installed Chromium headless shell is supplied explicitly because the default Playwright browser revision is unavailable. Writable XDG directories are used for browser configuration/cache.

```bash
SETTINGS_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-12/before SETTINGS_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-12/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal12/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal12/cache bun run --filter @care/web test:navigation
```

Result: **12 navigation tests pass**, including all ten existing Goal 10/11 cases. The entire isolated suite was also run from `apps/web`:

```bash
SETTINGS_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-12/before SETTINGS_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-12/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal12/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal12/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: **31 tests pass**: twelve navigation, six presentation and thirteen form tests.

Focused local evidence: `artifacts/goal-12/screenshots/` contains 48 PNGs and 48 JSON reports: six required permission cases × desktop 1440×900/mobile 390×900 × English/German × before/after. Original real-page output was captured before production edits. Reports include href, label, header markup and axe results. Of 24 screenshot pairs, 15 are pixel-identical, eight contain the expected manage-only label/button changes, and one English mobile read-capable Reminder control differs at one pixel (RGB 241/246/247 versus 246/248/250); its header markup is byte-identical. This minor rendering variance is retained in the evidence. `artifacts/goal-12/screenshot-comparison.json` records pixel comparisons. Read-capable headers and Reminder denial retain equivalent output; manage-only differences are confined to contextual link labels/button width. Claims without either permission loses anchor semantics while retaining its existing label and layout. Screenshot rendering uses production CSS and the existing real OfficeShell fixture, with actual server-produced header/alert HTML as its content.

All 48 focused renders have zero axe violations for WCAG 2 A/AA and WCAG 2.1 AA tags. Tests prove native Tab reachability and visible focus of the one return link, exact accessible names, unchanged secondary Button styling, no fake focusable Claims control, and no horizontal overflow. Existing drawer focus trap, close/restore behavior, keyboard shortcut, cookies and navigation compatibility checks pass. English desktop Claims and German mobile Reminder screenshots were also visually inspected.

The fixture mounts OfficeShell with synthetic pathname/Link boundaries and server HTML. It does not hydrate the complete Next settings pages, execute save actions, perform OIDC login or establish actual destination API authorization. Headers/alerts are intentionally rendered without full settings form content; screenshots are focused presentation evidence, not full-page parity evidence. Isolated OIDC discovery returned unavailable in this run (`logs/oidc.log`), so authenticated Office E2E and real destination authorization remain outstanding. Existing backend integration passes do not close that gap.

## D. Reassessed technical debt

1. **Settings-only topbar context still falls back to Overview.** Source: `lib/office-navigation.ts` matches visible hrefs and the narrow visit alias, with no settings-to-Administration alias; `components/office-shell.tsx` renders `activeItem?.label ?? labels.overview`. With only a settings management grant, Administration is visible but none of `/billing/settings`, `/billing/claims/settings` or `/operations/reminder-settings` matches it. Goal 12 Claims/Reminder manage-only screenshots visibly retain Overview/Übersicht. Read-capable users retain existing Billing/Claims/Operations ownership. This was expressly excluded and remains unchanged.
2. **Billing settings still offers organization administration without organization.read.** Source: `billing/settings/page.tsx` fetches grants but its organizationAddressNote unconditionally contains a Link to `/administration/organizations` with Billing.manageOrganizations. The Administration layout independently requires organization.read to show that destination. OrganizationsPage delegates to searchStructurePage, which uses the organization search endpoint; `modules/organizations/src/application/organization.service.ts:169` explicitly requires organization.read, then applies tenant/resource scope. A billing.settings.manage-only user therefore receives an offered destination whose owning API requires a missing grant. This is source-confirmed; no authenticated reproduction is claimed.
3. **Secondary current-state indication remains absent.** `billing/billing-nav.tsx` renders independently permission-filtered links without aria-current or active styles. `administration/layout.tsx` NavLink likewise supplies no current marker. The two Billing Overview/worklist links share a pathname and differ by hash, so a future change must define precision and uniqueness before adding markers. Goal 12 did not change either component.
4. **Other dead ends:** the two confirmed Claims/Reminder header cases are now fixed. The Billing organization note is the remaining concrete permission-dependent link identified in these inspected settings pages. The external payer source URL is documented domain content, not evidence of another permission defect. No claim of an exhaustive application-wide navigation audit is made. Management grants still do not imply unrelated read access or full access to every data-dependent settings workflow.

## E. Goal 13 preparation

**Recommended Goal 13: permission-aware Billing settings organization note.** This addresses one confirmed offered-but-restricted destination in one existing control, with an exact link-preservation/plain-text acceptance test. It is smaller than changing primary route ownership or designing current-state behavior for hash links.

- **Reproduction:** select a tenant, provide billing.settings.manage without organization.read, open `/billing/settings`. The organization address note currently offers “Manage organizations” (localized) linking to `/administration/organizations`; the organization search owner requires organization.read. Supplying organization.read enables the independently scoped destination.
- **Current → intended:** condition only that existing Link on hasPermission(permissions, 'organization.read'). With organization.read, retain exact href, localized text, className and placement, regardless of billing management. Without it, render the same existing localized manageOrganizations label as ordinary text in the unchanged note. No fallback route, fake link, disabled button, additional control or new copy. Note visibility and organizationAddressNote text remain unchanged.
- **Production file:** only `apps/web/src/app/(office)/billing/settings/page.tsx`, in the existing organization note. Reuse already fetched permissions and imported hasPermission. Do not add another API request or authorization layer.
- **Test files:** extend `apps/web/scripts/office-navigation.fixture.ts`, `apps/web/scripts/office-navigation.test.ts`, and `apps/web/e2e/office-navigation.spec.ts` using the established actual-page-function/header-or-note rendering approach. If the full page cannot render because of forms, extract the actual returned note subtree for the fixture. Keep all Goal 10–12 cases.
- **Permission/tenant boundary:** organization.read controls presentation only. Billing management, data retrieval, tenant headers, resource scoping, forms, mutations and destination/backend authorization remain unchanged. Read capability does not guarantee access to every organization; the owner still scopes results.
- **Localization/accessibility:** reuse Billing.organizationAddressNote and Billing.manageOrganizations in English/German; no catalog changes. Preserve paragraph/layout and accessible link name for readers. Nonreaders receive ordinary text without href, role, tabindex, keyboard behavior or link affordances. Preserve visible focus for the existing reader link and no overflow.
- **Regression coverage:** actual BillingSettingsPage with billing management+organization read, billing management only, organization read only, neither, unrelated grants and duplicate/reordered grants. Verify exact note/link/plain text and unchanged API requests, tenant header, permission notices/data/forms. Compare before/after desktop/mobile in both locales with/without organization.read; reader screenshots should remain equivalent. Run axe, keyboard/focus/overflow checks and all existing suites.
- **Risks:** preserve behavior for organization-read-only callers even without billing management; avoid accidentally gating the note, changing billing settings data access, or making noninteractive copy look like a link. The current settings page requests billing data before evaluating canManage; do not change that separate behavior. Synthetic note rendering still does not establish authenticated destination access.
- **Exclusions:** no primary matching/topbar, Administration visibility, sidebar, secondary nav current states, other contextual links, Goal 12 headers, settings forms/actions, translations, backend, permissions, API/client output, schema/migrations, dependencies or generic navigation abstraction.
- **Definition of done:** exact existing link retained for organization.read, same label as plain text otherwise; actual-page and browser tests pass in both locales; all required root gates pass with zero new architecture violations; generated files unchanged; Graphify refreshed; `docs/architecture/goal-13-to-goal-14.md` created from evidence; no Goal 14 implementation.

## F. Copy-ready Goal 13 prompt

```text
Goal 13: Permission-aware organization administration link in Billing settings

Repository: /home/woobb/Projects/care (woobble/care). Implement the change; no multi-agent mode.

Read AGENTS.md, apps/web/AGENTS.md and relevant installed Next guides, docs/architecture/overview.md, module-boundaries.md, docs/domains/billing.md and docs/architecture/goal-12-to-goal-13.md. Check git status and preserve unrelated work. Query Graphify before source browsing. Verify the confirmed issue against the current worktree.

Problem: billing.settings.manage does not imply organization.read. Billing settings currently always offers its organization note Link to /administration/organizations, while the organization search owner requires organization.read.

Production scope: only apps/web/src/app/(office)/billing/settings/page.tsx, the existing organizationAddressNote paragraph's Link. Reuse already fetched permissions and imported hasPermission. With organization.read, preserve the exact existing Link, /administration/organizations href, className, placement and localized Billing.manageOrganizations text, including callers without billing.settings.manage. Without organization.read, show that same localized label as ordinary text in the unchanged note, without href, role, tabindex, button behavior or link affordances. Preserve organizationAddressNote and the paragraph's existing layout/styles. Add no fallback route, additional control, API request, permission, translation key, abstraction or dependency.

Keep tenant context, resource scoping, existing billing API calls/data gates, forms/actions, alerts and destination/backend authorization unchanged. Do not modify primary matching/topbar, Administration visibility, sidebar hierarchy, secondary navigation, other contextual links, Goal 12 headers, catalogs, APIs, generated clients or schema/migrations. Do not expand the architecture baseline.

Extend existing office-navigation server fixture/tests and isolated browser tests using the actual BillingSettingsPage function and the actual returned organization-note subtree when full rendering is impractical. Cover both locales with billing management+organization read, management only, organization read only, neither, unrelated and duplicate/reordered grants. Assert exact link/plain text semantics, unchanged note, API decisions/options, tenant header and data/form gates. Keep Goal 10–12 tests passing.

Capture before/after desktop/mobile evidence in English/German with and without organization.read. Expect reader visual equivalence; nonreaders lose only the unavailable link's interactivity/affordance. Check accessible names, Tab order, visible focus, no extra focusable controls, overflow and axe. Use synthetic data only, preserve production authentication, and distinguish fixture verification from full Next hydration/OIDC/authenticated E2E and actual API authorization. Probe isolated OIDC and disclose gaps if unavailable.

Run required formatting (bunx oxlint --fix then the AGENTS.md oxfmt command), focused tests and relevant full isolated browser suites. Safely sequence bun run build before generated-output-dependent checks. Run bun run architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, build, format:check and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new architecture violations and no backend/generated/catalog changes.

Create docs/architecture/goal-13-to-goal-14.md with status, exact implementation, changed files and before/after sizes, architecture/permission decisions, exact commands/counts, screenshots/accessibility evidence and auth gaps. Reassess remaining debt from source/behavioral evidence, select one small confirmed next issue, and supply a self-contained Goal 14 prompt requiring docs/architecture/goal-14-to-goal-15.md. Do not implement Goal 14 or Goal 15.

Final response: status; exact behavior/permission matrix; tests/counts; screenshots/accessibility; auth gaps; file sizes; limitations; handoff location; copy-ready next prompt.
```
