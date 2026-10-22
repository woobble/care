# Goal 18 → Goal 19 handoff

## A. Implementation summary

**Goal 18: Complete.** Active duration: approximately 11 minutes. Starting worktree was clean at `d06dfce98898d44785310bd309229e3e429972c6`. Goal 17 was already committed. No commits or staging were requested. Goal 19 is preparation only.

Production changes are confined to two existing expressions in `apps/web/src/app/(office)/admissions/new/page.tsx`:

- PageHeader eyebrow checks the already-fetched permissions with the existing hasPermission helper. With onboarding.read, it retains the exact Link to `/admissions` and t('title'). Without read, it renders that same localized title as ordinary text.
- The existing Button asChild / variant secondary / Link Cancel control retains Common.actions.cancel, placement and styling. Only its href changes: `/admissions` with onboarding.read, `/` otherwise.

The original combined missing-permission guard, its position, inline noAccess paragraph, role="alert", CSS classes and early return remain byte-for-byte unchanged. No redirect was introduced. No form, action, field, conditional selector, error, API decision, permission, tenant, post-save, navigation, catalog, dependency or backend behavior changed. No production scope deviation.

| Grants                                                            | Creation response                 | Eyebrow / Cancel                                                                 |
| ----------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| onboarding.create + organization.read + onboarding.read           | Existing form                     | Original `/admissions` links                                                     |
| onboarding.create + organization.read, no onboarding.read         | Existing form                     | Same title as plain text; Cancel `/`                                             |
| Missing onboarding.create, including read + organization.read     | Exact original noAccess paragraph | No form or return controls                                                       |
| Missing organization.read, including create + read                | Exact original noAccess paragraph | No form or return controls                                                       |
| Create only, organization-read only, read only, none or unrelated | Exact original noAccess paragraph | No form or return controls                                                       |
| Mixed, duplicate or reordered grants                              | Same independent capability rules | Selector visibility still depends on facility.read / employee.read / client.read |

Files changed, measured as newline-delimited lines / UTF-8 bytes against the starting commit:

| File                                                |         Before |          After |
| --------------------------------------------------- | -------------: | -------------: |
| `apps/web/src/app/(office)/admissions/new/page.tsx` |    216 / 8,131 |    227 / 8,370 |
| `apps/web/scripts/office-navigation.fixture.ts`     |   395 / 15,700 |   492 / 19,974 |
| `apps/web/scripts/office-navigation.test.ts`        | 1,017 / 38,726 | 1,196 / 46,354 |
| `apps/web/e2e/support/office-navigation-app.tsx`    |    187 / 6,533 |    274 / 9,316 |
| `apps/web/e2e/office-navigation.spec.ts`            | 1,881 / 77,043 | 2,160 / 88,485 |
| `docs/architecture/goal-18-to-goal-19.md`           |            New |   170 / 32,994 |

The existing process-isolated fixture adds actual NewAdmissionPage extraction and an actual AdmissionsPage denial report. It records the real header, action row, original secondary Button, action identity, full returned form tree, field configuration, requests and denials. Tests retain Goal 10–17 cases. Browser fixtures add a partial admission form using the real RHFActionForm, actual server-produced header/actions and the actual local Field helper's native first-name tree. There is no duplicated navigation permission condition in the client fixture. The existing shared submission/refresh counters retain their historical newClient names and also observe the admission preview.

## B. Architecture and permission decisions

Both onboarding.create and organization.read remain mandatory because the page's existing admission workflow requires both. onboarding.read is independently checked only for offering the Admissions list as return navigation. It cannot bypass either prerequisite, imply creation authority or expand API/resource scope. The existing fetched grants and hasPermission import suffice; no request or client-side permission evaluation was added.

The `/` destination is the existing authenticated tenant-selection entry route. Its source reads the session and `/api/v1/me/tenants`, with no admission/client read requirement or automatic selected-tenant redirect. Merely visiting it does not invoke selectTenantAction or mutate a cookie. The existing Cancel label and secondary native link remain appropriate; no history inference, router.back, returnTo, fallback framework or extra control was introduced.

