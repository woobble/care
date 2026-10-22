# Goal 17 → Goal 18 handoff

## A. Implementation summary

**Goal 17: Complete.** Active duration: approximately 20 minutes, excluding user pauses. Only the two existing New Client return controls changed. The client.create guard and exact redirect remain intact. Required gates, 74 web tests and 49 isolated browser tests pass. Full Next hydration, authenticated Office E2E and actual destination authorization remain unverified because isolated OIDC discovery is unavailable. Goal 18 is preparation only.

Production scope is `apps/web/src/app/(office)/clients/new/page.tsx`:

- PageHeader eyebrow reuses fetched permissions and hasPermission('client.read'). Readers retain the exact Clients Link to `/clients`; authorized nonreaders receive the same Clients.title as ordinary text.
- The existing secondary Cancel Button/Link retains its label, markup, styling and placement. Its href is `/clients` with client.read and `/` otherwise.

No variable, API request, permission, client-side permission evaluation, route, copy, style or abstraction was added. Only two JSX expressions changed. The guard still checks client.create before rendering and redirects to `/clients?error=INSUFFICIENT_PERMISSION` exactly. No production scope deviation.

| Grants                                                | Eyebrow                           | Cancel / access             |
| ----------------------------------------------------- | --------------------------------- | --------------------------- |
| client.create + client.read                           | Existing Clients link             | Existing `/clients`         |
| client.create without client.read                     | Same Clients text, noninteractive | Existing Cancel link to `/` |
| client.create + unrelated grants                      | Determined only by client.read    | Same rule                   |
| client.read only, neither or unrelated without create | No creation render                | Exact existing redirect     |
| Duplicate/reordered grants                            | Same result                       | Same result                 |

Before/after sizes against starting commit `9588d92d20f2169044fda240b3533f13a8acff77`, in newline-delimited lines / UTF-8 bytes:

| File                                             |         Before |          After |
| ------------------------------------------------ | -------------: | -------------: |
| `apps/web/src/app/(office)/clients/new/page.tsx` |    202 / 7,392 |    210 / 7,609 |
| `apps/web/scripts/office-navigation.fixture.ts`  |   316 / 12,299 |   395 / 15,700 |
| `apps/web/scripts/office-navigation.test.ts`     |   883 / 33,514 | 1,017 / 38,726 |
| `apps/web/scripts/build-navigation-test.ts`      |     43 / 2,402 |     43 / 2,499 |
| `apps/web/e2e/support/office-navigation-app.tsx` |    117 / 4,109 |    187 / 6,533 |
| `apps/web/e2e/office-navigation.spec.ts`         | 1,654 / 67,088 | 1,881 / 77,043 |
| `docs/architecture/goal-17-to-goal-18.md`        |            New |   171 / 29,629 |

The process-isolated fixture now executes the real NewClientPage, records its redirect or actual header/action controls and full returned form tree, and checks action identity. Server tests add both-locale permission/error/form compatibility cases. The browser app mounts the actual server-produced header/actions and first-name field in the real RHFActionForm; the existing pathname bridge models Next routing after RHF capture. Its router mock supplies the refresh boundary. No permission condition is duplicated in a client fixture.

All form fields, actions, validation, errors, warnOnUnsavedChanges, submit order, payloads, lookups, post-save redirects and revalidation remain unchanged. No primary/secondary navigation, Goal 12–16 behavior, tenant selection, auth, API/backend, catalog, dependency or architecture-baseline change occurred. Review artifacts and Graphify were refreshed.

## B. Architecture and permission decisions

client.create remains the creation-page capability. client.read independently determines whether offering the list as a return destination is appropriate. Both checks use the existing server-fetched grants; no additional request or grant inference is needed. Permission presence controls presentation, while the owning APIs continue enforcing resource/tenant scopes.

The `/` fallback is the existing tenant-selection entry point. Its authenticated render reads the session and `/api/v1/me/tenants`; it has no client.read requirement or automatic selected-tenant redirect. Merely visiting it does not invoke selectTenantAction or change the tenant cookie. Cancel still means leaving creation, using existing labels and one existing navigation control. No history, router.back, returnTo or fabricated domain destination is used.

The original create guard's order, error code and destination are unchanged, including cases without client.read. Those denied callers still return no form/header from the page. For allowed readers, the existing Link markup is retained. For allowed nonreaders, plain eyebrow text has no anchor/role/tabindex/button behavior; Cancel remains a native link styled through the existing Button asChild/secondary wrapper.

