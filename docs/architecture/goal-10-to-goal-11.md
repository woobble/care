# Goal 10 → Goal 11 handoff

## A. Goal 10 summary

**Status: Complete.** Permission-visible Planning now owns direct Office visit-detail context. All required gates and 25 isolated browser tests pass. Authenticated Office E2E and actual Next intercepted visit-modal navigation remain unverified because isolated OIDC discovery is unavailable. Goal 11 and Goal 12 are preparation only.

Production changes:

- `apps/web/src/lib/office-navigation.ts`: small pure selector extracted from the shell. It selects only from already-visible items, retaining existing matching and longest-href precedence, with one new exact visit-detail ownership rule.
- `apps/web/src/components/office-shell.tsx`: its existing useMemo delegates to that selector. The local matcher moves to the helper. All rendering, selected styles/indicators, labels, hooks, state, persistence, keyboard handlers and mobile integration remain unchanged.

The route-only path is matched against `^/visits/[^/]+/?$` for the existing item with ID planning. Exactly one nonempty dynamic segment is accepted, plus an optional canonical trailing slash. `/visits`, `/visits/`, extra segments, lookalike prefixes and Caregiver paths are not claimed. IDs are not given a new frontend UUID restriction: App Router's `[id]` is a segment and existing server/API validation remains authoritative. Query/fragment suffixes do not affect ownership; normal usePathname callers already provide a pathname.

Office layout still filters Planning with schedule.read before constructing groups. The helper never creates items, changes hrefs or derives a Planning label independently. With Planning absent, direct visits remain unmatched and use the existing Overview fallback. Desktop expanded/collapsed navigation, mobile NavigationGroups and topbar still consume the one selected item.

Created test/evidence files:

- `src/lib/office-navigation.test.ts`: pure selection, precision, permission-visible input, precedence and ordering regressions.
- `scripts/office-navigation.fixture.ts`: executes the actual server Office layout with synthetic request/grant boundaries and returns the real filtered groups/labels as JSON.
- `scripts/office-navigation.test.ts`: localized layout/filtering/selection tests using that actual layout.
- `e2e/support/office-navigation-app.tsx`: mounts the actual OfficeShell with real next-intl catalogs and synthetic content.
- `scripts/build-navigation-test.ts`: uses existing Bun tooling to bundle the fixture; mocks only pathname/link transport and unrelated account/language/theme/progress controls. Actual Next dynamic loading, OfficeMobileNavigation, Radix Sheet and shared UI run in the browser.
- `e2e/office-navigation.spec.ts`: six localized browser cases covering screenshot scenarios, desktop persistence/transitions and real drawer interactions.
- This handoff.

Updated web package scripts include the pure test file and a test:navigation command. The existing isolated Playwright config discovers the new file; existing form/presentation commands retain their explicit file selections. No dependencies or generic navigation framework were added.

Goal 09 work was already staged when Goal 10 started; it was preserved and subsequently appeared committed in the authoritative repository state. Goal 10 did not stage, commit or rewrite that work. Starting worktree snapshots in `/tmp/care-goal10/` establish the relevant before sizes:

| File                       | Before lines / bytes | After lines / bytes |
| -------------------------- | -------------------: | ------------------: |
| OfficeShell                |         515 / 20,061 |        508 / 19,673 |
| Navigation helper          |                    — |          21 / 1,006 |
| Pure selection tests       |                    — |          94 / 3,299 |
| Layout fixture             |                    — |          60 / 2,316 |
| Layout tests               |                    — |          79 / 2,551 |
| Browser fixture            |                    — |          41 / 1,241 |
| Fixture builder            |                    — |          43 / 2,373 |
| Browser tests              |                    — |        307 / 11,946 |
| Web package manifest       |           50 / 1,639 |          51 / 1,777 |
| Isolated Playwright config |             15 / 485 |            15 / 514 |

No route, hierarchy, permission, catalog, Caregiver, scheduling, visit-detail, return-link, modal, API, database or theme changes.

