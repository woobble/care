# Goal 19 → Goal 20 handoff

## A. Implementation summary

**Goal 19: Complete.** Active duration: approximately 12 minutes. The starting worktree was clean at `1b77eacdb6802a0d0460f8fb6dd0b80f029018ad`; Goal 18 was already committed. Changes are unstaged and uncommitted. Goal 20 is preparation only.

Only two existing expressions in `apps/web/src/app/(office)/communications/new/page.tsx` changed:

- The PageHeader eyebrow uses the existing grants and hasPermission('communications.read'). Readers retain the original Link to `/communications` with t('globalTitle'); permitted nonreaders receive the same localized text with no interactive wrapper.
- The existing Button asChild / variant secondary / Link Cancel retains its label, styling, dimensions, placement and keyboard treatment. Only its href changes: `/communications` for readers, `/` otherwise.

The combined communications.create AND client.read guard remains exactly as before, including its position, original translated noAccess paragraph, role="alert", CSS classes and early return. No denial redirect or fallback rendering was introduced. The native GET chooser, query handling, UUID validator, selected-client request, resource authorization and exact fragment redirect remain unchanged. No production scope deviation.

| Grants                                                                     | Chooser access                    | Eyebrow / Cancel                       |
| -------------------------------------------------------------------------- | --------------------------------- | -------------------------------------- |
| communications.create + client.read + communications.read                  | Existing chooser                  | Original `/communications` links       |
| communications.create + client.read, no communications.read                | Existing chooser                  | Same ordinary eyebrow text; Cancel `/` |
| communications.read + client.read without create                           | Exact original denial             | No form or return controls             |
| communications.create + communications.read without client.read            | Exact original denial             | No form or return controls             |
| Create only, client-read only, communications-read only, none or unrelated | Exact original denial             | No form or return controls             |
| Mixed, duplicate or reordered grants                                       | Same independent capability rules | Same results                           |

Before/after sizes against the starting commit, expressed as newline-delimited lines / UTF-8 bytes:

| File                                                    |         Before |           After |
| ------------------------------------------------------- | -------------: | --------------: |
| `apps/web/src/app/(office)/communications/new/page.tsx` |     94 / 2,996 |     102 / 3,217 |
| `apps/web/scripts/office-navigation.fixture.ts`         |   492 / 19,974 |    628 / 25,967 |
| `apps/web/scripts/office-navigation.test.ts`            | 1,196 / 46,354 |  1,515 / 58,317 |
| `apps/web/e2e/support/office-navigation-app.tsx`        |    274 / 9,316 |    355 / 12,193 |
| `apps/web/e2e/office-navigation.spec.ts`                | 2,160 / 88,485 | 2,468 / 101,029 |
| `docs/architecture/goal-19-to-goal-20.md`               |            New |    172 / 33,116 |

The existing process-isolated fixture now executes the actual NewCommunicationPage and extracts its actual header, secondary Cancel, native form tree, selector configuration, notices, GET calls, capability/resource-check arguments and redirects. Tests retain Goal 10–18 coverage. The browser app mounts the real AsyncEntityCombobox from actual page props in the native GET form configuration and uses actual server-produced header/actions/notice HTML. No permission branch is duplicated in a client fixture. No RHF form or unsaved confirmation was added to Communication.

## B. Architecture and permission decisions

communications.create and client.read remain the exact creation prerequisites. communications.read independently determines whether offering the history worklist as return navigation is appropriate. It does not bypass either prerequisite or replace the selected client's resource-scoped communications.create check. Both return controls reuse the server's existing grants and imported helper, without another API request.

The `/` fallback is the existing authenticated tenant-selection entry route. Its implementation reads the session and memberships and does not require communication history access. A visit does not invoke selectTenantAction or change the selected tenant. No session clearing, cookie mutation, history inference, router.back, returnTo, new route or generalized return framework was introduced.

The chooser remains `<form method="get">` with hidden continue=1, one required clientId AsyncEntityCombobox/minQueryLength=2, the original Continue submit button, missing-client notice and original action row. Its native behavior intentionally differs from the RHF creation forms used elsewhere. Consistency is not a reason to replace it or add a confirmation.

