# Goal 14 → Goal 15 handoff

## A. Goal 14 summary

**Status: Complete.** Active implementation took approximately 8–9 minutes, including verification and this handoff. The existing Office selector now returns the already visible Administration item for three exact settings paths only after its normal matching chain finds no owner. Required gates and 37 isolated browser tests pass. Authenticated Office E2E, complete Next hydration and actual destination authorization remain unverified because isolated OIDC discovery is unavailable. Goal 15 has not been implemented.

The only production change is `apps/web/src/lib/office-navigation.ts`:

1. Flatten the existing server-filtered groups into a local array.
2. Run the unchanged active-item predicate and descending href-length selection.
3. Return any normal match immediately.
4. Otherwise, match exactly `/billing/settings`, `/billing/claims/settings` or `/operations/reminder-settings`, with one optional trailing slash after existing query/fragment stripping; return the first original visible item whose id is administration.
5. Otherwise, or when Administration is absent, return undefined.

No new item, label, href, route registry, permission input, request, hook or dependency was introduced. Function generics and return type are unchanged. The existing active predicate is byte-identical, including Goal 10 visit matching. Normal match filtering/sorting uses a new local array and does not mutate groups/items. No production scope deviation.

| Visible navigation / path                                              | Result                                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Billing + Administration; `/billing/settings`                          | Existing Billing item                                                       |
| Claims + Administration; `/billing/claims/settings`                    | Existing Claims item                                                        |
| Billing + Administration, Claims hidden; Claims settings               | Existing Billing parent                                                     |
| Operations + Administration; Reminder settings                         | Existing Operations item                                                    |
| Administration, no normal owner; any of the three exact settings paths | Original Administration item                                                |
| No Administration and no normal owner / empty groups                   | Undefined; existing shell Overview fallback                                 |
| Unrelated or strict-negative path, Administration only                 | Undefined                                                                   |
| Strict-negative path already matched by a visible normal parent        | Original normal parent; fallback precision does not replace legacy matching |

Before/after sizes against starting commit `bea50cd685de5676fe380bb22129fb66e018faba` (newline-delimited lines / UTF-8 bytes):

| File                                         |       Before |          After |
| -------------------------------------------- | -----------: | -------------: |
| `apps/web/src/lib/office-navigation.ts`      |   21 / 1,006 |     29 / 1,308 |
| `apps/web/src/lib/office-navigation.test.ts` |   94 / 3,299 |    191 / 7,077 |
| `apps/web/scripts/office-navigation.test.ts` | 528 / 20,088 |   630 / 24,076 |
| `apps/web/e2e/office-navigation.spec.ts`     | 835 / 33,488 | 1,082 / 43,416 |
| `docs/architecture/goal-14-to-goal-15.md`    |          New |   160 / 28,916 |

Pure tests add precise fallback, object identity, frozen-input nonmutation and owner precedence cases. Actual-layout tests add both-locale grant/ordering/identity matrices. Browser tests add settings-context screenshots and interactions; the one Goal 11 assertion after navigating to `/billing/settings` now expects existing Administration ownership, with its explanatory comment updated. All surrounding Goal 11 checks and other historical expectations remain intact. The server fixture, browser app/builder, Office layout/shell/mobile implementation, settings pages/headers/notes, secondary navigation, forms/actions, catalogs, backend and permission filtering are unchanged. Ignored evidence and Graphify output were refreshed.

## B. Architecture and permissions

Normal selection must win because visible Billing, Claims and Operations items already own these routes through existing prefix rules. Applying Administration first would override established page ownership, including Billing as the parent when Claims is hidden. The implementation returns the normal item before evaluating the new anchored, case-sensitive expression. This also preserves existing generic parent matches on paths that the fallback itself rejects.

The new expression accepts only the three literal route alternatives and one optional final slash. Descendants, double trailing slashes, prefix lookalikes and case variants do not qualify. Existing query/fragment stripping remains unchanged; history and returnTo are not consulted.

The fallback searches only the visible items supplied by the authenticated, tenant-selected Office layout. It returns an original object reference, preserving its existing href, localized label and metadata. An absent Administration item stays absent. No permissions are synthesized or inferred, and a selected item does not authorize settings-page or API access. Existing page guards, resource scopes and tenant headers remain authoritative.