The combined guard and all helper functions match the original source exactly. Readers retain the original Link semantics. Permitted nonreaders receive ordinary eyebrow text without anchor, href, role, tabindex, fake disabling or alternative breadcrumb destination. PageHeader title and layout are unchanged.

The entire RHFActionForm configuration and createAdmissionCaseAction reference remain unchanged. Required names, organization selection, conditional facility/owner/client selectors, service/contact/follow-up/funding fields, timezone Europe/Berlin, errors, payloads and post-save redirects/revalidation stay with their existing owners. Backend authorization remains authoritative. Cancel still navigates rather than submits.

## C. Verification

Final results below refer to the final source. Build preceded generated-output-dependent checks. Turbo may reuse unchanged tasks, and the logs identify cache hits. Final command status is exit 0 unless explicitly described as an initial failure or unavailable discovery probe.

| Exact root command                                                                                                                                                                              | Result                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `bun test apps/web/scripts/office-navigation.test.ts`                                                                                                                                           | 24 tests / 5,354 assertions; pass                                                                                          |
| `bun test apps/web/scripts/office-navigation.test.ts apps/web/scripts/administration-navigation.test.ts apps/web/scripts/billing-navigation.test.ts apps/web/src/lib/office-navigation.test.ts` | 38 tests / 5,648 assertions; pass                                                                                          |
| `bun run --filter @care/web typecheck`                                                                                                                                                          | Pass                                                                                                                       |
| `bun run build`                                                                                                                                                                                 | OpenAPI/client generation and 32 successful tasks                                                                          |
| `bun run architecture:check`                                                                                                                                                                    | 159 existing violations; zero new; zero resolved baseline entries                                                          |
| `bun run architecture:test`                                                                                                                                                                     | 15 tests / 33 assertions; pass                                                                                             |
| `bun run lint`                                                                                                                                                                                  | 33 successful tasks                                                                                                        |
| `bun run typecheck`                                                                                                                                                                             | 33 successful tasks                                                                                                        |
| `bun run test`                                                                                                                                                                                  | 51 successful tasks; web 76 tests / 6,255 assertions                                                                       |
| `bun run test:integration`                                                                                                                                                                      | 32 successful tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80; 15 tests / 1,658 assertions total |
| `bun run i18n:check`                                                                                                                                                                            | 3,585 messages; English/German parity and static JSX scan pass                                                             |
| `bunx oxlint --fix`                                                                                                                                                                             | Pass                                                                                                                       |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'`                                                                 | Pass                                                                                                                       |
| `bun run format:check`                                                                                                                                                                          | Pass                                                                                                                       |
| `bunx oxlint --deny-warnings --format=agent`                                                                                                                                                    | Pass                                                                                                                       |
| `graphify update .`                                                                                                                                                                             | AST-only; 13,271 nodes / 39,865 edges / 719 communities; no API cost                                                       |

### Actual-page evidence and compatibility

The fixture executes the real page functions with synthetic request/API/grant boundaries and real English/German catalogs. The before source was captured before production edits. Current New Admission rendering and the actual list denial reproduced the original mismatch in both locales: onboarding.create + organization.read renders both restricted return links while `/admissions` returns noAccess without onboarding.read.

The before/after audit covers **31 grant sets × two locales × normal/error query = 124 actual-page pairs**. Fifteen named sets cover every requested permission combination, mixed grants, duplicates and reordered prerequisites. Sixteen additional sets enumerate every combination of facility.read, employee.read and client.read both with and without onboarding.read. All 124 reports are identical outside the intended eyebrow/href changes. All 28 denied reports remain fully identical. Overall 76 pairs are fully identical, including all read-capable allowed renders and unchanged denials.