The original validUuid implementation and query.clientId/query.continue processing are unchanged. A valid ID triggers the same `/api/v1/clients/{id}` GET with the existing tenant header. Only a returned client passing the existing hasClientPermission(grants, 'communications.create', tenant, organization, primaryFacility) check redirects to `/clients/${client.id}/communications#new-interaction`. Missing, invalid, unavailable or resource-denied clients retain their original behavior. No communication is created by this step.

The only additional helper evaluations are the two intended presentation checks for communications.read when the chooser renders. Denials and successful selected-client redirects execute the exact original check sequence. There are no additional requests or resource authorization checks. API authorization remains authoritative.

## C. Verification

Final required gates pass with exit 0 except the discovery probe, explicitly documented as unavailable below. Build preceded the final generated-output-dependent repository gates. Turbo reused unchanged tasks where applicable; integration logs show execution of isolated API, worker and database/RLS tests.

| Exact command at repository root                                                                                                                                                                | Result                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `bun test apps/web/scripts/office-navigation.test.ts`                                                                                                                                           | 28 tests / 6,358 assertions; pass                                                                                          |
| `bun test apps/web/scripts/office-navigation.test.ts apps/web/scripts/administration-navigation.test.ts apps/web/scripts/billing-navigation.test.ts apps/web/src/lib/office-navigation.test.ts` | 42 tests / 6,652 assertions; pass                                                                                          |
| `bun run --filter @care/web typecheck`                                                                                                                                                          | Pass                                                                                                                       |
| `bun run build`                                                                                                                                                                                 | OpenAPI/client generation; 32 successful tasks                                                                             |
| `bun run architecture:check`                                                                                                                                                                    | 159 existing violations; zero new; zero resolved baseline entries                                                          |
| `bun run architecture:test`                                                                                                                                                                     | 15 tests / 33 assertions; pass                                                                                             |
| `bun run lint`                                                                                                                                                                                  | 33 successful tasks                                                                                                        |
| `bun run typecheck`                                                                                                                                                                             | 33 successful tasks                                                                                                        |
| `bun run test`                                                                                                                                                                                  | 51 successful tasks; web 80 tests / 7,259 assertions                                                                       |
| `bun run test:integration`                                                                                                                                                                      | 32 successful tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80; total 15 tests / 1,658 assertions |
| `bun run i18n:check`                                                                                                                                                                            | 3,585 messages; English/German parity and static JSX scan pass                                                             |
| `bunx oxlint --fix`                                                                                                                                                                             | Pass                                                                                                                       |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'`                                                                 | Pass                                                                                                                       |
| `bun run format:check`                                                                                                                                                                          | Pass                                                                                                                       |
| `bunx oxlint --deny-warnings --format=agent`                                                                                                                                                    | Pass                                                                                                                       |
| `graphify update .`                                                                                                                                                                             | AST-only, 13,291 nodes / 39,893 edges / 709 communities; no API cost                                                       |

### Actual-page baseline, permission matrix and continuation

Both locales use the real NewCommunicationPage and real catalogs with process-isolated synthetic request/API/grant boundaries. The original new/list mismatch was reproduced before editing: communications.create + client.read renders both `/communications` links, while the actual history page returns its original noAccess paragraph without communications.read.

Baseline source/hash and actual rendered reports were captured before production changes. The before/after audit covers **15 grant sets × ten query/API/resource scenarios × two locales = 300 pairs**. The grant sets include every requested prerequisite/read combination, mixed grants with and without history read, duplicate grants and reordered prerequisites. Query scenarios include empty, continue=1 without client, invalid UUID with/without continue, API error, missing client, resource-denied client, successful resource authorization, null facility, and successful continuation without continue.

