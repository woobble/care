# Goal 13 → Goal 14 handoff

## A. Goal 13 summary

**Status: Complete.** The Billing settings organization-address note now uses the already fetched grants to condition its existing Link on `hasPermission(permissions, 'organization.read')`. Readers retain the exact Link, `/administration/organizations` href, `font-medium underline` className, localized label and placement. Nonreaders receive the same localized manageOrganizations label as ordinary inline text. Billing management does not control this link.

The paragraph, organizationAddressNote, explicit separating space and container styling remain unchanged. There is no fallback destination, extra control, disabled styling, fake link semantics or new abstraction. Only `apps/web/src/app/(office)/billing/settings/page.tsx` changes production behavior, confined to the existing note. All required gates pass; full authenticated Office E2E and actual destination authorization remain unverified because isolated OIDC discovery is unavailable. Goal 14 has not been implemented.

| organization.read                    | billing.settings.manage   | Organization note                        |
| ------------------------------------ | ------------------------- | ---------------------------------------- |
| Present                              | Present                   | Exact original link                      |
| Absent                               | Present                   | Same label, plain text                   |
| Present                              | Absent                    | Exact original link                      |
| Absent                               | Absent / unrelated grants | Same label, plain text                   |
| Duplicate / reordered / mixed grants | Any                       | Same result from organization.read alone |

Before/after sizes against starting commit `77875d0723ef7911195a231a798832314530596a`, in newline-delimited lines / UTF-8 bytes:

| File                                                  |       Before |        After |
| ----------------------------------------------------- | -----------: | -----------: |
| `apps/web/src/app/(office)/billing/settings/page.tsx` | 301 / 10,998 | 305 / 11,125 |
| `apps/web/scripts/office-navigation.fixture.ts`       |  170 / 6,620 |  261 / 9,993 |
| `apps/web/scripts/office-navigation.test.ts`          | 401 / 14,791 | 528 / 20,088 |
| `apps/web/e2e/office-navigation.spec.ts`              | 682 / 27,224 | 835 / 33,488 |
| `docs/architecture/goal-13-to-goal-14.md`             |          New | 151 / 28,135 |

The existing fixture now executes BillingSettingsPage with empty/populated/failing synthetic responses, extracts its actual note and other returned elements, records complete requests, and inspects real RHFActionForm trees and save-action identity without mounting forms. The server tests add a both-locale permission/API compatibility matrix. The browser suite adds actual-note screenshots, semantics, keyboard, focus, axe, overflow and unchanged surrounding navigation/status/heading checks. Existing Goal 10–12 cases remain intact.

The only intended visual change is removal of the note label's link underline and medium weight for nonreaders. The note keeps its text, whitespace and dimensions; readers remain visually identical. No production scope deviations. API/backend, permission definitions, tenant context, generated clients, catalogs, forms/actions, Goal 12 headers, Office matching/sidebar/topbar, BillingNavigation and Administration are unchanged.

## B. Permission and architecture decisions

The organization administration destination uses organization.read independently of Billing management. `modules/organizations/src/application/organization.service.ts` explicitly requires organization.read for searchOrganizations before opening the tenant-scoped transaction and applying grants to search results. Administration's own organization link also uses this permission. Billing settings management alone neither supplies this grant nor authorizes access to all organization records.

The server page already imports hasPermission and retrieves the tenant's grants. Its existing note now uses those facilities for presentation only. No new fetch, client evaluation, permission mapping, hook, route or shared link framework is necessary. Destination APIs still enforce tenant membership, grants and resource scope. A visible link is not proof of access to every organization.

The Billing settings GET remains unconditional, and canManage continues controlling forms independently. Organization-read-only users retain their original link even when Billing management is absent. Save actions, FormData inputs, API payloads, validation, errors/successes, redirects and revalidation are untouched. This was verified by actual page comparisons plus an AST comparison that makes the entire page identical after removing only the note's children; even the paragraph's attributes remain identical.

## C. Verification

All commands exited 0 unless explicitly noted. Commands run at repository root unless another directory is stated. Production build completed before generation-dependent checks. Turbo reused unchanged tasks where applicable; integration tasks executed against isolated infrastructure.

