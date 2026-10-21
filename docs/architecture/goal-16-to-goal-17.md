# Goal 16 → Goal 17 handoff

## A. Implementation summary

**Goal 16: Complete.** Active duration: approximately 13 minutes, including verification and this handoff. Administration secondary navigation now marks one best matching visible nonfragment destination, or none, while retaining server translations/filtering and its existing grouped layout. All required gates and 45 isolated browser tests pass. Full Next hydration, authenticated Office E2E and actual destination authorization remain unverified because isolated OIDC discovery is unavailable. Goal 17 has not been implemented.

Production changes are limited to two colocated files:

- `administration/layout.tsx` remains async and server-owned. It retains getTranslations('Navigation'), getApiClient, getPermissionGrants, hasPermission and the original link/group definitions. It localizes and filters presentation groups, prepends Overview to Access, omits empty later groups, and passes only group key/label and permitted href/label pairs to the new client child. The nav, accessible name, grid/breakpoints, outer layout and child-page placement remain unchanged.
- New `administration/administration-nav-links.tsx` derives selection directly from usePathname without state/effects. Its local pure helper checks all groups, ignores fragment hrefs, uses exact root or slash-delimited descendant matches, and retains the first longest candidate. Group/link indices identify the one winner even when object references repeat. The renderer returns the original section/h2/link structure without an extra production wrapper.

The current link receives aria-current="page" and existing-token background/foreground plus underline. Font weight, padding, target sizes, hover classes and native focus are unchanged. No permission or business behavior changed. No production scope deviation or new abstraction/dependency.

| Path / visible data                                                  | Current secondary item                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/administration`, `/administration/`                                | Overview                                                                             |
| Users/list/detail, including Invitations fragment URL                | Visible Users; Invitations remains a jump                                            |
| Organization/facility/team detail, Qualifications, Audit, Templates  | Corresponding visible nonfragment owner                                              |
| Multiple matches across groups                                       | Longest visible href; first tie retained                                             |
| Hidden owner, empty groups, lookalike/case mismatch or unknown route | None, unless another visible nonfragment parent matches                              |
| Billing/Operations configuration links                               | Hrefs/filtering retained; Administration layout does not persist outside its segment |

Before/after sizes against starting commit `4a9c6c3696e027dff327f9ddf56538d950d3db87`, in newline-delimited lines / UTF-8 bytes:

| File                                                                    |         Before |          After |
| ----------------------------------------------------------------------- | -------------: | -------------: |
| `apps/web/src/app/(office)/administration/layout.tsx`                   |    114 / 3,744 |     92 / 2,888 |
| `apps/web/src/app/(office)/administration/administration-nav-links.tsx` |            New |     64 / 2,237 |
| `apps/web/scripts/administration-navigation.test.ts`                    |            New |    140 / 5,444 |
| `apps/web/scripts/office-navigation.test.ts`                            |   714 / 27,671 |   883 / 33,514 |
| `apps/web/scripts/office-navigation.fixture.ts`                         |   287 / 11,001 |   316 / 12,299 |
| `apps/web/e2e/support/office-navigation-app.tsx`                        |     74 / 2,521 |    117 / 4,109 |
| `apps/web/e2e/office-navigation.spec.ts`                                | 1,320 / 53,732 | 1,654 / 67,088 |
| `docs/architecture/goal-16-to-goal-17.md`                               |            New |   155 / 29,836 |

Tests exercise the real helper and actual AdministrationLayout under synthetic request boundaries. The fixture records groups, safe client props, HTML and child identity. The browser app mounts the actual new renderer and mirrors its Administration-segment lifetime; the existing native-fragment bridge from Goal 15 is reused unchanged. New browser cases cover live pathname/prop changes, section omission, keyboard/focus, original/final native Invitations jumps and unmounting after a cross-route settings link. All Goal 10–15 coverage remains passing. Billing navigation, primary selector/shell/mobile code, other pages/forms/actions, catalogs, API/backend and permission files are unchanged. Ignored review evidence and Graphify output were refreshed.

## B. Architecture and permissions

Translations, grant retrieval, independent gates and group omission stay on the authenticated server. Access always contains the existing Overview before Users/Invitations/Audit. Organization and Configuration are omitted when empty. Only `{ key, label, links: [{ href, label }] }` crosses the new client boundary; no permission names, grants, tenant IDs, sessions, clients, functions or actions are transmitted.

The helper performs a read-only scan across the server-provided groups. Overview owns only the Administration root plus one optional trailing slash. Other nonfragment links require exact or slash-delimited matches. Strictly longer hrefs replace the winner, so equal specificity retains the first eligible position. A single pair of indices guarantees zero or one marker across all groups; input arrays/items remain untouched.

Invitations remains `/administration/users#invitations-title`, targeting the existing Users-page h2. The fragment link never competes for page ownership. Users remains current on that URL; query/fragment suffixes do not change page ownership. No hash-aware section tracking, listeners, history patches or returnTo handling were added in production.