Permanent server tests assert exact denial HTML, role/class, no form/header/Cancel/action, no redirect, exact permitted titles/labels/destinations, one secondary Cancel, one submit button, action identity, warning flag, field names/required values, organization requirement, all three selector permissions, five fieldsets, optional funding details and timezone. Error and reversed-grant rerenders preserve full form trees and request decisions. Normalized form trees are identical between reader/nonreader cases for each of the eight selector combinations. There are no admission-page GET requests in these render cases; lookup interactions are not invoked.

A strict source audit replaces only the two changed JSX expressions and obtains the exact original source, including the guard, helper functions, field tree, errors and unsaved configuration (`logs/scope-audit.log`). The full returned tree comparison is in `page-comparison.json`. Temporary baseline and debt drivers were removed.

OpenAPI, all 18 generated API-client files, both catalogs and the architecture baseline are byte-identical to HEAD. Other Admission/Client pages, actions, RHFActionForm, tenant selection, OfficeShell and primary/secondary navigation are unchanged. No backend, API contract, schema/migration, dependency, permission or baseline expansion occurred.

### Browser commands, screenshots and accessibility

Focused command from repository root:

```bash
NEW_ADMISSION_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-18/before NEW_ADMISSION_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-18/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal18/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal18/cache bun run --filter @care/web test:navigation --grep 'New Admission'
```

Result: **4 passed**. Full isolated configuration from `apps/web`:

```bash
NEW_ADMISSION_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-18/before NEW_ADMISSION_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-18/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal18/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal18/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: **53 passed**: 34 navigation, six presentation and thirteen form tests. The existing installed Chromium headless shell is supplied explicitly; writable XDG paths avoid configuration writes outside permitted roots. No browser or dependency was installed.

Focused captures contain **40 PNGs and 40 JSON reports**: readers, restricted readers, mixed selector grants, duplicate prerequisites and reordered grants × English/German × 1440×900 desktop / 390×900 mobile × before/after. All **20 pairs are pixel-identical**, with identical PageHeader/form/Cancel bounding boxes and overflow measurements. No unexpected pixel or geometry differences exist. English desktop reader and German mobile nonreader screenshots were visually inspected.

All **40 scoped axe scans** have zero WCAG 2 A/AA and WCAG 2.1 AA violations. Tests verify exact accessible names/destinations, plain eyebrow semantics, secondary native Cancel link and original submit type, no extra controls, Tab order and visible focus. Header link → representative field → submit → Cancel remains the applicable order; nonreaders have no eyebrow tab stop.

**Existing mobile limitation:** German at width 390 has 36 px document overflow before and after in the partial preview; English/mobile and both desktop locales have none. The existing nonwrapping `flex gap-2` action row and long German submit/Cancel labels remain unchanged. The screenshot test now measures and compares baseline overflow rather than claiming an absolute zero that the original page does not satisfy. No production layout fix or clipping was introduced. This is disclosed baseline debt, not a new overflow regression; full authenticated-page dimensions remain unverified.

### Real RHF clean/dirty navigation and mounting boundary

The mounted subset is the actual PageHeader HTML, actual submit/Cancel action-row HTML, real RHFActionForm with its actual class/warning configuration, and the actual local Field helper's first-name label/input native tree. That native tree is reconstructed with React.createElement so the input's real React change events reach RHF. The remaining names/contact/service/provider/conditional/follow-up/timezone/funding fields, full hierarchy, options/defaults, errors and action identity are inspected only through the actual server-returned tree; they are not hydrated in the browser preview.

The synthetic action only increments a counter. It never invokes createAdmissionCaseAction or creates data. For both `/admissions` and `/`, in both locales, tests verify clean Cancel navigates without a dialog; editing firstName invokes the real RHF localized confirm; rejecting retains `/admissions/new` and the draft; accepting via keyboard Enter reaches the exact href and unmounts the form. Submission and refresh counters remain zero and the synthetic tenant cookie is unchanged.

RHF's document-capture listener supplies the actual confirmation logic. A test-only bubble handler models the Next routing boundary after capture allows navigation; it does not implement its own confirmation or permission condition. The destination is a placeholder. This proves the real guard works in this isolated partial fixture, not full Admission hydration or authenticated Next routing.

### Initial failures and limitations

- The first server test run exited 1: 22 passed, two new tests failed because React's static markup used `maxLength` rather than the test's lowercase `maxlength` expectation. The assertion was corrected; final 24 pass / 5,354 assertions.
- The first focused browser run exited 1: one passed, three failed. Raw innerHTML for the representative input did not participate in React's change handling, causing both dirty-confirmation tests to time out. It was replaced with the actual Field helper's native tree mounted by React. The German screenshot test also exposed the existing mobile overflow; final tests compare and disclose its unchanged 36 px baseline. No production behavior was changed to accommodate tests.
- A temporary next-goal evidence driver initially lacked the mocked hasClientPermission export. It was supplied with a fail-if-called stub for the empty-query scenario; all eight final actual-page reports completed, and the driver was removed. This did not alter production or permanent test boundaries.
- Isolated OIDC discovery using `.env.test` and a five-second timeout returned **unavailable**, exit 2, without printing credentials, issuer or tokens (`logs/oidc.log`). Authentication was not modified.

Evidence is under ignored `artifacts/goal-18/`: baseline source/hash/reports in `before/`, current reports in `after/`, screenshot images/reports, `page-comparison.json`, `screenshot-comparison.json`, `file-sizes.json`, `debt-evidence.json` and `logs/` including initial failure logs.

Actual server-page rendering, synthetic permission/API tests, isolated browser interactions, real RHF guard behavior within the mounting boundary, screenshots and axe are verified. Full authenticated Next hydration, actual root/list authorization, authenticated Office E2E, complete admission creation/save workflows and production tenant-cookie behavior remain unverified. Counter/cookie assertions apply to the test bridge only. Source comparisons prove tenant-selection and action implementations did not change; integration checks do not substitute for authenticated E2E.

## D. Remaining technical debt

1. **Admission return controls are fixed within scope.** The original denial and post-save behavior are intentionally preserved. No successful save with restricted read has been tested under authentication; missing coverage alone is not a defect, and no post-save issue is asserted.
2. **Confirmed New Communication return mismatch.** Current `communications/new/page.tsx` requires communications.create + client.read, then offers an eyebrow and Cancel to `/communications`. The worklist requires communications.read + client.read and returns its original noAccess paragraph without either. Eight actual-page reports in `debt-evidence.json` cover both locales: create+client-read without communications-read renders both restricted links and the list denial; adding read preserves the creation chooser; removing either creation prerequisite denies it. Empty query, no selected-client request, native method=get form. Source independently confirms the worklist application requires communications.read. This is a demonstrated return-navigation mismatch; selected-client continuation and post-save access are separate and not claimed verified.
3. **Existing German mobile overflow is measured but deferred.** The admission preview retains 36 px overflow at 390 px for both reader/nonreader cases. Source still uses a nonwrapping action row. No layout change belongs in this goal, and this handoff does not select a second next-goal implementation. Future investigation should validate the complete page before choosing a responsive correction.
4. **Deliberately bounded UI remains bounded.** Primary Overview fallback for restricted creators, other navigation owners, Billing/Administration fragment policies and segment lifetimes are unchanged. No other Client or Admission workflow defect is inferred. Briefly inspected Employee/Services pages are not promoted to verified defects without a reproduction.

## E. Goal 19 preparation

**Select exactly one improvement: permission-aware return controls on New Communication.** Production scope is one page and two existing return controls. The native GET chooser differs from Admission's RHF creation form and must remain native.

1. **User-facing issue / reproduction:** with communications.create + client.read and no communications.read, open `/communications/new` with an empty query. The real page allows the client chooser but both return links go to `/communications`, whose real page denies that grant set. Actual-page evidence exists in English and German.
2. **Existing versus intended:** after the existing combined guard passes, retain both original `/communications` links for communications.read. Without it, render the same Communications.globalTitle as ordinary eyebrow text and retain the secondary Cancel Link with href `/`. Preserve Common.actions.cancel. No automatic navigation or fallback breadcrumb.
3. **Exact production file / dependencies:** only `apps/web/src/app/(office)/communications/new/page.tsx`, its PageHeader eyebrow and Cancel href. Reuse current grants and hasPermission. Existing PageHeader/Button/Link/real catalogs and process-isolated navigation fixtures suffice. No new abstraction, package, permission, route or request.
4. **Permission / tenant:** preserve exactly communications.create AND client.read and the early translated noAccess paragraph/role/class/order. communications.read cannot bypass either. Preserve list/backend scope authorization, getTenantHeader and hasClientPermission behavior. Root is the existing tenant-selection entry route and does not itself select/clear a tenant.
5. **Localization / accessibility:** existing t('globalTitle'), createFromWorklist title, chooseClientDescription and common('Common.actions.cancel') remain unchanged. Preserve reader semantics/style/layout, secondary Button treatment and Tab/focus order. Plain nonreader eyebrow has no link/role/tabindex/button. No new copy or control.
6. **Regression coverage:** extend the actual-page fixture with actual NewCommunicationPage and its real header/action row. Both locales: all three relevant grants, create+client-read without communications-read, missing either prerequisite with read, each alone, none/unrelated, mixed, duplicate/reordered. Assert exact denial/no form/no controls/no redirect. Compare full native form tree, method=get, hidden continue=1, required clientId AsyncEntityCombobox/minQueryLength=2, submit button, missingClient notice and API decisions outside the two changes.
7. **Continuation compatibility:** preserve validUuid rules, query clientId/continue handling, selected-client GET, hasClientPermission resource checks and exact existing redirect `/clients/${client.id}/communications#new-interaction`. Use synthetic API/client boundaries for focused selected-client success/failure cases; do not create records or weaken access. Do not turn this GET chooser into RHFActionForm or add unsaved confirmation. Retain Goal 10–18 tests, including actual RHF cases, without extending RHF into this page.
8. **Browser / screenshot strategy:** use actual server-produced header, native GET form/control configuration and Cancel controls, synthetic records only. Capture both locales, desktop/mobile, reader/nonreader and mixed/duplicate/reordered grants. Compare pixels, geometry and baseline overflow honestly. Verify semantics/names/hrefs, secondary target dimensions/style, Tab/focus, no extra controls, no unintended Cancel submission, zero requests/tenant changes attributable to Cancel, and axe. Exercise both Cancel destinations without adding a confirmation that the native form does not have. Explicitly distinguish static selector/configuration inspection from real chooser hydration and authenticated routing. Preserve the unrelated Admission overflow baseline.
9. **Risks / exclusions:** weakening the guard, inferring read, changing the selected-client continuation or notice, submitting Cancel, introducing history/returnTo or tenant mutation. Exclude all other Communications/Admission/Client pages, all actions/workflows/post-save paths, primary/secondary navigation, Goal 12–18 implementations, auth/backend/API/generated/schema/catalog/dependencies and baseline changes. No responsive redesign or Admission overflow fix in this selected goal.
10. **Definition of done:** exact current reader links; plain eyebrow plus Cancel `/` for permitted nonreaders; exact combined denial; chooser/continuation/API/tenant behavior unchanged; both-locale actual-page/browser/accessibility evidence; all required gates; zero new violations; Graphify refreshed; `docs/architecture/goal-19-to-goal-20.md` complete. Do not implement Goal 20.