| Exact command                                                                                                                   | Result                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `bun test apps/web/scripts/office-navigation.test.ts apps/web/src/lib/office-navigation.test.ts`                                | 19 tests / 1,012 assertions; pass                                                                                        |
| `bun run --filter @care/web typecheck`                                                                                          | Pass                                                                                                                     |
| `bun run build`                                                                                                                 | OpenAPI generation and 32 tasks; pass                                                                                    |
| `bun run architecture:check`                                                                                                    | 159 existing violations; zero new/resolved entries; baseline unchanged                                                   |
| `bun run architecture:test`                                                                                                     | 15 tests / 33 assertions; pass                                                                                           |
| `bun run lint`                                                                                                                  | 33 tasks; pass                                                                                                           |
| `bun run typecheck`                                                                                                             | 33 tasks; pass                                                                                                           |
| `bun run test`                                                                                                                  | 51 tasks; web 57 tests / 1,619 assertions; pass                                                                          |
| `bun run test:integration`                                                                                                      | 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80; pass                                       |
| `bun run i18n:check`                                                                                                            | 3,585 English/German messages; parity and static JSX scan pass                                                           |
| `bunx oxlint --fix`                                                                                                             | Pass                                                                                                                     |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                                                                     |
| `bun run format:check`                                                                                                          | Pass                                                                                                                     |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                                                                     |
| `graphify update .`                                                                                                             | AST-only refresh; 13,178 nodes / 39,732 edges / 705 communities; final refresh reported no topology changes; no API cost |

Exact outputs and local audit evidence are under ignored `artifacts/goal-13/`, including `logs/`, `file-sizes.json`, `render-comparison.json`, `debt-evidence.json`, `before/source.json` and `screenshot-comparison.json`. No required gate was skipped. There were no test failures. The OIDC availability probe exited 2, described below.

### Actual server pages, synthetic boundaries and compatibility

The tests use the existing process-isolated Bun fixture and execute the actual Office layout and BillingSettingsPage. Session, tenant and API responses are synthetic; page conditionals and JSX are real. Header, note, error/success notice, organization heading/no-data/permission text and BillingNavigation rendering use actual components and catalogs. Interactive forms are inspected as the real returned element trees rather than rendered or hydrated.

Both English and German cover management+organization read, management only, organization read only, neither, unrelated client.read, duplicated relevant grants and mixed grants; each case also runs with reversed ordering. Responses cover empty data, a populated synthetic organization/profile plus updated=saved, an API failure, and a query error with populated data. Tests assert the exact note HTML, including spacing and className, the unchanged GET and full options/tenant header, no employee lookup, data/section/form gates, correct save-action reference, organizationId/expectedVersion hidden inputs, representative tax-number values, status/error markup and independent management behavior. Nonreaders have no anchor/button/role/tabindex or link-specific classes in the note. Assertions are scoped to the note; unrelated page links remain legitimate.

An additional before/after audit runs the original and final BillingSettingsPage sources with the same seven grant sets, four response/query scenarios and two locales. All **56 report pairs** are identical outside noteHtml, including headers, alerts, success notices, organization output, complete requests, lookup calls, sections and full form trees with action identity and field props. The 32 reader note renders are byte-identical. Temporary original-page/fixture files were removed. `logs/scope-audit.log` confirms the Oxc AST is identical outside note children.

The save action is not invoked by this presentation fixture. Its source and all form props remain unchanged; this is compatibility evidence, not a new authenticated save-payload test. Existing form/integration suites remain passing. All 21 compared OpenAPI/generated-client/catalog files remain byte-identical to HEAD. No backend, schema/migration, dependency, permission or architecture-baseline changes exist in the worktree.

### Browser commands, screenshots and accessibility

From `apps/web`, the complete isolated suite was run with:

```bash
BILLING_NOTE_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-13/before BILLING_NOTE_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-13/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal13/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal13/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: **33 pass**: fourteen navigation, six presentation and thirteen form cases. After moving screenshots before keyboard interaction to stabilize unfocused captures, the two Billing cases were rerun from the repository root:

```bash
BILLING_NOTE_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-13/before BILLING_NOTE_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-13/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal13/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal13/cache bun run --filter @care/web test:navigation --grep 'Billing organization note'
```

Result: **2 pass**. The installed headless shell is supplied explicitly because Playwright's default revision is unavailable; writable XDG directories are used. No dependency was installed.

The screenshot folder contains **32 PNGs and 32 JSON reports**: four organization-read/Billing-management combinations × two locales × desktop 1440×900/mobile 390×900 × before/after. Original-page output was captured before the production edit, with provenance in `before/source.json`.

Quantitative comparison: all **eight reader pairs are pixel-identical**; all eight nonreader pairs differ only inside the note, where underline/medium-weight link text becomes ordinary text. Every note bounding box is identical before/after, and surrounding navigation/status/heading HTML is identical. There is no horizontal overflow. Initial captures after keyboard scans had a few stray mobile-topbar pixels; recapturing before keyboard interaction eliminated them. Final reports contain no unexplained differences. English desktop reader and German mobile nonreader images were also visually inspected.

All 32 focused renders have zero axe violations for WCAG 2 A/AA and WCAG 2.1 AA tags. Reader links retain the exact accessible name, href, class, Tab reachability and visible focus. Nonreader notes contain no focusable/fake-link element and remain outside keyboard order. The actual Billing secondary navigation, success notice and organization heading remain present and identical in the fixture; form-gate compatibility is verified separately through returned element trees. Existing drawer focus trapping/restoration, collapse shortcut/cookie, route precision and Goal 10–12 behavior remain covered.

### Authenticated verification gaps

A fresh isolated discovery probe using `.env.test` attempted `.well-known/openid-configuration` with a five-second timeout. It reported **Isolated OIDC discovery unavailable**, exit 2 (`logs/oidc.log`); no secret configuration was logged.

The browser uses the existing real OfficeShell with synthetic pathname/Link boundaries, production CSS and actual server-rendered Billing page subtrees. It does not fully hydrate the Next.js settings page, mount its interactive forms or ClearableSuccessNotice wrapper, perform OIDC login, exercise real organization navigation/API authorization, or submit a save. Full authenticated Office E2E, fully hydrated Next behavior and actual organization-destination authorization remain unverified. Backend integration passes do not substitute for these checks. No production authentication/authorization bypass was added.

## D. Remaining technical debt, reassessed

1. **Settings-only users still see Overview/Übersicht on settings routes.** Actual Office-layout props plus the real selector were evaluated for each settings management grant alone and with its normal read grant. `artifacts/goal-13/debt-evidence.json` records six cases: billing.settings.manage, claims.settings.manage and operations.reminder_settings.manage alone each expose Administration, but the selector returns undefined for their respective settings path; adding billing.read, claims.read or operations.read selects the existing Billing, Claims or Operations owner. `office-shell.tsx` uses activeItem?.label ?? labels.overview and derives sidebar/mobile selection from the same item. Goal 13 screenshots visibly retain this Overview context. The helper has no settings-to-Administration fallback. This is a confirmed presentation issue, not evidence of an authorization failure.
2. **Billing secondary navigation has no current-page marker.** `billing/billing-nav.tsx` filters links independently but adds no aria-current or selected styles. Actual rendered Billing nav HTML in the browser reports also has no marker. Its `/billing` and `/billing#worklist` entries share a pathname, so a future task must define hash/uniqueness behavior before changing it. Deferred.
3. **Administration secondary navigation has no current-page marker.** `administration/layout.tsx` NavLink renders href/class/label without aria-current or selected styles. The Overview/users/invitations hash distinction needs a scoped policy. Deferred independently of Billing navigation.
4. **Permission-dependent navigation inconsistencies:** the Billing note is now fixed; Goal 12 Claims/Reminder return controls remain unchanged and passing. No further permission-dependent dead end was established in these three inspected settings pages. Management grants still do not imply unrelated read grants, and data-dependent workflows can remain restricted by their owners. This is not an exhaustive application-wide navigation audit.