This is presentation state. Hidden links cannot be reconstructed by the client, and current state grants no page/API access. Tenant selection, resource scopes, destination guards and all existing capabilities—including Audit and settings-only cases—remain authoritative. Cross-route Configuration destinations are preserved without mounting Administration navigation on Billing/Operations pages. Primary Office context can independently have its own current marker.

## C. Verification

Final commands below exited 0. Commands run at repository root unless stated otherwise. Build completed before generated-output-dependent checks. Turbo reused unchanged tasks where applicable; integration tasks executed against isolated infrastructure.

| Exact command                                                                                                                                                                                   | Result                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun test apps/web/scripts/administration-navigation.test.ts`                                                                                                                                   | 3 tests / 61 assertions; pass                                                      |
| `bun test apps/web/scripts/office-navigation.test.ts`                                                                                                                                           | 20 tests / 2,046 assertions; pass                                                  |
| `bun test apps/web/scripts/administration-navigation.test.ts apps/web/scripts/office-navigation.test.ts apps/web/scripts/billing-navigation.test.ts apps/web/src/lib/office-navigation.test.ts` | 34 tests / 2,340 assertions; pass                                                  |
| `bun run --filter @care/web typecheck`                                                                                                                                                          | Pass                                                                               |
| `bun run build`                                                                                                                                                                                 | OpenAPI/client generation and 32 tasks; pass                                       |
| `bun run architecture:check`                                                                                                                                                                    | 159 existing violations; zero new/resolved entries; baseline unchanged             |
| `bun run architecture:test`                                                                                                                                                                     | 15 tests / 33 assertions; pass                                                     |
| `bun run lint`                                                                                                                                                                                  | 33 tasks; pass                                                                     |
| `bun run typecheck`                                                                                                                                                                             | 33 tasks; pass                                                                     |
| `bun run test`                                                                                                                                                                                  | 51 tasks; web 72 tests / 2,947 assertions; pass                                    |
| `bun run test:integration`                                                                                                                                                                      | 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80; pass |
| `bun run i18n:check`                                                                                                                                                                            | 3,585 English/German messages; parity/static scan pass                             |
| `bunx oxlint --fix`                                                                                                                                                                             | Pass                                                                               |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'`                                                                 | Pass                                                                               |
| `bun run format:check`                                                                                                                                                                          | Pass                                                                               |
| `bunx oxlint --deny-warnings --format=agent`                                                                                                                                                    | Pass                                                                               |
| `graphify update .`                                                                                                                                                                             | AST-only; 13,233 nodes / 39,809 edges / 695 communities; no API cost               |

Initial issues corrected: strict lint first exited 1 for a shadowed fixture variable and unused browser variable; both were fixed in test code. A one-off next-goal read-boundary probe could not resolve @care/permissions from root eval, then passed using the same package's source path. These are recorded in `initial-failures.json`. No test assertion failed. OIDC availability probe exit 2 is documented separately.

### Actual layout, safe props and matching

Server tests execute the real AdministrationLayout with real English/German catalogs and synthetic request/API boundaries. They cover no/unrelated grants, each of ten Administration-related capabilities alone, Audit-only, each settings-only case, Organization-only, Configuration-only, mixed, all, duplicate and reversed grants. Assertions verify exact group/headings/link data and order, persistent Access/Overview, omitted empty groups, safe props, unchanged root/nav classes, original child identity and no navigation API request.

Before production edits, 32 original layout renders were saved. The same cases after implementation have **32 identical group payloads, unselected nav HTML strings, full layout HTML strings and child placement results** (`server-comparison.json`). Original group definitions are AST-identical (`logs/scope-audit.log`). Provenance and original source are under `before/`. Client props contain only groups, with exact key/label/links and href/label fields.