RHFActionForm, createClientAction and the full form tree are untouched except the Cancel href. Its document-capture dirty-form guard continues running before routing. The browser fixture supplies a synthetic create action and routing boundary so testing Cancel never creates real data. This tests the actual RHF guard with actual returned controls, not the full authenticated creation workflow.

## C. Verification

All final commands below passed (exit 0). Commands run at repository root unless another directory is stated. Build completed before generated-output-dependent checks. Turbo reused unchanged tasks where applicable; integration tasks executed against isolated infrastructure.

| Exact command                                                                                                                                                                                   | Final result                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `bun test apps/web/scripts/office-navigation.test.ts`                                                                                                                                           | 22 tests / 2,398 assertions; pass                                                                            |
| `bun test apps/web/scripts/office-navigation.test.ts apps/web/scripts/administration-navigation.test.ts apps/web/scripts/billing-navigation.test.ts apps/web/src/lib/office-navigation.test.ts` | 36 tests / 2,692 assertions; pass                                                                            |
| `bun run --filter @care/web typecheck`                                                                                                                                                          | Pass                                                                                                         |
| `bun run build`                                                                                                                                                                                 | OpenAPI/client generation and 32 tasks; pass                                                                 |
| `bun run architecture:check`                                                                                                                                                                    | 159 existing violations; zero new/resolved baseline entries                                                  |
| `bun run architecture:test`                                                                                                                                                                     | 15 tests / 33 assertions; pass                                                                               |
| `bun run lint`                                                                                                                                                                                  | 33 tasks; pass                                                                                               |
| `bun run typecheck`                                                                                                                                                                             | 33 tasks; pass                                                                                               |
| `bun run test`                                                                                                                                                                                  | 51 tasks; web 74 tests / 3,299 assertions; pass                                                              |
| `bun run test:integration`                                                                                                                                                                      | 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80; pass                           |
| `bun run i18n:check`                                                                                                                                                                            | 3,585 English/German messages; parity/static scan pass                                                       |
| `bunx oxlint --fix`                                                                                                                                                                             | Pass                                                                                                         |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'`                                                                 | Pass                                                                                                         |
| `bun run format:check`                                                                                                                                                                          | Pass                                                                                                         |
| `bunx oxlint --deny-warnings --format=agent`                                                                                                                                                    | Pass                                                                                                         |
| `graphify update .`                                                                                                                                                                             | AST-only; 13,251 nodes / 39,837 edges / 710 communities; final refresh found no topology change; no API cost |

Initial typecheck/build exited 1 for test-only issues: a wrong translation namespace in the dialog assertion and forwarding optional undefined RHF props under exactOptionalPropertyTypes. The namespace and fixture props were corrected; final checks pass. Recorded in `initial-failures.json`. No test assertion failed. OIDC probe exit 2 is described below. Process handles from before an interruption were no longer available; persistent logs show completed successful full browser/integration runs, so they were not restarted solely because observation handles expired.

### Actual page, guard and full form compatibility

Tests execute the actual NewClientPage with synthetic API/grant/session boundaries and real catalogs. Both locales cover create+read, create-only, read-only, no grants, unrelated grants, mixed grants with/without read, duplicates and reverse ordering. Denied cases assert exactly the old redirect report with zero returned forms and no header. They cannot bypass create access through client.read.

Allowed cases assert exact eyebrow text/semantics, Cancel href/name and original Button props, header title/description, one form/submit/Cancel control, original createClientAction identity, warnOnUnsavedChanges, form/root classes, required first-name props, field names, provider selectors, DE default, error state and zero page GET requests. Error query cases preserve the form tree and notices. The fake API/request boundary does not establish real destination access.

Original source and 18 baseline render/redirect reports were captured before production edits. An additional actual original/final page audit covers nine grant sets × two locales × normal/error query = **36 pairs**, identical outside the two allowed return changes (`page-comparison.json`). All full form props/action/fields, errors, guard reports, API decisions and header/Cancel markup outside the intended values remain equal. The 20 comparisons carrying client.read—including its unchanged denied-create cases—are fully identical. The Oxc audit makes the entire page AST identical after removing only the existing eyebrow value and Cancel href (`logs/scope-audit.log`), proving the guard, form and action configuration remain unchanged. Temporary audit sources were removed.