OfficeShell already derives desktop/mobile current markers and the topbar from this shared selector, so no shell or layout change was needed. Existing Operations overview/nested behavior, longest-href precedence, exact Administration descendants, Planning's one-segment `/visits/:id` alias and record-scoped visit ownership remain compatible.

## C. Verification

Final commands below exited 0 unless noted. Commands run at repository root unless another directory is specified. Production build completed before generated-output-dependent checks. Turbo reused unchanged tasks where applicable; integration tasks executed against isolated infrastructure.

| Exact command                                                                                                                   | Final result                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `bun test apps/web/src/lib/office-navigation.test.ts`                                                                           | 8 tests / 158 assertions; pass                                                      |
| `bun test apps/web/scripts/office-navigation.test.ts`                                                                           | 16 tests / 1,066 assertions; pass; includes actual-layout and Goal 12/13 page cases |
| `bun test apps/web/src/lib/office-navigation.test.ts apps/web/scripts/office-navigation.test.ts`                                | 24 tests / 1,224 assertions; pass                                                   |
| `bun run --filter @care/web typecheck`                                                                                          | Pass                                                                                |
| `bun run build`                                                                                                                 | OpenAPI/client generation and 32 tasks; pass                                        |
| `bun run architecture:check`                                                                                                    | 159 existing violations; zero new/resolved entries; baseline unchanged              |
| `bun run architecture:test`                                                                                                     | 15 tests / 33 assertions; pass                                                      |
| `bun run lint`                                                                                                                  | 33 tasks; pass                                                                      |
| `bun run typecheck`                                                                                                             | 33 tasks; pass                                                                      |
| `bun run test`                                                                                                                  | 51 tasks; web 62 tests / 1,831 assertions; pass                                     |
| `bun run test:integration`                                                                                                      | 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80; pass  |
| `bun run i18n:check`                                                                                                            | 3,585 English/German messages; parity and static scan pass                          |
| `bunx oxlint --fix`                                                                                                             | Pass                                                                                |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                                |
| `bun run format:check`                                                                                                          | Pass                                                                                |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                                |
| `graphify update .`                                                                                                             | AST-only; 13,191 nodes / 39,744 edges / 694 communities; no API cost                |

Initial failures, corrected: the first focused typecheck and build exited 1 because the heterogeneous frozen test groups inferred an item type without label, while the new assertion accessed result.label. Giving the frozen Clients test item a label preserved the intended generic shape; typecheck/build then passed. No production change was required for this test typing issue. Recorded in `artifacts/goal-14/initial-failures.json`. No test assertion failed. The OIDC availability probe exited 2 as described below.

### Pure selector, actual layout and compatibility evidence

Pure tests explicitly assert original object identity, href/label retention, frozen groups/items, unchanged inputs, exact paths, optional slash/query/fragment variants, hidden/empty groups, normal owner and parent precedence, negative fallback paths, unchanged Operations overview and Goal 10 visit ownership. Negative fallback cases with a visible parent deliberately continue returning that parent.

The existing process-isolated fixture executes the actual Office layout with synthetic API/session/cookie boundaries and real catalogs. In both locales, each management grant alone yields exactly the existing Management → Administration item before selection. Its corresponding read grant adds only the original owner(s), which win. Tests also verify Billing as Claims parent, mixed groups/order, duplicated/reversed grants, unrelated client.read and no grants. Selection returns an object from those actual groups, without adding anything. All Goal 10–13 coverage remains passing; the server fixture itself did not change.

A broader comparison runs the original and final selectors over **64 actual layout grant combinations × 38 paths = 2,432 cases**. It finds 350 intended fallback changes and 2,082 identical results, with no input mutation or unexpected difference (`selector-comparison.json`). This audit complements the focused tests; its case count is not included in Bun assertion totals. Original generic signature and active predicate were also compared byte-for-byte.

OpenAPI, all 18 generated client files, both catalogs and the architecture baseline remain byte-identical to HEAD, as do Office layout/shell/mobile code and Goal 12/13 settings controls. No backend, API, dependency or permission source changed. The source diff contains only the selector and three specified test files, plus this new handoff.

### Browser command and evidence

From `apps/web`:

```bash
SETTINGS_CONTEXT_BASELINE_BUNDLE=/home/woobb/Projects/care/artifacts/goal-14/before/office-navigation-app.js SETTINGS_CONTEXT_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-14/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal14/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal14/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: **37 pass**: eighteen navigation, six presentation and thirteen form cases. The explicit installed Chromium headless shell avoids the unavailable default browser revision; writable XDG paths are used. No browser dependency was installed.

Before editing production code, the existing builder compiled the actual OfficeShell and original selector into the baseline bundle. The saved selector, commit and SHA-256 provenance are in `artifacts/goal-14/before/`; reproduction shows each settings-only layout already contained Administration but originally selected nothing. Final browser rendering uses the same real shell/mobile components, production stylesheet, actual permission-filtered layout props, catalogs and existing synthetic pathname/Link bridge.

The screenshot matrix contains **108 PNGs and 108 JSON reports**: nine cases × three surfaces × two locales × before/after. Cases are each of the three management-only paths; each corresponding read+management owner; Billing as Claims parent; hidden Administration with client.read; and an unrelated route with visible Administration. Surfaces: expanded/collapsed desktop 1440×900 and mobile drawer at 390×900.

Quantitative comparison: **18 settings-only pairs change as intended; all 36 control pairs are pixel-identical.** There are no changed pixels outside the combined old/new topbar and sidebar/drawer regions. Content, layout and text outside navigation remain unchanged. `screenshot-comparison.json` records every pair and bounds. English expanded desktop and German mobile screenshots were visually inspected.

Every focused render has zero axe violations for WCAG 2 A/AA and WCAG 2.1 AA tags. Assertions check localized context, one current/active item per visible navigation surface, consistent aria-current/data-active, exact server-provided menu hrefs, collapsed accessible names/titles and no horizontal overflow. Dedicated interactions cover all three paths, native Tab focus and visible focus ring, collapse shortcut/cookie persistence through reload, real mobile Sheet focus trapping, Escape/link close behavior and trigger focus restoration. Historical keyboard/drawer/route-precision cases remain passing.

Evidence/log locations: ignored `artifacts/goal-14/logs/`, `screenshots/`, `screenshot-comparison.json`, `selector-comparison.json`, `file-sizes.json`, `before/reproduction.json`, `before/source.json`, `debt-evidence.json` and `initial-failures.json`.

### Authenticated verification limitations

A fresh `.env.test` OIDC discovery probe, with a five-second timeout and no secret logging, returned **Isolated OIDC discovery unavailable**, exit 2 (`logs/oidc.log`). Pure selector and actual-layout tests, browser interactions and pixel/axe results are verified. Full authenticated Office E2E, complete Next.js app hydration and actual settings-destination authorization are not established by those tests and remain unverified. Browser content is synthetic route content inside the actual shell, not the full settings workflow. No production authentication/authorization bypass was added. Passing backend integration does not close these gaps.

## D. Remaining technical debt

1. **The settings-only context mismatch is fixed within the exact requested scope.** The new screenshots and actual-layout selection tests show existing Administration selection on all three routes. Read owners, hidden-item behavior and unrelated routes remain unchanged. No broad settings alias or new visibility rule was introduced.
2. **Billing secondary navigation still gives no current-page indication.** `billing/billing-nav.tsx` renders permission-filtered links with hover styles but no aria-current or selected styles. An actual BillingSettingsPage/BillingNavigation render with billing.read, claims.read and billing.settings.manage yields Overview, worklist, invoices, Claims and settings links with zero current markers (`debt-evidence.json`). Opening `/billing/settings` therefore leaves its secondary Settings link visually indistinguishable as the current page. This is a concrete orientation gap; no WCAG conformance failure is claimed merely from the absence of aria-current.
3. **Billing pathname/hash ambiguity needs a bounded policy.** The Overview and worklist links use `/billing` and `/billing#worklist`; the target `<section id="worklist">` exists in `billing/page.tsx`. Treating both as pathname matches would produce duplicate markers. A current-page indicator can exclude fragment links, retaining worklist as an ordinary in-page jump and Overview as the current page at `/billing`, including when a hash is present. Section-location indication is a separate feature.
4. **Administration secondary current-state indication remains absent.** Actual AdministrationLayout output with members/organization/audit/Billing settings capabilities has six links and zero current markers. Its `/administration/users` and `#invitations-title` links share a pathname; the target exists in users/page.tsx. This remains a separate improvement and is not included in the selected next goal.
5. **Other permission-dependent navigation:** no additional dead end was demonstrated during this focused work. Goal 12 return controls and Goal 13 organization-note gating remain byte-identical and covered. This is not an exhaustive application-wide audit, and selected navigation never establishes access to an owning API or every resource.