## B. Architectural decisions

The helper takes structurally typed groups/items and returns the original matching item, including its localized label. It has no imports, server dependencies, permission policy, route registry or copied navigation hierarchy. Flatten/filter/sort still operate on a fresh array and preserve existing longest-href precedence and stable order. It is a testable extraction of the existing selection responsibility, not a navigation framework.

The previous exact Overview rule and nested Operations rule are retained. Other item descendants still match by slash-delimited prefix. More-specific destinations such as Claims win over Billing. Record-scoped URLs such as `/clients/:id/visits` continue to belong to Clients. Only the exact global `/visits/:id` shape receives the Planning alias. A hidden Planning entry is never synthesized.

The shell continues to supply activeItem.id to the existing NavigationGroups and activeItem.label to the existing topbar. No matcher was added to OfficeMobileNavigation. The sidebar cookie, Ctrl/Meta+B implementation, lazy Sheet, focus restoration, selected-state attributes, tooltip/accessibility labels, icon and layout classes are unchanged.

The route/interception files, VisitDetailContent, VisitDetailSheet and safePlanningReturnTo remain byte-identical. The new helper reads route context without changing links, router calls, returnTo values, background route state, redirects or API requests. That source compatibility is verified; actual authenticated interception is not claimed from the synthetic history tests.

## C. Verification results

| Exact command                                                                                                                   | Result                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bun test apps/web/src/lib/office-navigation.test.ts` before the new matching rule                                              | Characterization pass: three tests / 22 assertions, including the original unmatched visit behavior |
| `bun test apps/web/src/lib/office-navigation.test.ts apps/web/scripts/office-navigation.test.ts`                                | Final pass: seven tests / 56 assertions                                                             |
| `bun run architecture:check`                                                                                                    | Pass: 159 existing violations; zero new or resolved baseline entries                                |
| `bun run architecture:test`                                                                                                     | Pass: 15 tests / 33 assertions                                                                      |
| `bun run lint`                                                                                                                  | Pass: 33 tasks                                                                                      |
| `bun run typecheck`                                                                                                             | Pass: 33 tasks                                                                                      |
| `bun run test`                                                                                                                  | Pass: 51 tasks; web 45 tests / 663 assertions                                                       |
| `bun run test:integration`                                                                                                      | Pass: 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80                  |
| `bun run i18n:check`                                                                                                            | Pass: 3,585 English/German keys; static scan passes                                                 |
| `bun run build`                                                                                                                 | Pass: OpenAPI generation and 32 build tasks                                                         |
| `bun run format:check`                                                                                                          | Pass                                                                                                |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                                                |
| `bunx oxlint --fix`                                                                                                             | Pass                                                                                                |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                                                |
| `bun run --filter @care/web typecheck`                                                                                          | Pass                                                                                                |
| `graphify update .`                                                                                                             | Pass: AST-only; 13,134 nodes / 39,681 edges / 693 communities; zero API cost                        |

Exact browser commands:

```bash
NAVIGATION_BASELINE_BUNDLE=/tmp/care-goal10/before/office-navigation-app.js NAVIGATION_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-10 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/tmp/care-goal10/config XDG_CACHE_HOME=/tmp/care-goal10/cache bun run --filter @care/web test:navigation
```

Result: all six navigation browser cases pass. The complete existing isolated configuration was also run from apps/web:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/tmp/care-goal10/config XDG_CACHE_HOME=/tmp/care-goal10/cache bunx playwright test --config=playwright.forms.config.ts
```

Result: all **25 tests pass**: six navigation, six presentation and thirteen form cases. The second run checks current behavior without the optional baseline bundle. Generation-dependent gates were run after the production build; unchanged tasks use Turbo cache as applicable.

### Unit and component coverage