Pure tests cover every Administration route family, root/slash/query/fragment precision, visible parent behavior, longest match across groups, deterministic ties including repeated references, hidden/empty data, lookalikes/case variants and frozen-input nonmutation. Browser cases exercise the real component's current markers and live updates. Existing Billing and primary matching tests remain intact.

The 21 OpenAPI/generated-client/catalog files and architecture baseline are byte-identical to HEAD. Billing secondary navigation, OfficeShell/mobile/primary selector, Goal 12 headers, Goal 13 note and all Administration business pages remain unchanged. No dependency, permission, backend, API, schema or migration change exists.

### Browser command and visual evidence

From `apps/web`:

```bash
ADMIN_NAV_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-16/before ADMIN_NAV_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-16/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal16/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal16/cache bunx playwright test --config=playwright.forms.config.ts
```

**45 tests pass:** twenty-six navigation, six presentation and thirteen form cases. The installed headless shell is supplied explicitly because Playwright's default browser revision is unavailable; writable XDG directories are used. No dependency was installed.

The focused matrix contains **104 PNGs and 104 JSON reports**: thirteen cases × desktop 1440×900/mobile 390×900 × English/German × before/after. Cases: Overview, Users, user detail, Invitations fragment, organization/facility/team detail, Qualifications, Audit, Templates, hidden Users, unmatched Administration route and Billing-settings-only configuration state. Before renders use actual original layout HTML; after renders mount the real client component with actual server-produced groups inside the same shell/container.

Quantitative results: **44 pairs show intended selection changes; all eight no-match controls are pixel-identical.** All section/heading/link bounding boxes, groups, hrefs, labels, order and primary-context text remain identical. There are zero changed pixels outside the strict secondary-nav bounds, including zero boundary/antialiasing differences to discount. `screenshot-comparison.json` and `screenshot-summary.json` preserve the raw comparison results. English desktop Users and German mobile settings-only images were visually inspected.

All 104 focused renders have zero axe violations for WCAG 2 A/AA and WCAG 2.1 AA tags. Tests verify marker uniqueness within the secondary nav, accessible names, background plus noncolor underline, target heights at least 40 px, preserved grouping/geometry and no horizontal overflow. Dedicated interactions prove native Tab order and visible focus independent of selection, pathname changes, removal of a selected link after server-prop changes, empty-group omission and no hidden-link reconstruction. Both original and final Invitations anchors perform the native URL/scroll jump to a synthetic target with the existing target ID; Users remains current only in the final renderer. The preview unmounts after a Billing settings transition, explicitly avoiding persistence outside the Administration segment.

Evidence/logs: ignored `artifacts/goal-16/logs/`, `screenshots/`, `screenshot-comparison.json`, `screenshot-summary.json`, `server-comparison.json`, `file-sizes.json`, `before/`, `initial-failures.json`, `debt-evidence.json` and `client-read-boundary.json`.

### Authenticated verification limits

A fresh `.env.test` discovery probe with a five-second timeout returned **Isolated OIDC discovery unavailable**, exit 2 (`logs/oidc.log`), without logging secrets. Actual server filtering/translations, pure client matching, isolated browser behavior, screenshots and axe are verified. API/session/permission transport is synthetic; pathname and nonfragment Link navigation use the existing test bridge. Native fragment scrolling uses browser defaults against a synthetic section target. Segment unmounting is modeled explicitly by the fixture; this does not prove full App Router behavior under authentication.

Full hydrated Next.js runtime, authenticated Office E2E, actual destination authorization and real save workflows remain unverified. Static legacy fixtures are not treated as proof of live client behavior; new cases mount the actual renderer. No production authentication bypass was added. Passing backend integration does not replace authenticated UI/API verification.

## D. Remaining technical debt