All 300 reports match outside the intended return controls and their two presentation-only helper evaluations. All **140 denied reports** and **48 successful continuation redirect reports** are fully identical: **188 entire reports** unchanged. The 112 chooser render pairs preserve the complete native form/selector/notice/request/resource data after normalizing only the two controls and the intended presentation evaluations. All 56 permitted reader renders retain identical actual header/action markup and form trees; their recorded evaluation list gains the same two presentation checks as nonreaders.

Permanent tests assert the exact denial paragraph and no header/form/Cancel/selector/redirect, including valid selected-client queries that cannot bypass missing prerequisites. Allowed cases assert localized header/title/description, link/plain-text semantics, Cancel destination/name, original secondary Button, one submit/Cancel/selector, native GET method, classes, hidden input, required selector and minimum length, error notice, full normalized form tree, mixed/duplicate/reordered compatibility and no empty-query requests.

Continuation tests assert the exact GET options/tenant header, original resource-check argument sequence, no resource check when data is absent, and the exact redirect including `#new-interaction`. They cover API error/missing/denied/allowed and null facility, plus invalid version/variant/nil/whitespace/suffix UUID cases and uppercase version-8 acceptance. The mocked resource evaluator explicitly returns synthetic allowed/denied outcomes; these tests prove the page's unchanged delegation and call arguments, not real authorization correctness under a live session.

Baseline captures used `python3 artifacts/goal-19/capture.py before` and `python3 artifacts/goal-19/capture.py after`; the final report/source audit used `python3 artifacts/goal-19/audit.py` (all exit 0).

The strict source audit restores the exact original page by replacing only the eyebrow and Cancel expressions. This proves the original guard, native form, validation, query handling, GET, tenant header, resource check and redirect remain byte-for-byte unchanged (`logs/scope-audit.log`). Original/current reports and the comparison summary are in `before/`, `after/` and `page-comparison.json`. Temporary next-goal evidence drivers were removed.

OpenAPI, all 18 generated API-client files, both catalogs and the architecture baseline are byte-identical to HEAD. Other Communications, Admission and Client pages, all actions/workflows, RHFActionForm, tenant selection, OfficeShell and primary/secondary navigation remain unchanged. No backend/API/schema/migration/dependency/permission/baseline change occurred.

### Browser commands and evidence

Focused command from repository root:

```bash
NEW_COMMUNICATION_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-19/before NEW_COMMUNICATION_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-19/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal19/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal19/cache bun run --filter @care/web test:navigation --grep 'New Communication'
```

Result: **4 passed**. Full isolated command from `apps/web`:

```bash
NEW_COMMUNICATION_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-19/before NEW_COMMUNICATION_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-19/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal19/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal19/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: **57 passed**: 38 navigation, six presentation and thirteen form tests. The existing installed Chromium headless shell was supplied explicitly, with writable XDG paths. No dependency or browser installation was needed.

Focused captures include **40 PNGs and 40 JSON reports**: reader, nonreader, mixed, duplicate and reordered scenarios × English/German × 1440×900 desktop / 390×900 mobile × before/after. All **20 pairs are pixel-identical**, with identical header/form/Cancel bounding boxes. All forty renders have **zero horizontal overflow** and **zero axe WCAG 2 A/AA / WCAG 2.1 AA violations**. English desktop reader and German mobile nonreader captures were visually inspected. There are no unexpected pixel changes or existing overflow in this chooser preview. The separate Admission German mobile baseline was not changed or incorporated into this implementation.

Tests assert exact accessible names/hrefs, ordinary nonreader eyebrow without role/tabindex/button, native GET method, hidden input, aria-required selector, original Continue submit and secondary Cancel treatment, at least 40×40 Cancel target dimensions, and no extra form links/submits. Tab order is eyebrow when present → client combobox → Continue → Cancel, with visible Cancel focus.

Runtime tests cover both Cancel destinations in both locales, before and after selecting a synthetic client through the **real AsyncEntityCombobox**. Empty Cancel performs no API request; selection performs one mocked entity-search request; subsequent keyboard Cancel adds none. Cancel never submits, records FormData or refreshes. The synthetic tenant cookie remains unchanged and no dialog appears. A separate missing-client render retains the original notice and method=get; Continue triggers native FormData capture with continue=1 and clientId='', and the bridge models the corresponding GET URL. Server-side successful selected-client continuation is separately covered by actual-page tests.

### Native chooser and routing boundaries

Mounted elements are the actual server-produced PageHeader, actual submit/Cancel HTML, actual missing-client notice when applicable, the native form method/classes/hidden inputs from the real page report, and the real AsyncEntityCombobox with its actual label/placeholder/required/minimum-query props. All chooser fields are represented. The entity-search route returns only synthetic options. No communication record or create action is invoked.

A test-only click handler models Next navigation for the returned anchors. A submit handler prevents the document request, observes native FormData and models its GET URL. These bridges add neither permission checks nor confirmation. Thus the real combobox and native form semantics are exercised, while production Next hydration, full document GET routing and destination authorization are not implied. Retained RHF tests belong to other workflows and do not turn this chooser into RHF.

### Initial failures, discovery and authenticated gaps

No permanent server, browser, build, typecheck or quality-gate test failed during Goal 19. An initial temporary next-goal evidence driver lacked the mocked next/navigation useRouter export required by an imported component; it exited 1 before page execution. The export was supplied with a fail-if-hydrated stub. Four final New Claim/worklist/navigation reports completed, and the temporary driver was removed. No production adjustment was made for that fixture issue.

Isolated OIDC discovery was probed with `.env.test` and a five-second timeout. It returned **unavailable**, exit 2, without printing credentials, issuer or tokens (`logs/oidc.log`). Actual server-page rendering, synthetic selected-client/API/resource boundaries, isolated browser interactions, native chooser/real combobox behavior, screenshots and axe are verified.

Full authenticated Next.js hydration, authenticated Office E2E, actual root/history/client-record authorization, production tenant-cookie behavior and complete communication creation/save workflows remain unverified. Tenant and request assertions are scoped to the bridge and mocked search endpoint. Source/contract comparisons prove no production authorization or tenant code changed; integration does not replace authenticated E2E. No auth bypass was added.

Evidence is under ignored `artifacts/goal-19/`: `before/`, `after/`, `cases.json`, `page-comparison.json`, `screenshots/`, `screenshot-comparison.json`, `file-sizes.json`, `debt-evidence.json` and `logs/`.

## D. Remaining technical debt

1. **New Communication return controls are fixed.** Its GET chooser, empty-selection notice and selected-client continuation are intentionally preserved. There is no reason to convert it to RHF or introduce dirty-form behavior. Missing authenticated coverage alone is not a new workflow defect.
2. **Confirmed New Claim breadcrumb mismatch.** Current `billing/claims/new/page.tsx` always links its Claims eyebrow to `/billing/claims`, even without claims.read. Four actual NewClaimPage/ClaimsWorklistPage/BillingNavigation reports in both locales reproduce it with synthetic issued invoice/payer-arrangement context and billing.read + claims.manage: the actual creation form exists and the eyebrow is linked, while the real worklist shows noClaimsPermission and BillingNavigation omits its Claims item. Adding claims.read retains the form and restores that navigation item. The owning Claims list application independently requires claims.read. These are synthetic API/resource boundaries, not proof of an authenticated billing workflow. The narrow defect is the offered history destination; do not infer another save/authorization defect.
3. **Other inspected pages are not automatically defects.** Services reads categories and deliberately separates catalog/category management capabilities; its list is not an identical early-denial pattern. Employee creation has a different permission-fetch structure. No blanket return-link or creation-guard project is proposed from those observations. Existing bounded primary/secondary navigation remains unchanged.
4. **Admission mobile overflow remains separate debt.** Goal 18 documented 36 px overflow at German width 390 in its partial preview. No Admission source or tests were changed here, and no responsive fix is selected for Goal 20. Full-page validation should precede any later layout correction.
5. **Post-save and selected-record behavior remain distinct.** Neither communication record creation nor claim save paths were exercised under authentication. Their redirects/actions are unchanged. Do not label unverified post-save permissions as confirmed defects.

## E. Goal 20 preparation

**Select exactly one improvement: permission-aware Claims eyebrow on New Claim.** This page has one relevant breadcrumb, not a Cancel control. Do not invent a second control or fallback destination.

1. **Reproduction:** using a synthetic/live authorized issued invoice and eligible payer arrangement, open `/billing/claims/new?invoiceId=<uuid>` with billing.read + claims.manage and without claims.read. The actual page renders its claim form and an eyebrow Link to `/billing/claims`; the worklist reports noClaimsPermission and the Billing navigation omits Claims. Both-locale actual-page evidence is in debt-evidence.json. Real access to invoice/arrangement/profile resources remains independently authorized.
2. **Intended behavior:** with claims.read, retain the exact existing t('claims') Link to `/billing/claims`. Without claims.read, keep the same translated eyebrow as ordinary noninteractive text. Preserve title, invoice/client description, PageHeader placement and all page contents. No root or other fallback breadcrumb, Cancel button, automatic navigation or new copy.
3. **Exact production file:** only `apps/web/src/app/(office)/billing/claims/new/page.tsx`. Add the existing hasPermission helper to its current API import and condition only the existing eyebrow using already-fetched permissions. No additional API call, client-side check, capability, route, dependency, variable framework or generic component is needed.
4. **Permission / tenant constraints:** claims.read governs the offered list destination, matching existing BillingNavigation/ClaimsWorklist presence semantics. It does not govern page access or imply claims.manage, billing.read, client.read or service_evidence.read. Preserve all existing hasClientPermission calls with their tenant/provider arguments, invoice query validation, notFound behavior, canManage/canCreate and issued/line/arrangement requirements. Do not introduce a new creation guard or denied-page response. No authorization widening or tenant mutation.
5. **Localization / accessibility:** reuse Billing.claims; preserve reader Link markup/semantics and keyboard position. Nonreader eyebrow has no anchor/button/href/role/tabindex/disabled styling. Keep page title/description, styles, width and all independent links unchanged. No catalog changes.
6. **Focused tests:** extend existing process-isolated actual-page fixtures with real NewClaimPage, PageHeader and real catalogs. Cover claims.read present/absent with representative valid invoice/resource context; management absent; mixed, duplicate and reordered grants; English/German. Assert actual form availability remains governed by the same existing conditions. Cover missing/invalid invoiceId and invoice not-found/unavailable paths with their exact current behavior. Compare full returned trees/API options/errors/resource checks/actions/field defaults/confirmation outside the single eyebrow and intended presence evaluation. Preserve Goal 10–19 tests.
7. **Browser / screenshots:** minimally extend the existing browser fixture with actual server-produced New Claim header and relevant invoice/Billing navigation context. Capture before/after reader/nonreader plus mixed/duplicate/reordered grants in both locales and desktop/mobile. Assert exact names/hrefs/plain text, Tab and visible focus, original geometry/target dimensions, no new overflow and scoped axe; quantify pixel changes and baseline limitations. Inspect unmounted claim form/action trees without claiming full hydration or creating invoices/claims. No fabricated Cancel or RHF dirty guard is needed for this breadcrumb-only change.
8. **Compatibility risks:** accidentally replacing resource-scoped checks with presence checks, changing notFound/issued status/arrangement logic, altering the dependent GET sequence or BillingNavigation ownership, mounting a form with different configuration, or expanding one breadcrumb correction into save behavior. Keep createClaimAction, ConfirmSubmitButton, line amounts/versions/defaults, mandates/profiles, evidence/client links and post-save behavior untouched.
9. **Exclusions:** other Claims/Billing pages, BillingNavigation and all primary/secondary navigation, Communications/Admission/Client pages, existing guards/forms/actions/workflows, auth/tenant/API/backend/generated/schema/catalog/dependency/baseline changes, history/returnTo, responsive redesign and generic return frameworks. No additional return control.
10. **Definition of done:** exact reader eyebrow retained; same text noninteractive without claims.read; current page/form/API/resource behavior unchanged; both-locale actual-page/browser/accessibility evidence; all required gates; zero new violations; Graphify refreshed; `docs/architecture/goal-20-to-goal-21.md` complete. Do not implement Goal 21.

## F. Copy-ready Goal 20 prompt

```text
Goal 20: Permission-aware Claims eyebrow on New Claim