Existing exact/nested/Operations/Claims behavior was characterized before adding the alias. Final tests cover exact Planning and descendants, visit IDs/query/fragment/trailing slash, non-detail/lookalike/Caregiver paths, record ownership, longest-match behavior independent of item order, empty/hidden Planning input and nonmutation of groups. A negative test initially expected a Client visit subpage to be unmatched; it was corrected to preserve its actual Clients owner, with no production change.

Layout tests execute real Office layout permission filtering in English/German. They prove schedule.read adds Planning, its absence removes Planning without a synthetic label, group/item ordering is unchanged even if grant order changes, and Claims specificity and existing labels remain intact. Request/auth/cookie boundaries are synthetic; these are not authorization integration tests.

### Browser, screenshots and accessibility

A baseline browser bundle was saved after extracting the original matcher unchanged and before adding the visit rule. The same production stylesheet and synthetic layout props were used for both versions. Evidence is in ignored local **`artifacts/goal-10/`**:

- 36 PNGs and 36 JSON scenario reports across both locales.
- Visit expanded/collapsed desktop at 1440px, collapsed tablet at 768px and open mobile drawer at 390px.
- Planning, Client detail and Claims detail controls; hidden-Planning direct visits on desktop/mobile.
- Ten control/hidden-Planning before/after pairs are byte-identical by SHA-256. Only the eight visible-Planning visit pairs differ, showing the intended selected link/indicator/context label.
- Each tested navigation surface has exactly one current link when an item matches, with data-active=true and aria-current=page. Hidden Planning has no link and retains Overview/Übersicht context.
- Collapsed Planning retains its localized aria-label/title. Keyboard collapse updates the existing cookie; a new document/mount reads that cookie through the actual server layout and preserves collapsed state.
- Real mobile Sheet opens lazily, traps focus, closes via Escape and link activation, restores trigger focus, and closes on desktop resize with focus on page context.
- Synthetic URL transitions and browser back/forward keep consistent context for Planning, Claims, Operations and visits. These use a mocked Link/pathname bridge, not Next interception transport.
- All screenshot-state full-fixture axe scans report zero violations; tested layouts fit the viewport. Checks include current-page semantics, accessible names, focus interaction and rendered contrast.

Representative screenshots:

- `artifacts/goal-10/en-visit-expanded-1440-before.png`
- `artifacts/goal-10/en-visit-expanded-1440-after.png`
- `artifacts/goal-10/de-visit-mobile-390-before.png`
- `artifacts/goal-10/de-visit-mobile-390-after.png`
- `artifacts/goal-10/en-hidden-desktop-1440-after.png`

The fixture runs actual OfficeShell, selector, Next dynamic import, OfficeMobileNavigation and Radix Sheet. It substitutes pathname/Link transport, request/auth boundaries, content and unrelated topbar controls. It proves the scoped client interaction and rendering behavior, not full Next RSC hydration, authenticated authorization, account/theme controls, calendar links or actual visit modal interception.

A bounded read-only `.env.test` OIDC discovery probe returned no response. Full authenticated Office E2E and actual direct/intercepted visit-modal navigation were **not run and remain unverified**. No authentication bypass or real employee/client/tenant data was used. Source preservation and the production build provide compatibility evidence but do not replace that missing runtime check.

Additional read-only audit (`bun /tmp/care-goal10/verify-compatibility.ts`): restoring only the original active-item expression makes the entire OfficeShell AST match; SidebarBrand/NavigationGroups match unchanged. All 3,840 combinations of 15 legacy/control paths and 256 item-visibility sets preserve previous selection. App Router files, visit return/interception code, server layout, mobile drawer, catalogs, backend/OpenAPI/generated clients and architecture baseline remain unchanged.

Temporary commands/logs/snapshots are under `/tmp/care-goal10/`. A virtual fixture module initially needed an explicit React import resolution and was corrected in test tooling. Graphify uses aggregated HTML for the >5,000-node graph; 123 changed communities received hub-derived fallback labels. Semantic doc extraction/relabeling remains outside the requested AST-only refresh.

## D. Remaining technical debt