OpenAPI, all 18 generated client files, both catalogs and the architecture baseline remain byte-identical to HEAD. RHFActionForm, createClientAction, tenant-selection implementation, all primary/secondary navigation and other pages are unchanged. No permission, tenant, API contract, backend, dependency or excluded production changes exist.

### Browser commands and screenshots

Focused command, from repository root:

```bash
NEW_CLIENT_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-17/before NEW_CLIENT_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-17/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal17/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal17/cache bun run --filter @care/web test:navigation --grep 'New Client'
```

Result: **4 pass**. Complete existing isolated configuration, from `apps/web`:

```bash
NEW_CLIENT_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-17/before NEW_CLIENT_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-17/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal17/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal17/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: **49 pass**: thirty navigation, six presentation and thirteen form cases. The installed Chromium headless shell is supplied explicitly because Playwright's default browser revision is unavailable; writable XDG directories are used. No dependency was installed.

Focused evidence contains **32 PNGs and 32 JSON reports**: read, create-only, duplicate create-only and reordered read cases × desktop 1440×900/mobile 390×900 × English/German × before/after. All **16 screenshot pairs are pixel-identical**, including all header/form/Cancel bounding boxes. Readers retain their original controls; nonreader differences are href, interactivity and focusability, with identical existing text/styles. There are no unexplained pixel or layout changes. English desktop create-only and German mobile reader screenshots were visually inspected.

All 32 focused renders have zero axe violations for WCAG 2 A/AA and WCAG 2.1 AA tags. Tests assert accessible names, plain eyebrow without fake focusable semantics, secondary Cancel link, one actual submit button, unchanged Tab order, visible focus and no horizontal overflow. Denied-create cases are verified through the real server fixture without claiming an authenticated browser redirect.

### Form and unsaved-change runtime verification

The new preview uses actual server-produced PageHeader and submit/Cancel HTML, the actual first-name TextField props, and the real RHFActionForm with the production unsaved flag, classes and error message. Other New Client fields/selectors are inspected in the full returned tree but are not mounted. A synthetic action counts calls; it never invokes createClientAction or sends data.

For both `/clients` and `/` Cancel destinations in both locales, browser tests establish:

- Clean Cancel navigates without a confirmation dialog.
- After editing the field, clicking Cancel opens the real browser confirm dialog with the exact localized RHF message.
- Rejecting keeps `/clients/new` and the draft value.
- Accepting via keyboard Enter navigates to the exact href and unmounts the fixture form.
- Submission and refresh counters stay zero, and the synthetic tenant cookie remains unchanged.

The document-capture confirmation is the real production RHF logic. After it permits navigation, a test-only bubble handler models Next link routing; it does not duplicate permission logic or confirmation. Thus dirty-form interception is runtime-verified in this focused harness. Full New Client hydration, all field/lookup interactions and production Next routing are not implied by that result.

Evidence/logs are under ignored `artifacts/goal-17/`: `logs/`, `screenshots/`, `screenshot-comparison.json`, `page-comparison.json`, `file-sizes.json`, `before/`, `initial-failures.json` and `debt-evidence.json`.

### Authenticated limitations

Isolated discovery was probed again after resume with `.env.test` and a five-second timeout. It reported **Isolated OIDC discovery unavailable**, exit 2, without exposing secrets (`logs/oidc.log`). Actual server-page rendering, synthetic permission/API tests, isolated browser interactions, focused real-RHF confirmation, screenshots and axe are verified.

Fully hydrated Next.js application behavior, authenticated Office E2E, actual root/list destination authorization and complete creation/save workflows remain unverified. The destination fixture is a placeholder rather than the real tenant-selection/list page. Its cookie/counter assertions are scoped to the test bridge. Source/AST checks prove no tenant-selection/action code changed; backend integration does not substitute for authenticated end-to-end behavior. No production auth bypass was added.

## D. Remaining technical debt

1. **New Client return controls are fixed within scope.** No-create redirect and post-save behavior remain intentionally unchanged. The primary Overview fallback for create-only users without any visible section is the existing bounded shell policy, not a newly introduced navigation owner. No primary-visibility or route-alias change is proposed.
2. **Confirmed analogous issue on New Admission.** `admissions/new/page.tsx` permits onboarding.create + organization.read without requiring onboarding.read, yet its eyebrow and Cancel both target `/admissions`. The list page explicitly returns noAccess without onboarding.read. Actual new/list page functions in both locales verify that the create+organization-read combination renders both restricted return controls while the list returns the original no-access paragraph (`debt-evidence.json`). Adding onboarding.read preserves creation; removing either existing prerequisite denies it. Source search also confirms the owning application's visibleCases filter requires onboarding.read scopes. This is a separate page's demonstrated return-navigation mismatch, not an assumption about another Client workflow.
3. **Other observations are not broadened into defects.** New Employee has different permission-fetch/guard structure; Services performs a category query; Communications uses another prerequisite set. They were inspected briefly but no implementation or comprehensive behavior claim is made. The selected next goal is only Admissions. Existing Billing/Administration fragment policies and cross-route segment lifetimes remain deliberate and unchanged.
4. **Post-save destinations remain separate.** This goal did not change createClientAction redirects or admission actions. No claim is made that a successful save with restricted reads has been exercised under real authentication, and that unverified workflow must not be silently folded into the next return-control change.

## E. Goal 18 preparation

**Select exactly one improvement: permission-aware return controls on New Admission.** It repeats a proven mismatch on one page with already-fetched grants and a different two-capability admission guard that must remain exact.

1. **Problem / reproduction:** select a tenant with onboarding.create and organization.read but no onboarding.read. Open `/admissions/new`; the real page renders the form, eyebrow and Cancel to `/admissions`. The real list page returns noAccess under that same grant set. This has both-locale actual-page evidence.
2. **Intended behavior:** after the existing guard permits rendering, users with onboarding.read keep the exact existing Onboarding.title eyebrow Link and secondary Cancel Link to `/admissions`. Without onboarding.read, render the same title as ordinary eyebrow text; retain the same secondary Cancel Button/Link, Common.actions.cancel label and placement, with href `/`. Keep the existing tenant-selection entry route and no automatic navigation.
3. **Production file:** only `apps/web/src/app/(office)/admissions/new/page.tsx`, its existing PageHeader eyebrow and Cancel href. Reuse fetched permissions and imported hasPermission. No extra API call, new permission/key/route/dependency, generic return framework or history inference.
4. **Authorization / tenant:** preserve the exact existing combined guard requiring both onboarding.create and organization.read, including its early noAccess paragraph, translation, role, class and ordering. onboarding.read must not bypass either prerequisite. Do not replace denial with a redirect. Do not change admission/list/API/resource authorization, tenant cookies or tenant-selection implementation. Root visits do not invoke tenant selection.
5. **Business compatibility:** preserve createAdmissionCaseAction, all form fields/options/defaults, conditional facility/employee/client selectors, required organization selection, validation, errors, warnOnUnsavedChanges, submit behavior, payloads, save redirects and revalidation. Scope is two return controls only.
6. **Localization / accessibility:** reuse Onboarding.title via the existing t and Common.actions.cancel via translate. Preserve reader markup/style and all PageHeader/title layout. Nonreader eyebrow has no link/role/tabindex/button affordance. Cancel remains an accessible native link inside the existing secondary Button; preserve keyboard/focus/order/targets/wrapping. No new copy or icons.
7. **Focused tests:** extend existing process-isolated actual-page fixture/tests. Both locales: create+organization-read+onboarding-read; create+organization-read only; missing-create; missing-organization-read even with other grants; neither/unrelated; mixed/duplicate/reordered grants. Verify the exact early denial and no form/control exposure. Compare full returned form/action/field trees and API decisions outside the two controls, including permission-dependent selectors, errors and unsaved flag. Keep Goal 10–17 cases.
8. **Browser / screenshots:** minimally extend the existing navigation fixture/app/spec using real server-produced header/Cancel controls and the real RHF guard. Capture readable/nonreader desktop/mobile in both locales and representative duplicate/reordered inputs; reader visuals remain equivalent. Verify exact destinations, plain eyebrow, Button semantics/name, Tab/focus, no submit on Cancel, overflow and axe. Test clean/dirty rejected/accepted Cancel for both destinations with localized confirmation and unchanged cookie/counters. Use actual-page form configuration; disclose partial-field/RHF fixture versus full admission-page hydration.
9. **Risks / exclusions:** do not accidentally weaken the combined guard, infer read from create/organization access, redirect denied callers, change selector visibility, modify form/action/save behavior or mutate tenant state. Exclude other Admissions pages, all Client pages, primary/secondary navigation, Goal 12–17 behavior, auth/permissions/backend/API/client/schema/catalog/dependency files, history/returnTo and baseline expansion.
10. **Definition of done:** exact existing links for readers; plain eyebrow plus Cancel `/` for permitted nonreaders; combined guard and form/API/tenant contracts unchanged; both-locale server/browser/confirmation evidence and all required gates pass; zero new violations; Graphify refreshed; `docs/architecture/goal-18-to-goal-19.md` exists. Do not implement Goal 19.

## F. Copy-ready Goal 18 prompt

```text
Goal 18: Permission-aware return controls on New Admission