Repository: /home/woobb/Projects/care (woobble/care). Implement Goal 20 and its handoff only. No multi-agent mode. Do not implement Goal 21.

Read AGENTS.md, apps/web/AGENTS.md, installed frontend/Next instructions, docs/architecture/overview.md, module-boundaries.md, relevant Billing/Claims domain docs and docs/architecture/goal-19-to-goal-20.md, especially E–F. Check git status, preserve unrelated work and query Graphify first. Reproduce the recorded actual-page breadcrumb mismatch with an issued invoice, eligible payer arrangement, billing.read + claims.manage and no claims.read; keep API/resource boundaries explicit. Capture source/rendering baselines before editing.

Production scope: only apps/web/src/app/(office)/billing/claims/new/page.tsx. Add existing hasPermission to the current API import. Use already-fetched permissions to condition only the existing PageHeader eyebrow. With claims.read retain the exact t('claims') Link to /billing/claims; without it render the same localized text as ordinary text, with no href/anchor/button/role/tabindex/disabled styling/fallback destination. Preserve PageHeader title/description/layout/styles. No Cancel or other new control, copy, automatic navigation, route, permission, request, dependency, history/returnTo or generic framework.

Preserve current page access and invoice validation/notFound behavior exactly. claims.read must not imply claims.manage or other capabilities or become a new page guard. Preserve every hasClientPermission call and tenant/provider argument, all GETs/options, canManage/canCreate, issued/line/eligible-arrangement requirements, alerts, form/action identity, confirmation, amounts/versions/defaults, mandate/profile choices, independent client/evidence links, post-save redirects and cache behavior. Do not change BillingNavigation, the Claims worklist, other pages, auth/tenant/backend/API/generated/schema/catalog/dependencies or architecture baseline.