## E. Goal 14 preparation

**Select exactly one next improvement: a narrow Administration fallback for the three existing settings paths when the normal visible navigation has no owner.** This fixes the confirmed incorrect context using the existing shared selector, so topbar, desktop and mobile navigation remain consistent. Do not combine it with secondary-navigation work.

- **Reproduction / users:** select a tenant and grant only billing.settings.manage, claims.settings.manage or operations.reminder_settings.manage. Administration is visible from Goal 11. Open the corresponding `/billing/settings`, `/billing/claims/settings` or `/operations/reminder-settings` route. Current result: no primary item selected and Overview/Übersicht topbar context.
- **Intended result:** preserve the existing selector result first. Only when that result is undefined, return the already visible Administration item for exactly those three paths, also accepting one optional trailing slash. Strip query/fragment as the helper already does. Return the original visible item reference; do not fabricate an item, fetch permissions or change groups. If Administration is hidden, keep undefined and the existing Overview fallback.
- **Production file:** only `apps/web/src/lib/office-navigation.ts`, in the existing selector. Keep its generic signature and return shape, item identity and nonmutation contract. No OfficeShell/layout/mobile changes should be needed.
- **Matching / precedence:** every existing exact/nested/longest-href match wins, including Billing owning Claims settings when Billing is visible but Claims is hidden. Preserve Overview at `/operations`, broad Operations ownership under `/operations/`, the Goal 10 one-segment `/visits/[id]` Planning alias and record-scoped visit ownership. Do not match lookalikes, extra descendants, double trailing slashes, case variants, arbitrary Billing/Operations routes or arbitrary unmatched routes. No history/returnTo inference.
- **Permissions / tenant scope:** use only already server-filtered groups. Visibility of Administration does not imply authorization to the current settings page; this fallback is context only. Do not add grants, routes, items, APIs, tenant changes, new permission inputs or backend checks. Do not make Administration visible for new users.
- **Test files:** extend `apps/web/src/lib/office-navigation.test.ts`, `apps/web/scripts/office-navigation.test.ts` and `apps/web/e2e/office-navigation.spec.ts`; reuse the existing fixture/app/builder. The existing Goal 11 browser assertion after navigating to `/billing/settings` (currently around line 504) deliberately expects no selection/Overview; update only this intended expectation for the visible Administration fallback. Keep its other visibility/keyboard checks.
- **Pure/server regression cases:** all three exact paths and optional slash/query/fragment variants with visible Administration; no Administration; empty groups; normal read owners; Billing as Claims parent; unrelated/no grants; mixed/duplicate/reordered grants; item identity and unchanged input. Negative paths include settings-other, settings/child, double slashes, unrelated routes and existing precise visit negatives. Actual Office-layout props must prove no new item or permission visibility.
- **Browser/screenshots:** both locales, expanded/collapsed desktop and mobile; each management-only path now shows Administration context and exactly one active item on each visible nav surface. Read-capable controls retain their old owner; no-Administration and unmatched controls retain fallback. Compare before/after quantitatively, verify aria-current/data-active, collapsed accessible names/tooltips, mobile drawer selection, focus/keyboard/close/restore, shortcut/cookie, overflow and axe. Use existing synthetic boundaries and disclose authenticated gaps.
- **Localization/accessibility:** reuse the existing visible Administration label and current shell semantics. Add no keys/copy/design changes. Current markers must agree with the topbar and never expose a hidden item.
- **Risks:** giving the fallback higher precedence would steal normal Billing/Claims/Operations ownership; broad prefix matching would claim unrelated routes; creating an item would bypass server visibility. Define the exact path precision above and test these failure modes. Existing settings header and organization-note behavior must remain unchanged.
- **Exclusions:** no secondary-nav indicators, sidebar hierarchy, primary visibility rules, Administration page/layout, forms/actions, other aliases/contextual links, Goal 12/13 controls, caregiver navigation, catalogs, backend, permissions, API/client/schema/dependencies, or generic navigation registry/redesign.
- **Definition of done:** exactly the three unmatched settings paths select existing visible Administration; every prior owner/visibility/precision rule remains intact; tests and localized browser evidence pass; all required root gates pass with zero new architecture violations; Graphify refreshed; `docs/architecture/goal-14-to-goal-15.md` completed. No Goal 15 implementation.