## F. Copy-ready Goal 19 prompt

```text
Goal 19: Permission-aware return controls on New Communication

Repository: /home/woobb/Projects/care (woobble/care). Implement Goal 19 and its handoff. No multi-agent mode. Do not implement Goal 20.

Read AGENTS.md, apps/web/AGENTS.md, applicable installed frontend/Next instructions, docs/architecture/overview.md, module-boundaries.md, relevant Communications docs and docs/architecture/goal-18-to-goal-19.md. Inspect git status and preserve unrelated work; query Graphify first. Reproduce the actual new/list page mismatch with communications.create + client.read but no communications.read. Capture source/rendering baselines before editing.

Production scope: only apps/web/src/app/(office)/communications/new/page.tsx, the existing PageHeader eyebrow and Cancel Link href. Reuse fetched grants and existing hasPermission. Preserve exactly the communications.create AND client.read guard, its position and early translated noAccess paragraph, role and CSS classes. communications.read must not bypass either prerequisite. No redirect or new fallback response for denied callers.

For permitted callers with communications.read, retain the exact existing Communications.globalTitle eyebrow Link and secondary Cancel Link to /communications. Without communications.read, render the same eyebrow text as ordinary text with no href/role/tabindex/button/fallback destination, and change only the existing Cancel href to /. Preserve Button asChild, variant secondary, Common.actions.cancel, all title/description/layout/style/order/focus behavior. Root is the existing tenant-selection entry route; do not mutate tenant/session state or invoke tenant selection. Add no copy, controls, requests, permissions, routes, dependencies, history, returnTo or generic return framework.

Preserve the native method=get chooser form, hidden continue=1, required clientId AsyncEntityCombobox/minQueryLength=2, submit label/type, notice, query handling and validUuid rules. Keep selected-client GET, hasClientPermission tenant/provider checks and exact client-communications continuation redirect unchanged. No Server Action, save workflow or post-save changes. Do not introduce RHFActionForm or unsaved-change confirmation to this native GET chooser.

Extend existing process-isolated tests to execute actual NewCommunicationPage with real English/German catalogs and synthetic request/API/grant boundaries. Cover all three relevant grants; create+client-read without read; missing either prerequisite even with read; each alone; none/unrelated; mixed; duplicate/reordered. Assert exact denial, no header/form/Cancel/redirect; permitted title/description/eyebrow/Cancel semantics and one original secondary control. Compare actual full native form tree and API decisions outside the two intended controls. Verify missing-client notice and selected-client continuation success/failure with synthetic clients and permission boundaries. Preserve Goal 10–18 coverage, including existing RHF tests.

Extend the existing isolated browser fixture with actual server-produced header, native chooser/control configuration and Cancel controls. Capture before/after English/German desktop/mobile reader/nonreader and mixed/duplicate/reordered cases. Quantify pixels, geometry and existing overflow; do not hide baseline defects. Verify exact destinations/names/semantics, Button treatment and target dimensions, keyboard/visible focus, no extra controls or unintended Cancel submission, unchanged tenant state within the bridge, and axe WCAG scans. Exercise both Cancel destinations without a new confirmation. Disclose partial selector hydration, routing and authentication boundaries. Probe OIDC without exposing secrets or modifying auth.

Exclude other Communications/Admission/Client pages, actions/workflows, post-save behavior, tenant selection, auth/backend/API/generated/schema/catalog/dependency/baseline changes, all primary/secondary navigation, Goal 12–18 implementations and Admission responsive layout debt.

Run AGENTS.md formatting: bunx oxlint --fix, then bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'. Inspect the diff. Build before generation-dependent checks. Run focused and full relevant isolated suites, bun run build, architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, format:check, and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new architecture violations and unchanged excluded files.

Create docs/architecture/goal-19-to-goal-20.md with A–F: status/active duration; exact implementation, permission decisions and all before/after file sizes; exact commands/status/counts/initial failures; screenshots/accessibility/localization and hydration/authenticated limits; evidence-based debt reassessment; exactly one small confirmed Goal 20 improvement and standalone prompt requiring docs/architecture/goal-20-to-goal-21.md. Do not implement Goal 20 or 21.

Final response numbered 1–10: status/duration, implementation, matrix, changed files/sizes, focused/full checks, screenshots/accessibility, chooser/continuation compatibility, authenticated gaps, handoff path, copy-ready Goal 20 prompt.
```