1. **The targeted Administration orientation gap is fixed.** Both locales now identify the visible nonfragment owner with preserved groups. Users remains current at Invitations, and cross-route settings links leave the segment. These fragment/layout boundaries are intentional, not unfinished selection work.
2. **Other bounded policies remain deliberate.** Goal 14 preserves Overview fallback on unrelated/unmatched primary routes. Goal 15 restricts Billing secondary ownership to its visible Billing links; client-scoped invoice paths remain unmatched there. No new aliases or shared routing framework are justified by this goal alone. Office brand falls back to `/`, the existing tenant-selection entry point, when no primary item exists; source inspection did not establish a defect in that behavior.
3. **Confirmed remaining return-link mismatch on New Client.** `clients/new/page.tsx` admits users with client.create, independent of client.read. Its PageHeader eyebrow and Cancel Link both unconditionally target `/clients`. Actual NewClientPage function renders in both locales with client.create alone passed the creation guard and retained both return destinations (`debt-evidence.json`: headerHtml plus returnHrefs). The list owner calls clientScopeFilter(principal, 'client.read'); the actual scope helper throws AuthorizationDeniedError for a synthetic create-only principal (`client-read-boundary.json`). This confirms an offered read-protected destination for a permitted creator; no authenticated HTTP reproduction is claimed.
4. **Scope of the finding:** New Client has two related return controls on one page. Its early no-create redirect, create action's post-save destination, unsaved-change behavior, other creation pages and data scopes are separate behavior and must not be swept into the next goal. Other pages may have analogous links, but no broader defect list is asserted without further proof.

## E. Goal 17 preparation

**Select exactly one improvement: permission-aware return controls on the New Client page.** This addresses the demonstrated create/read mismatch in two existing controls on one page, using its already fetched grants and an existing public entry route.

1. **Reproduction / issue:** select a tenant and provide client.create without client.read. Open `/clients/new`. The form is permitted, but the Clients eyebrow and Cancel both lead to `/clients`, whose owning list operation requires a client.read scope. Both actual page-function output and the real read-scope helper were checked.
2. **Current → intended:** for authorized creators with client.read, preserve the exact existing Clients eyebrow Link and Cancel Button/Link to `/clients`. For creators without client.read, render the same Clients label as ordinary eyebrow text, and keep the existing secondary Cancel Button/Link with its existing Cancel label but href `/`. This abandons creation through the already existing tenant-selection entry point, without guessing another granted domain route or using history. The `/` page reads session/memberships through `/api/v1/me/tenants` and has no client.read requirement or automatic selected-tenant redirect. It does not change the tenant cookie merely by being visited.
3. **Production scope:** only `apps/web/src/app/(office)/clients/new/page.tsx`, the existing PageHeader eyebrow and Cancel Link href. Reuse fetched permissions and imported hasPermission. Add no API request, new permission, translation, route, hook, framework or dependency. Keep Button asChild/secondary, order, styling and existing labels.
4. **Permission/tenant boundaries:** preserve the early client.create guard and its current redirect exactly. Do not broaden creation access or change list authorization, grants, tenant/resource scope, API calls or payloads. Presence of client.read only controls presentation, not access to all clients. Root navigation must not invoke selectTenantAction or alter the current tenant.
5. **Business compatibility:** preserve the entire form, createClientAction reference, input/hidden values, validation, server error text, warnOnUnsavedChanges and its leave-confirmation behavior. Do not change successful create redirects, revalidation, organization/facility lookup or other links/pages. The post-save path is outside this goal.
6. **Accessibility/localization:** reuse Clients.title and Common.actions.cancel in both locales. Reader controls retain exact markup/styles/names/focus behavior. Nonreader eyebrow has no href/role/tabindex/button or link affordance. Cancel remains one keyboard-reachable link styled by the existing secondary Button, now pointing to `/`; preserve target sizes, Tab order and no overflow. No new copy is needed for an action still named Cancel.
7. **Focused regressions:** execute actual NewClientPage with synthetic request/API boundaries; extract its actual PageHeader and Cancel subtree when full form rendering is impractical. Cover create+read, create-only, create+unrelated, duplicate/reordered grants in both locales. Without create (read-only/neither/unrelated), assert the unchanged redirect and absence of exposed form/header. Assert original API decisions, all returned form props/action/fields except intended return changes, notices and unsaved-change flag. Keep Goal 10–16 tests passing.
8. **Browser/screenshots:** extend existing fixture/app/spec minimally. Capture before/after desktop/mobile English/German for readable and create-only cases; reader visuals should remain equivalent. Verify exact destinations, plain eyebrow, Cancel semantics/name/secondary style, focus/keyboard/order, wrapping, axe and absence of unintended form/control changes. Preserve existing leave-confirmation handling; if tested through a focused real RHF harness rather than full page hydration, disclose that boundary. Do not claim real root/membership/API authorization from mocked clicks alone.
9. **Risks:** accidentally conditioning on create instead of read, changing the early guard, making Cancel noninteractive, adding a fabricated `/clients` link for a nonreader, altering unsaved-change interception, or changing tenant context while returning to `/`. Guard these with actual-page and browser evidence.
10. **Exclusions:** no primary/secondary navigation changes, OfficeShell, Goal 12–16 behavior, client list/detail or other creation pages, form fields/actions/save redirects/validation, auth/grants/tenant policies, backend/API/client/schema/catalog/dependency changes, history/returnTo inference, generic return-link abstraction or baseline expansion.
11. **Definition of done:** readers keep both original return links; authorized nonreaders have a plain eyebrow and Cancel to `/`; absent-create behavior is unchanged; form/API/tenant contracts remain compatible; both-locale tests and browser evidence pass; all root gates pass with zero new violations; Graphify refreshed; `docs/architecture/goal-17-to-goal-18.md` exists. No Goal 18 implementation.

