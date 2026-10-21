# Goal 15 → Goal 16 handoff

## A. Implementation summary

**Goal 15: Complete.** Active duration: approximately 13 minutes including verification and this handoff. Billing secondary navigation now identifies exactly one best matching visible nonfragment destination, or none. Server translation/filtering remain intact. All required gates and 41 isolated browser tests pass. Authenticated Office E2E, full Next hydration and actual destination authorization remain unverified because isolated OIDC discovery is unavailable. Goal 16 is preparation only.

Production scope is two colocated files:

- `billing/billing-nav.tsx` remains an async server component. Its original link definitions, getTranslations('Billing'), nav label/container and hasPermission filter remain unchanged. It projects the filtered entries to `{ href, label }`, combining the existing optional fragment into the href, and passes only those pairs to its client child.
- New `billing/billing-nav-links.tsx` contains the small client renderer and local pure index selector. It uses usePathname directly, with no state/effect. Nonfragment exact/slash-descendant matches compete by href length; Overview matches only `/billing` and `/billing/`. Fragment hrefs never compete. The first equal-specificity candidate wins. A single selected index guarantees at most one aria-current="page", including repeated object references. It never mutates input links.

The selected link adds existing-token background/foreground and underline/underline-offset styling. Font weight, padding, minimum height, order, dimensions, wrapping, hover classes, hrefs and labels are preserved. Underline supplies a noncolor cue; native focus remains independent. The server nav and the client-rendered anchors have no new DOM wrapper in production.

| Situation                                                  | Billing secondary result                            |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `/billing`, `/billing/`, including query/fragment suffixes | Visible Overview only                               |
| Visible nonfragment exact/descendant matches               | Longest visible href                                |
| Claims Settings visible with Claims                        | Claims Settings wins on its route/descendants       |
| Claims Settings hidden, Claims visible                     | Visible Claims parent                               |
| Child and parent hidden; only Billing Overview visible     | No item; Overview does not own descendants          |
| Empty, unrelated, lookalike or case-mismatched route       | No item                                             |
| `/billing#worklist`                                        | Ordinary worklist jump; Overview current if visible |
| Equal-specificity candidates                               | First eligible index only                           |

Before/after sizes against starting commit `5b70e297e184a7fe126c029641ee6153ebf1bc92`, in newline-delimited lines / UTF-8 bytes:

| File                                                      |         Before |          After |
| --------------------------------------------------------- | -------------: | -------------: |
| `apps/web/src/app/(office)/billing/billing-nav.tsx`       |     64 / 1,938 |     59 / 1,779 |
| `apps/web/src/app/(office)/billing/billing-nav-links.tsx` |            New |     45 / 1,417 |
| `apps/web/scripts/billing-navigation.test.ts`             |            New |     84 / 3,645 |
| `apps/web/scripts/office-navigation.test.ts`              |   630 / 24,076 |   714 / 27,671 |
| `apps/web/scripts/office-navigation.fixture.ts`           |    261 / 9,993 |   287 / 11,001 |
| `apps/web/scripts/build-navigation-test.ts`               |     43 / 2,373 |     43 / 2,402 |
| `apps/web/e2e/support/office-navigation-app.tsx`          |     48 / 1,488 |     74 / 2,521 |
| `apps/web/e2e/office-navigation.spec.ts`                  | 1,082 / 43,416 | 1,320 / 53,732 |
| `docs/architecture/goal-15-to-goal-16.md`                 |            New |   165 / 30,210 |

The pure client tests exercise the actual selector; existing server tests/fixture execute the real BillingNavigation and inspect serialized client props plus rendered HTML. The browser fixture mounts the real new renderer from server-produced links, with original server HTML used only for the before baseline. The existing Link bridge now delegates fragment hrefs to native browser navigation so the hash jump is tested without a fake scroll implementation. This is test-only; production Next Link behavior is unchanged. No production compatibility exception or scope deviation was required. All eleven production BillingNavigation consumers remain unchanged.

Office primary matching/shell, Administration, Goal 12/13 controls, settings forms/actions, tenant scope, permissions, APIs, generated clients, catalogs, dependencies and backend files remain unchanged. Existing Goal 10–14 tests are retained. Ignored visual/audit artifacts and Graphify output were refreshed.

## B. Architecture and permissions

The server continues owning translations and each independent permission gate: billing.read, billing.payments.read, claims.read, claims.settings.manage and billing.settings.manage. A management grant does not imply a read grant. Client props contain only an array of href/label pairs—no permission names, session values or tenant context. The localized nav name and container stay in the server-rendered nav.