## F. Copy-ready Goal 14 prompt

```text
Goal 14: Administration context fallback for settings-only routes

Repository: /home/woobb/Projects/care (woobble/care). Implement the change; no multi-agent mode.

Read AGENTS.md, applicable frontend/Next instructions, docs/architecture/overview.md, module-boundaries.md and docs/architecture/goal-13-to-goal-14.md. Inspect git status and preserve unrelated work. Query Graphify first. Reproduce the recorded actual-layout/selector cases against the current worktree.

Problem: each of billing.settings.manage, claims.settings.manage and operations.reminder_settings.manage makes Administration visible, but its settings route can have no visible normal owner. OfficeShell then shows Overview/Übersicht and no selected primary item.

Production scope: only apps/web/src/lib/office-navigation.ts. Keep the existing selector result and all matching precedence first. Only if no existing item matches, return the already visible Administration item for exactly /billing/settings, /billing/claims/settings or /operations/reminder-settings, allowing one optional trailing slash. Existing query/fragment stripping applies. Return the original item reference. If Administration is absent, retain undefined. Keep the generic signature and input nonmutation; do not add an item, permission fetch or client permission evaluation.

Preserve all existing exact/nested/longest-href rules: normal Billing/Claims/Operations ownership wins, including Billing as the visible parent of Claims settings; Overview stays at /operations; existing broad Operations ownership is unchanged; Goal 10's precise one-segment /visits/[id] Planning alias and record-scoped visit ownership remain unchanged. Reject lookalikes, settings descendants, double trailing slashes, case variants and unrelated/unmatched routes. Do not use history or returnTo.

Use only server-filtered navigation items. This is presentation context, not authorization. Do not alter visibility, grants, tenant scope, layouts, shell/mobile structure, sidebar hierarchy, secondary navigation, Administration, Goal 12/13 controls, forms/actions, other routes/aliases, translations, APIs, backend, generated clients, schema/migrations or dependencies. Add no generic registry or navigation redesign.

Extend the pure selector tests, actual Office-layout tests and existing isolated navigation browser suite. Cover the three paths and slash/query/fragment variants, hidden Administration, empty groups, normal read owners and parent precedence, unrelated/no/mixed/duplicate/reordered grants, item identity and input stability, and strict negative paths. Update the one existing Goal 11 billing/settings assertion that intentionally expects Overview when Administration is visible; preserve its other checks and all Goal 10–13 behavior.

Capture before/after in English/German across expanded/collapsed desktop and mobile. Check localized Administration context, exactly one visible current item, aria-current/data-active, accessible collapsed controls, mobile drawer selection and focus/close/restore, shortcut/cookie, overflow and axe. Read-capable and unmatched/hidden-item controls must retain their prior behavior. Use synthetic data and existing fixtures; disclose full Next hydration, OIDC/authenticated E2E and actual destination-authorization gaps separately. Probe isolated OIDC without logging secrets or changing authentication.

Run focused tests and relevant full isolated browser suites. Follow AGENTS.md formatting (oxlint --fix, then the configured oxfmt command). Build before generated-output-dependent checks; run bun run build, architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, format:check and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new architecture violations and unchanged baseline, backend/generated/catalog/dependency/permission files.

Create docs/architecture/goal-14-to-goal-15.md with status, exact implementation/precedence, changed files and before/after sizes, architectural/permission decisions, exact commands/counts, screenshot comparisons/accessibility and authenticated gaps. Reassess remaining debt from evidence, select exactly one small confirmed next improvement and provide a standalone Goal 15 prompt requiring docs/architecture/goal-15-to-goal-16.md. Do not implement Goal 15 or Goal 16.

Final response: status/duration, implementation, matching and permission matrix, changed files/sizes, exact test counts, screenshot/accessibility/localization evidence, authenticated gaps, handoff path and copy-ready next prompt.
```