## F. Copy-ready Goal 17 prompt

```text
Goal 17: Permission-aware return controls on New Client

Repository: /home/woobb/Projects/care (woobble/care). Implement one focused improvement; no multi-agent mode.

Read AGENTS.md, applicable frontend/Next guides, docs/architecture/overview.md, module-boundaries.md, relevant Clients documentation and docs/architecture/goal-16-to-goal-17.md. Check git status and preserve unrelated work. Query Graphify first. Reproduce the recorded actual NewClientPage create-only return links and inspect the existing client.read list scope guard and `/` tenant-selection page.

Production scope: only apps/web/src/app/(office)/clients/new/page.tsx, the existing PageHeader eyebrow and Cancel Link href. Reuse already fetched permissions and imported hasPermission. Preserve the early client.create guard and its redirect exactly.

For an authorized creator with client.read, retain the exact existing Clients eyebrow Link and secondary Cancel Button/Link to /clients. Without client.read, render the same Clients.title eyebrow label as ordinary text without href/role/tabindex/button or link affordances; retain the same Cancel Button asChild/variant secondary, Common.actions.cancel label and placement, but set its Link href to /. This is the existing tenant-selection entry point, not a new route. Do not invoke tenant selection or change tenant state merely to cancel.

Preserve the full form/action reference, inputs/hidden values, validation, notices, warnOnUnsavedChanges/leave confirmation, create request payloads, post-save redirects/revalidation and lookups. No new API calls, permissions, translations, dependencies, routing framework, history or returnTo inference. Do not alter client list/detail, other creation pages, primary/secondary navigation, Goal 12–16 behavior, authorization/tenant/resource scopes, backend/API/client/schema/catalog/dependency files or architecture baseline.

Extend existing actual-page fixture/tests using the real NewClientPage, PageHeader and Cancel subtree when full form rendering is impractical. Cover both locales: create+read, create-only, create+unrelated and duplicate/reordered grants. Read-only/no/unrelated grants without create must retain the original redirect without exposing the form/header. Verify exact destinations/labels/semantics and unchanged API/form/action/field/error/unsaved props outside the intended controls.

Use existing isolated browser infrastructure for desktop/mobile English/German before/after, readable and create-only controls. Reader visuals remain equivalent. Test plain eyebrow, one Cancel link with correct secondary styling/destination, accessible names, focus/Tab order, no overflow and axe. Preserve leave-confirmation behavior; disclose if its isolated RHF harness is used instead of full page hydration. Use synthetic data and distinguish fixture rendering/clicks from actual destination authorization. Probe isolated OIDC without exposing secrets or changing authentication.

Follow AGENTS.md formatting (oxlint --fix, then configured oxfmt). Build before generated-output-dependent checks. Run focused and relevant full isolated suites plus bun run build, architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, format:check and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new architecture violations and unchanged excluded baseline/backend/generated/catalog/dependency/permission files.

Create docs/architecture/goal-17-to-goal-18.md with status/duration, exact implementation and permission/tenant decisions, files and before/after sizes, commands/counts/failures, screenshots/accessibility/localization and authenticated gaps. Reassess debt from source/behavioral evidence, select exactly one small confirmed next improvement and provide a standalone Goal 18 prompt requiring docs/architecture/goal-18-to-goal-19.md. Do not implement Goal 18 or Goal 19.

Final response: status/duration, implementation, matching/permission behavior, file changes/sizes, focused/full tests, screenshots/accessibility/localization, authenticated gaps, handoff path and copy-ready next prompt.
```