The client derives selection from its current pathname and the already-permitted list. It cannot reconstruct hidden destinations. The local linear selector returns an index, updating only for strictly longer eligible hrefs; equal matches retain the first candidate, guaranteeing zero or one current marker. Overview has a deliberately narrow match so it cannot swallow Billing descendants. Other links use case-sensitive slash boundaries, not arbitrary string prefixes. Defensive query/fragment stripping does not add hash-aware behavior.

The worklist link represents an in-page location, not a separate current page. Its existing `/billing#worklist` href remains intact, never receives aria-current="page", and retains native anchor navigation. Overview remains current on the Billing root regardless of fragment. There are no hash listeners, history patches or route registries in production.

Selected styling is presentation state, not authorization. Page guards, API enforcement, tenant headers and resource scopes remain independent. No API call or permission lookup was added. The eleven existing consumers—including the client-scoped invoice page—keep their server contracts; unmatched client-scoped paths intentionally receive no Billing secondary marker under this bounded policy. Global Clients/Office ownership is unchanged.

## C. Verification

All final commands below exited 0. Commands run from repository root unless stated otherwise. Build completed before generated-output-dependent checks. Turbo reused unchanged tasks where applicable; integration tasks executed against isolated infrastructure. No test or gate failed during this implementation. The OIDC availability probe exited 2, documented separately.

| Exact command                                                                                                                                | Result                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun test apps/web/scripts/billing-navigation.test.ts`                                                                                       | 3 tests / 75 assertions; pass                                                      |
| `bun test apps/web/scripts/office-navigation.test.ts`                                                                                        | 18 tests / 1,526 assertions; pass                                                  |
| `bun test apps/web/scripts/billing-navigation.test.ts apps/web/scripts/office-navigation.test.ts apps/web/src/lib/office-navigation.test.ts` | 29 tests / 1,759 assertions; pass                                                  |
| `bun run --filter @care/web typecheck`                                                                                                       | Pass                                                                               |
| `bun run build`                                                                                                                              | OpenAPI/client generation and 32 tasks; pass                                       |
| `bun run architecture:check`                                                                                                                 | 159 existing violations; zero new/resolved baseline entries                        |
| `bun run architecture:test`                                                                                                                  | 15 tests / 33 assertions; pass                                                     |
| `bun run lint`                                                                                                                               | 33 tasks; pass                                                                     |
| `bun run typecheck`                                                                                                                          | 33 tasks; pass                                                                     |
| `bun run test`                                                                                                                               | 51 tasks; web 67 tests / 2,366 assertions; pass                                    |
| `bun run test:integration`                                                                                                                   | 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80; pass |
| `bun run i18n:check`                                                                                                                         | 3,585 English/German messages; parity/static scan pass                             |
| `bunx oxlint --fix`                                                                                                                          | Pass                                                                               |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'`              | Pass                                                                               |
| `bun run format:check`                                                                                                                       | Pass                                                                               |
| `bunx oxlint --deny-warnings --format=agent`                                                                                                 | Pass                                                                               |
| `graphify update .`                                                                                                                          | AST-only; 13,212 nodes / 39,776 edges / 694 communities; no API cost               |

### Server filtering and client matching

The process-isolated fixture executes the actual BillingNavigation with synthetic grants and real catalogs. Tests cover all 32 subsets of the five relevant capabilities in both locales, individual gates, no/unrelated grants, mixed/duplicate/reordered grants, exact hrefs, labels, order, nav name/container and zero navigation API requests. They assert the actual client component type and that its sole prop is links. Settings-only users receive only their independently permitted destinations.

Before the production edit, 64 original server renders were saved, one for every subset/locale. Repeating them after implementation produces **64 identical permitted-link lists, nav labels/containers and unselected HTML strings** (`server-comparison.json`). The old link-definition AST is identical (`logs/scope-audit.log`). Baseline commit/source hash and original source are saved under `before/`. These checks establish compatibility without hand-copying original permission filtering into production.

Pure tests exercise the real local client selector: Overview exact/slash/query/fragment behavior, fragment exclusion, every destination, descendants, longest specificity independent of order, hidden child/visible parent, hidden parent/child, empty lists, negatives, stable ties and frozen-input nonmutation. Browser tests exercise the actual client renderer's current markers and live pathname/prop updates, rather than relying only on SSR HTML.

All 21 OpenAPI/generated-client/catalog files and the architecture baseline remain byte-identical to HEAD. Primary selector/shell/mobile code, Administration layout, Goal 12 headers, Goal 13 note and every existing consumer remain unchanged. No backend/API/permission/dependency changes or architecture-baseline expansion occurred.

### Browser command, screenshots and accessibility