## E. Goal 15 preparation

**Select exactly one improvement: current-page indication in Billing secondary navigation.** Keep in-page hash navigation unchanged. This makes the existing current destination recognizable without redesigning navigation or combining Administration work.

1. **Reproduction / consequence:** provide billing.read and billing.settings.manage, open `/billing/settings`. Billing secondary navigation displays its permitted links but none identifies the current page, either visually or through aria-current. Repeat on `/billing/invoices`, `/billing/claims` and settings routes with suitable grants. The rendered evidence confirms zero markers.
2. **Intended behavior:** mark at most one already-visible nonfragment Billing navigation link with aria-current="page" and a subtle existing-token active style. Preserve the existing markup/hrefs/labels/order/layout and hover/focus behavior. No matching visible link means no marker. Do not fabricate an item or change filtering.
3. **Production files:** retain `apps/web/src/app/(office)/billing/billing-nav.tsx` as the server-owned translation/permission boundary. Add a small colocated `billing-nav-links.tsx` client presentation component receiving only already-filtered localized links; use the existing Next pathname hook. Keep any selection logic local to this Billing feature. No generic registry/framework or shared permission-aware link abstraction.
4. **Route/hash policy:** Overview `/billing` matches only that path, allowing one optional trailing slash. Other nonfragment links match exact paths and slash-delimited descendants, with the longest visible href winning, so Claims settings wins over Claims when both are visible. Reject prefix lookalikes. Ignore query strings for current-page ownership. Exclude every href containing a fragment from current-page eligibility: `/billing#worklist` stays an unchanged section jump and never gets aria-current="page". At `/billing#worklist`, Overview remains the one current page. Do not add hash listeners, history patches, returnTo rules or section-location markers. Do not broaden the global primary selector or change Goal 14 behavior.
5. **Permissions / authorization:** the server must still translate and independently filter every link using its existing grant before rendering. Do not send grants for client evaluation. Hidden links must never acquire a marker or become visible. Link selection is presentation only; tenant context, page guards, APIs, resource authorization and forms remain unchanged.
6. **Accessibility / localization:** use existing Billing labels and UI tokens, no catalog keys. Exactly zero or one aria-current="page" within this nav; active state must remain recognizable without relying only on color (for example an existing-token background plus weight/underline). Preserve native link semantics, readable contrast, visible focus, Tab order, mobile wrapping and no overflow. Do not duplicate the primary-navigation current marker inside a different nav scope; each nav may identify its own current item.
7. **Focused tests:** execute the actual BillingNavigation server function to assert unchanged permitted link props/order/labels across no/unrelated/read/payment/Claims/settings and mixed/reordered/duplicate grants in both locales. Test exact/nested/longest-visible matches, Overview precision, unmatched/lookalike routes, hidden links, slash/query behavior and the fragment exclusion policy. Preserve Goal 10–14 tests. No changes to authorization or API tests should be needed.
8. **Browser/screenshots:** mount the actual new client renderer with links emitted by the real server function, inside the existing isolated fixture. Static landingHtml alone cannot prove the new client's pathname updates. Extend `office-navigation.fixture.ts`, `e2e/support/office-navigation-app.tsx`, `build-navigation-test.ts` only as needed and the existing server/browser tests. Compare English/German desktop/mobile before/after for root, worklist hash, invoices/detail, Claims/detail/settings, Billing settings, hidden/unmatched controls and changed pathname transitions. Check marker uniqueness, native hash jump, keyboard/focus, wrapping, contrast/axe and unchanged primary context. Disclose fixture versus full Next/OIDC limits.
9. **Compatibility risks:** accidentally moving permissions/translations client-side, marking both root/hash links, allowing Overview to swallow child routes, changing Claims/settings precedence, showing hidden destinations, or breaking server-page imports. The fixture must mount the actual client component rather than merely inspect SSR HTML. Keep its boundary small and preserve link props.
10. **Exclusions:** Administration secondary navigation, global/primary selector, sidebar/topbar/visibility/hierarchy, Goal 12/13 controls, forms/actions, other links/routes, Caregiver, catalogs, backend, API/client/schema/permissions/dependencies, hash-location indicators and navigation redesign. Do not add a shared route registry or expand the architecture baseline.
11. **Definition of done:** one or zero correct visible Billing current-page markers with agreed fragment policy; server filtering and localized labels unchanged; actual-renderer and server tests plus browser evidence pass; primary navigation and Goal 10–14 remain compatible; all root gates pass with zero new violations; Graphify refreshed; `docs/architecture/goal-15-to-goal-16.md` created. No Goal 16 implementation.