Repository: /home/woobb/Projects/care (woobble/care). Implement one focused improvement; no multi-agent mode.

Read AGENTS.md, applicable frontend/Next instructions, docs/architecture/overview.md, module-boundaries.md, relevant Onboarding docs and docs/architecture/goal-17-to-goal-18.md. Check git status and preserve unrelated work. Query Graphify first. Reproduce the recorded actual new/list page mismatch under onboarding.create + organization.read without onboarding.read.

Production scope: only apps/web/src/app/(office)/admissions/new/page.tsx, the existing PageHeader eyebrow and Cancel Link href. Reuse fetched permissions and hasPermission. Preserve exactly the guard requiring onboarding.create AND organization.read and its early noAccess paragraph, role/class/translation/order. Read alone must not bypass either prerequisite; do not introduce a redirect or new fallback rendering for denied users.

For permitted users with onboarding.read, preserve the exact Onboarding.title eyebrow Link and secondary Cancel Link to /admissions. Without onboarding.read, render the same title as ordinary text without href/role/tabindex/button behavior; retain the existing Button asChild/variant secondary, Common.actions.cancel label/style/placement, but point its Link to /. This is the existing tenant-selection entry point; do not invoke tenant selection or change tenant state. Add no controls, copy, permissions, API requests, routes, dependencies, generic return abstraction, history or returnTo logic.