Confirmed source-level findings, not Goal 10 gaps:

- Office layout's Administration visibility list omits three permissions already used by Administration landing links: billing.settings.manage, claims.settings.manage and operations.reminder_settings.manage. With any one as the only grant, the actual layout fixture returns no navigation groups, while the actual Administration page renders the corresponding settings link. This is the focused Goal 11 candidate below.
- Nested settings pages use their existing path owner when visible (Billing, Claims or Operations). If those owner items are absent, topbar context can still fall back to Overview. Fixing settings-only parent discoverability does not by itself resolve every contextual-label question; that is separate from Goal 10's visit ownership.
- Office topbar is a selected owner label, not a full breadcrumb. Route-owned PageHeader eyebrow/back links still supply detail context. A complete breadcrumb system is not justified by this pilot.
- Collapsed sidebar uses icon tooltips/labels, while mobile exposes group labels and a Sheet. Discoverability preferences or possible group ambiguity have not been established through a usability study.
- Caregiver Today/Calendar links use a different shell and do not share the Office matcher; no new Caregiver issue or scope is inferred.
- Actual authenticated modal interception, full shell hydration, production account/theme behavior and screen-reader use remain unverified here. The synthetic drawer/axe evidence is narrower.

No assertion is made that missing return links, a general mobile defect or other active-state failures exist without additional route-specific evidence.

## E. Goal 11 preparation

After implementing Goal 10, inspected the current Office layout/topbar/matcher, server permission visibility, real mobile navigation, Planning/detail return policy, Administration landing links, settings pages, labels and browser fixtures.

### Specific user-facing problem

Users whose only relevant administration capability is one of the three settings-management permissions cannot discover the existing Administration landing page through Office navigation, even though that page already offers their settings destination. The server shell's visibility list and the landing page's existing allowed links disagree.

Concrete evidence:

| Existing permission                 | Existing Administration link    | Settings page capability check                                                                          |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| billing.settings.manage             | `/billing/settings`             | `app/(office)/billing/settings/page.tsx` uses the same permission                                       |
| claims.settings.manage              | `/billing/claims/settings`      | `app/(office)/billing/claims/settings/page.tsx` uses the same permission                                |
| operations.reminder_settings.manage | `/operations/reminder-settings` | `app/(office)/operations/reminder-settings/page.tsx` checks the same permission before loading settings |

`app/(office)/layout.tsx` has the narrower administrationLinks list and canReadAdministration calculation. `app/(office)/administration/page.tsx` has the existing broader links array and independently filters by permissions. Read-only fixture execution with each isolated grant returned groups=[]; read-only rendering of the real Administration page confirmed each corresponding href. This proves a presentation discoverability mismatch, not that every settings API operation succeeds without additional scoped grants.

### Recommended exact first scope

Align the existing Administration navigation entry's visibility with these **three already-supported settings permissions**. Add only those capabilities to the server-side Administration visibility decision. Keep its label, `/administration` destination, group position, existing gates and landing-page link filtering unchanged. No new grants or backend authorization should be added.

Current behavior: settings-only input yields no Administration nav entry. Desired behavior: the same input yields the existing Management → Administration entry, allowing the user to reach the landing page's already-visible settings card. Empty/unrelated grants still reveal nothing. Existing administration grants retain their current behavior and ordering.

Affected production scope should be `app/(office)/layout.tsx` only, unless actual evidence requires a narrowly justified supporting change. Reuse existing matching/shell/mobile/PageHeader patterns and translations. No new shared registry or generalized navigation abstraction is needed to add three existing capabilities.

### Constraints and acceptance