## F. Copy-ready Goal 15 prompt

```text
Goal 15: Current-page indication in Billing secondary navigation

Repository: /home/woobb/Projects/care (woobble/care). Implement this one bounded improvement; no multi-agent mode.

Read AGENTS.md, apps/web/AGENTS.md and installed relevant Next guides, docs/architecture/overview.md, module-boundaries.md and docs/architecture/goal-14-to-goal-15.md. Check git status and preserve unrelated work. Query Graphify first. Reproduce the recorded absence of current markers in actual BillingNavigation output.

Keep apps/web/src/app/(office)/billing/billing-nav.tsx server-owned for translations and the exact existing permission filtering. Add a small colocated billing-nav-links.tsx client presentation component receiving only permitted localized links and using the existing Next pathname hook. Keep logic local to Billing; no generic registry/framework, new permission input or client permission evaluation.

Mark at most one already-visible nonfragment link with aria-current="page" and subtle existing-token active styling that is not color-only. Preserve links, hrefs, labels, order, layout, native semantics, hover/focus behavior and server callers. Hidden/unmatched destinations receive no marker.

Matching: Overview /billing matches only that path with an optional single trailing slash. Other nonfragment links use exact or slash-delimited descendants and longest-visible-href precedence; Claims settings must win over Claims when both are visible. Reject prefix lookalikes and ignore query strings. Exclude hrefs containing fragments from current-page eligibility: /billing#worklist remains an ordinary in-page jump and never gets aria-current="page". On /billing#worklist, Overview remains current. Do not add hash listeners, history patches, section-location indicators or returnTo heuristics.

Do not alter server permission filtering, tenant context, page/API authorization, Administration navigation, primary selector/shell/sidebar/topbar, Goal 12/13 controls, forms/actions, other routes/links, Caregiver, catalogs, APIs/generated clients, backend, schema/migrations or dependencies. Preserve Goal 14 and all earlier matching/visibility behavior. Do not expand the architecture baseline.

Extend actual BillingNavigation server-function tests for unchanged filtered link props/order/labels across relevant grant combinations, mixed/duplicate/reordered grants and both locales. Cover exact/nested/longest matches, root precision, hidden/unmatched/lookalike paths, slash/query handling and fragment exclusion. Retain Goal 10–14 tests.

Extend the existing isolated browser fixture to mount the actual client renderer with the real server-produced link props; static SSR landingHtml alone is insufficient. Reuse office-navigation fixture/app/builder/tests with minimal changes. Capture English/German desktop/mobile before/after evidence for root, worklist hash, invoices/detail, Claims/detail/settings, Billing settings and hidden/unmatched controls. Test pathname transitions, unique aria-current, native fragment jump, keyboard/focus, wrapping/overflow, axe and unchanged primary context. Use synthetic data and disclose full Next hydration/OIDC/authenticated E2E and actual authorization gaps; probe isolated OIDC without logging secrets or changing authentication.

Follow AGENTS.md formatting (oxlint --fix, then configured oxfmt). Build before generated-output-dependent checks. Run focused tests and relevant full isolated suites plus bun run build, architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, format:check and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new architecture violations and no excluded backend/generated/catalog/dependency/permission changes.

Create docs/architecture/goal-15-to-goal-16.md with status/duration, implementation/matching/permission decisions, changed files and before/after sizes, exact commands/counts/failures, screenshot/accessibility evidence and authenticated gaps. Reassess remaining debt from evidence, select exactly one small confirmed next improvement and provide a standalone Goal 16 prompt requiring docs/architecture/goal-16-to-goal-17.md. Do not implement Goal 16 or Goal 17.

Final response: status/duration, exact implementation, matching and permission matrix, file changes/sizes, focused/full tests, browser/screenshots, accessibility/localization, authenticated gaps, handoff path and copy-ready next prompt.
```