From `apps/web`:

```bash
BILLING_NAV_BASELINE_DIR=/home/woobb/Projects/care/artifacts/goal-15/before BILLING_NAV_SCREENSHOTS_DIR=/home/woobb/Projects/care/artifacts/goal-15/screenshots PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/home/woobb/.cache/codex-tmp/care-goal15/config XDG_CACHE_HOME=/home/woobb/.cache/codex-tmp/care-goal15/cache bunx playwright test --config=playwright.forms.config.ts
```

**41 tests pass:** twenty-two navigation, six presentation and thirteen form cases. The explicitly supplied installed Chromium headless shell avoids the unavailable default Playwright browser revision; writable XDG directories are used. No dependency was installed.

The new screenshots contain **88 PNGs and 88 JSON reports**: eleven route/permission cases × desktop 1440×900/mobile 390×900 × English/German × before/after. Cases: Overview, worklist fragment, nested invoice, receivables, payments, Claims, Claims Settings, Billing Settings, hidden child with visible Claims, hidden parent/child with Billing read only, and an unmatched route. Before renders use actual original server HTML; after renders mount the real client component inside the same real OfficeShell and server nav container.

Quantitative results: **36 pairs show intended active styling; all eight no-match controls are pixel-identical.** Every link bounding box, href, label, order and primary-context text is identical before/after. Selected styling changes no target dimensions or wrapping. Seventeen changed pairs also contain one pixel immediately left of the strict nav box, with RGB 246/248/250 → 245/247/249, consistent with rounded-background antialiasing. This raw boundary difference is explicitly retained in `screenshot-comparison.json`; every difference fits inside the nav plus a one-pixel paint boundary. There are no other outside-region changes. English desktop and German mobile after screenshots were visually inspected.

All 88 focused renders have zero axe violations for WCAG 2 A/AA and WCAG 2.1 AA tags. Tests verify exactly zero or one current link, accessible names, noncolor underline plus background, fragment exclusion, target heights of at least 40 px, unchanged geometry and no horizontal overflow. Live tests verify pathname changes without reload, hidden-link removal, no synthetic item reconstruction, no-match state, native Tab ordering, visible focus independent of current state, and the native worklist URL/scroll jump with Overview still current. Existing primary, drawer, shortcut, cookie, permission and Goal 10–14 behavior remains passing.

Evidence is under ignored `artifacts/goal-15/`: `logs/`, `screenshots/`, `screenshot-comparison.json`, `server-comparison.json`, `file-sizes.json`, `before/` and `debt-evidence.json`.

### Verification boundaries

A fresh `.env.test` discovery probe with a five-second timeout reported **Isolated OIDC discovery unavailable**, exit 2 (`logs/oidc.log`), without logging secrets. Actual server translation/filtering, client matching, isolated browser transitions, screenshots and axe are verified. Permissions/API/session transport remain synthetic. The pathname and nonfragment Link routing use the existing test bridge. Fragment anchors delegate to browser defaults against a synthetic section target. This proves the fixture's native jump, not full Next Link/prefetch/hydration behavior in an authenticated deployment.

Legacy settings fixtures still inspect static server-rendered subtrees; the new Billing cases explicitly mount the real client renderer. Full hydrated Next application behavior, authenticated Office E2E, actual destination authorization and real save/API workflows remain unverified. No production authentication bypass was added. Passing backend integration does not substitute for these missing authenticated checks.

## D. Reassessed technical debt

1. **Billing current-page indication is implemented under the agreed policy.** Hash links intentionally remain ordinary location jumps; this is not unfinished hash selection. The eleven consumers retain their contracts. Client-scoped invoice paths have no matching Billing href and intentionally show no Billing secondary marker; no additional alias is proposed without a separately agreed route-ownership requirement.
2. **Administration secondary navigation remains unmarked.** Actual AdministrationLayout renders in both locales, with all relevant grants, contain twelve links in three groups and zero current markers (`debt-evidence.json`). On `/administration/users` or an organization detail page, the existing secondary navigation does not visually or semantically identify the owning destination. This is an observed orientation gap; absence of aria-current alone is not claimed to be a WCAG failure.
3. **Administration differs structurally from Billing.** Access/Organization/Configuration headings are localized on the server; Overview is always included in Access, while other links/groups are independently filtered. Users and Invitations share `/administration/users`; the latter is a fragment jump to the existing h2 id `invitations-title` in users/page.tsx. Configuration contains document templates and three cross-route settings links under Billing/Operations. AdministrationLayout mounts only within the Administration segment; do not add it to Billing/Operations pages merely to display a marker there.
4. **Hash policy must be explicit for Administration.** A current-page feature can keep Users current on `/administration/users#invitations-title`, with Invitations remaining a native in-page jump. Do not mark both as current page or silently introduce a hash-location feature. This requires inspecting its own groups/target, not automatically copying Billing assumptions.
5. **Other navigation/permission issues:** no additional defect was demonstrated during this focused goal. Goal 14 primary context fallback and Goal 12/13 permission-aware controls remain unchanged and passing. No exhaustive application-wide discoverability audit or actual destination authorization proof is claimed.