1. **Dependencies/permissions:** use the already authenticated server-fetched grants; do not trust request-posted permissions. Existing destination pages and backend authorization remain authoritative. Do not synthesize Billing/Claims/Operations read grants or expose unrelated administration destinations.
2. **Desktop/mobile:** the existing filtered group feeds both surfaces. Settings-only users gain the existing Administration link; existing users keep item order, active styles, collapsed labels, Sheet interaction and focus restoration.
3. **Visual/localization:** reuse current Administration/Management labels in English/German, without catalogs, icons, spacing, widths or theme changes. At `/administration`, current context follows the existing Administration item naturally.
4. **Tests:** execute the actual Office layout with each of the three permissions alone, combinations, existing administrator-like grants, unrelated grants and no grants. Check exactly one Administration item, no extra privileged items, existing ordering and unchanged localized labels. Render the Administration landing page to verify its existing link filtering remains consistent. Retain all Goal 10 route-selection tests.
5. **Browser/evidence:** compare before/after desktop expanded/collapsed and mobile states for settings-only versus empty/read-only grants in both locales. Check keyboard access, link destination, context at `/administration`, drawer close/focus, overflow and axe. Use the existing synthetic fixtures when OIDC is unavailable; report authenticated app/settings-operation gaps separately.
6. **Exclusions:** new permission definitions/grants, backend/API changes, settings form behavior, new routes/nav items, global hierarchy, settings-page owner aliases, breadcrumbs, Caregiver shell, account/theme behavior, calendar/interception changes and Goal 12 implementation.
7. **Definition of done:** the three existing settings capabilities each expose only the existing Administration entry as intended; no/unrelated grants still hide it; existing visibility and hierarchy remain unchanged; relevant localized unit/browser gates pass; exact verification/limitations are recorded; Graphify and the mandatory next handoff are complete.

The measurable benefit is one previously missing but already-authorized navigation entry for each supported settings-only permission scenario. Broader grouping changes require separate evidence.

## F. Copy-ready Goal 11 prompt

> Implement Goal 11 in woobble/care: make the existing Administration navigation entry discoverable for users with existing settings-management capabilities. Read docs/architecture/goal-10-to-goal-11.md, architecture overview/module boundaries, frontend i18n docs, applicable AGENTS.md and relevant installed Next.js guides. Inspect current worktree/Graphify, Office layout and shell, Administration landing links, the three settings destinations and actual permission/API boundaries. Preserve unrelated changes; no multi-agent mode.
>
> Narrowly align app/(office)/layout.tsx's Administration visibility decision with the already-supported billing.settings.manage, claims.settings.manage and operations.reminder_settings.manage permissions. Each capability alone should expose the existing Management → Administration item at `/administration`; empty/unrelated grants must still hide it. Retain all existing gates, item/group ordering, labels, destinations and landing-page link filtering. Do not grant permissions, expose unrelated links, change backend authorization or assume settings API operations need no additional scopes.
>
> Reuse existing desktop/mobile shell, selected-item derivation, collapsed labels, cookie/shortcut, Sheet close/focus and English/German labels. No new navigation registry/library/framework, route, catalog, hierarchy or design change. Leave settings forms/API contracts, owner aliases/breadcrumbs, Planning/visit context/interception, Caregiver navigation and Goal 12 outside scope.
>
> Add meaningful tests executing the actual Office layout and Administration landing page with each new visibility case, combinations, existing grants, unrelated grants and no grants. Verify only permitted destinations appear, exactly one Administration link is produced and existing ordering/localization remain intact. Retain Goal 10 selection tests. Capture before/after expanded/collapsed desktop and mobile contexts, checking keyboard/focus, route destination, overflow and axe in both locales. Use existing synthetic fixtures when isolated OIDC is unavailable and clearly distinguish them from authenticated application/settings-operation verification; no production data or authentication bypass.
>
> Run architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, build, format:check, strict oxlint and relevant isolated/authenticated browser checks where available. Sequence API-client generation safely. Refresh Graphify. Create mandatory docs/architecture/goal-11-to-goal-12.md with status/files/sizes, architectural/permission decisions, exact results and gaps, remaining navigation debt and a focused evidence-based Goal 12 plan and copy-ready prompt. Do not implement Goal 12. Complete the implementation and handoff and report precise evidence and limitations.