Extend existing process-isolated tests to execute actual NewClaimPage with real English/German catalogs and synthetic invoice/payer/API/resource boundaries. Cover read present/absent, management absent, mixed/duplicate/reordered grants and existing invoice error/notFound paths. Assert exact eyebrow semantics/name/href and unchanged existing form availability. Compare complete returned trees/actions/fields/confirmation/errors/API/resource checks outside the eyebrow and its one intended presence evaluation. Retain Goal 10–19 coverage.

Minimally extend isolated browser fixtures using actual server-produced header and invoice/Billing navigation context. Capture before/after English/German desktop/mobile reader/nonreader plus representative mixed/duplicate/reordered grants. Compare pixels/geometry, target dimensions and baseline overflow honestly. Verify names, Tab/focus, ordinary nonreader text, no extra controls and axe WCAG scans. Do not create real invoices/claims, fabricate a Cancel button or add a dirty-form guard. Disclose unmounted form/configuration, Next hydration, routing and authentication boundaries; probe OIDC without secrets or auth changes.

Run AGENTS.md formatting: bunx oxlint --fix, then bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'. Inspect all diffs. Build before generation-dependent checks. Run focused/full relevant isolated suites, bun run build, architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, format:check, and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new architecture violations and unchanged excluded files.

Create docs/architecture/goal-20-to-goal-21.md with A–F: status/active duration; implementation/permission decisions and every file's before/after lines/bytes; exact commands/status/counts/initial failures, screenshots/accessibility/localization and authenticated limits; evidence-based debt reassessment; exactly one small confirmed next improvement and standalone Goal 21 prompt requiring docs/architecture/goal-21-to-goal-22.md. Do not implement Goal 21 or 22.

Final response numbered 1–10: status/duration, implementation, permission matrix, files/sizes, focused/full results, screenshot/accessibility evidence, form/API compatibility, authenticated gaps, handoff location and copy-ready Goal 21 prompt.
```