Keep the entire form/action, conditional selectors, required organization field, defaults/options, validation/errors, warnOnUnsavedChanges/confirmation, submit payloads, post-save redirects and revalidation unchanged. Do not alter other Admissions/Client pages, primary or secondary navigation, Goal 12–17 behavior, authorization/tenant/resource scopes, backend/API/generated/schema/catalog/dependency files or baseline.

Extend the existing actual-page fixture/tests with real NewAdmissionPage, PageHeader and Cancel subtree. Cover both locales with all three relevant grants, create+organization-read without read, missing either prerequisite, neither/unrelated, mixed and duplicate/reordered grants. Assert the exact denied response, no exposed form/controls on denial, exact link/plain-text semantics and unchanged full form/action/field/API/error/unsaved configuration outside the intended values.

Use the existing isolated browser fixture and real RHF guard. Capture before/after English/German desktop/mobile readable and nonreader scenarios; compare quantitatively and report unexpected/boundary pixels. Verify names, destinations, Button semantics, focus/Tab order, no extra controls, no overflow and axe. Exercise clean Cancel and dirty rejected/accepted confirmation for /admissions and /, with localized messages, no submission/refresh and unchanged tenant cookie. Disclose partial-form fixture and routing boundaries rather than claiming full Next hydration or actual destination authorization. Probe OIDC without logging secrets or changing authentication.

Follow AGENTS.md formatting (oxlint --fix, then configured oxfmt). Build before generated-output-dependent checks. Run focused and relevant full isolated suites plus bun run build, architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, format:check and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new violations and unchanged excluded files.

Create docs/architecture/goal-18-to-goal-19.md with status/duration, exact implementation/permission decisions, files and before/after sizes, commands/counts/failures, screenshots/accessibility/localization and authenticated gaps. Reassess debt from evidence, select exactly one small confirmed next improvement and provide a standalone Goal 19 prompt requiring docs/architecture/goal-19-to-goal-20.md. Do not implement Goal 19 or Goal 20.

Final response: status/duration, exact implementation, permission matrix, files/sizes, focused/full results, screenshots/accessibility, form/unsaved compatibility, authenticated gaps, handoff path and copy-ready next prompt.
```