## E. Goal 16 preparation

**Select exactly one next improvement: accurate current-page indication in Administration secondary navigation.** Keep its existing grouping and fragment jumps. Do not combine it with Billing/global navigation changes.

1. **User-facing problem / reproduction:** select a tenant with tenant.members.read or organization.read, open `/administration/users` or `/administration/organizations/:id`. The corresponding visible secondary link has the same unselected appearance and no current-page marker. Source and both-locale actual layout renders confirm this.
2. **Intended behavior:** zero or one already-visible nonfragment link identifies the current pathname using aria-current="page" and existing-token background/underline styling, with geometry, labels, grouping and navigation behavior preserved. Empty/no-match cases have no marker; hidden links never reappear.
3. **Production scope:** `apps/web/src/app/(office)/administration/layout.tsx` plus a small colocated `administration-nav-links.tsx` client presentation component. Keep the layout server-owned for grant retrieval, translations and exact visibility/group decisions. Pass only serialized permitted group keys/labels and href/label pairs; no permissions, session or tenant context. Retain server nav/container and child-page placement. Keep selection local, with no shared generic navigation framework.
4. **Different structure to preserve:** the Access group always contains Overview; its other links require their existing grants. Organization/Configuration groups disappear when empty. Retain the three localized headings, section order, link order, grid/breakpoints and current destinations. Configuration settings destinations remain cross-route links; do not mount Administration navigation outside its existing segment.
5. **Route/hash policy:** Overview `/administration` owns only that exact path and one optional trailing slash. Other visible nonfragment destinations use exact or slash-delimited descendant matching, with longest visible href winning and first equal-specificity candidate deterministic. Ignore query/fragment suffixes for page ownership. Exclude every fragment href: `/administration/users#invitations-title` never gets aria-current="page"; Users stays current on that URL if visible. Preserve the existing target, scrolling and href. Reject lookalike prefixes, case variants and unrelated routes. No history patches, hash listeners, returnTo inference or location indicators.
6. **Permission constraints:** preserve every existing layout gate and group omission, including settings and Audit. No page/API authorization, tenant, resource-scope or grant changes. Current state uses only the server-provided list. Primary Administration visibility and Goal 14 selection remain authoritative and unchanged.
7. **Accessibility/localization:** reuse Navigation labels and existing tokens without new copy, icons, keys or dependencies. Exactly zero/one current page across all groups, noncolor selected cue, visible focus independent of selection, unchanged Tab order/targets/wrapping/contrast and no overflow. Scope secondary checks separately from the primary nav's legitimate current marker.
8. **Focused tests:** execute actual AdministrationLayout with both catalogs and existing synthetic boundaries. Verify all prior gates, first-group Overview, empty-group omission, exact localized headings/links/order, mixed/duplicate/reordered/no/unrelated grants and absence of sensitive client props. Test root/detail/nested/longest/hidden/empty/no-match/negative cases and stable index/ties/nonmutation. Preserve Goal 10–15 tests.
9. **Browser/screenshots:** extend existing fixture/app/builder only as needed to mount the real new client component with server-produced groups; static landingHtml alone cannot establish live pathname behavior. Capture both locales at desktop/mobile for Overview, Users, Users detail, Invitations fragment, organization/facility/team detail, Audit, document templates and hidden/unmatched controls. Check marker uniqueness, native invitations jump, pathname/prop transitions, grouping, keyboard/focus, dimensions, overflow and axe; compare before/after quantitatively and report outside-region pixels. Cross-route settings link href/visibility checks must not invent persistence of AdministrationLayout outside its segment.
10. **Risks/exclusions:** do not leak grants into client props, change group visibility, select Overview on all descendants, select both Users/Invitations, or change cross-route layout mounting. Do not modify Billing navigation, primary selector/shell/sidebar, Goal 12/13/14 behavior, other page components, forms/actions, authorization, API/client/backend/schema/catalog/dependency files. No generic registry, navigation redesign or baseline expansion.
11. **Definition of done:** exactly zero/one correct visible Administration current-page marker under this policy; original grouping/filtering and all hrefs/labels remain intact; actual client/server and both-locale browser tests pass; all required gates pass with zero new violations; Graphify refreshed; `docs/architecture/goal-16-to-goal-17.md` completed. Do not implement Goal 17.

## F. Copy-ready Goal 16 prompt

```text
Goal 16: Current-page indication in Administration secondary navigation

Repository: /home/woobb/Projects/care (woobble/care). Implement one bounded improvement; no multi-agent mode.

Read AGENTS.md, apps/web/AGENTS.md, relevant installed Next guides, docs/architecture/overview.md, module-boundaries.md and docs/architecture/goal-15-to-goal-16.md. Check git status and preserve unrelated work. Query Graphify first. Reproduce the unmarked Administration nav and inspect its own grouped/fragment/cross-route structure before implementation; do not automatically copy Billing.

Production scope: administration/layout.tsx and a small colocated administration-nav-links.tsx. Keep the layout server-owned for grant retrieval, translations and every existing filter/group omission. Pass only permitted serialized localized groups and href/label pairs to a client renderer using usePathname; no permissions, session or tenant context. Keep the server nav/container, three headings, Overview inclusion, group/link order, grid/breakpoints and child-page placement unchanged.

Add at most one aria-current="page" with existing-token background and a noncolor cue such as underline. Preserve hrefs, labels, target sizes, layout, hover, focus, keyboard and ordinary link behavior. Overview /administration matches only that path and one optional trailing slash. Other visible nonfragment links use exact/slash-descendant matching and longest-visible-href precedence, with first equal-specificity candidate deterministic. Hidden/unmatched links never acquire a marker or become visible. Do not mutate input groups.

Exclude fragment hrefs: /administration/users#invitations-title remains an ordinary in-page jump and never receives aria-current="page"; Users stays current there if visible. Its target already exists. Ignore query/fragment suffixes for page ownership. Reject lookalikes/case variants/unrelated routes. No hash listeners, history patches, returnTo rules or section-location indicators.

Preserve the Access group's always-visible Overview and exact independent gates, including Audit and settings; omit empty later groups exactly as before. Configuration links point to Billing/Operations settings but AdministrationLayout mounts only in the Administration segment: retain those links without adding the layout to other routes. Current state is presentation, not authorization.

Do not modify Billing navigation, Office primary selector/shell/sidebar/visibility, Goal 12–14 controls or behavior, other page components, forms/actions, grants/tenant/resource/API authorization, catalogs, backend/API/client/schema/dependencies. No generic navigation registry/framework, redesign or architecture-baseline expansion.

Extend actual AdministrationLayout server tests for exact permitted group/label/link props, all existing gates, mixed/duplicate/reordered/no/unrelated grants, empty groups and no sensitive props, in English/German. Add focused matching tests covering root, descendants, longest matches, hidden items, empty/no-match/negative routes, fragment exclusion, stable ties and nonmutation. Retain all Goal 10–15 coverage.

Mount the real client renderer in the existing isolated fixture with actual server-produced groups; static landingHtml alone is insufficient. Capture desktop/mobile before/after in both locales for Overview, Users/detail, Invitations fragment, organization/facility/team details, Audit, templates and hidden/unmatched controls. Test live pathname/prop changes, unique markers across groups, native fragment navigation, keyboard/focus, grouping/geometry, overflow and axe. Compare screenshots quantitatively, report boundary/outside-region pixels and preserve primary context. Do not imply Administration nav persists after navigating to cross-route settings.

Use synthetic data and probe OIDC without exposing secrets or altering authentication. Distinguish server/client/fixture verification from full Next hydration, authenticated Office E2E and actual destination authorization.

Follow AGENTS.md formatting (oxlint --fix, then configured oxfmt). Build before generated-output-dependent checks. Run focused tests and relevant full isolated browser suites plus bun run build, architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, format:check and bunx oxlint --deny-warnings --format=agent. Refresh graphify update . (AST only). Verify zero new violations and unchanged excluded baseline/backend/generated/catalog/dependency/permission files.

Create docs/architecture/goal-16-to-goal-17.md with status/duration, exact implementation and server/client/matching decisions, files and before/after sizes, commands/counts/failures, screenshot/accessibility/localization evidence and authenticated gaps. Reassess remaining debt from evidence, select exactly one small confirmed next improvement and provide a standalone Goal 17 prompt requiring docs/architecture/goal-17-to-goal-18.md. Do not implement Goal 17 or Goal 18.

Final response: status/duration, implementation, matching/permission behavior, file changes/sizes, focused/full tests, screenshots/accessibility/localization, authenticated gaps, handoff path and copy-ready next prompt.
```
