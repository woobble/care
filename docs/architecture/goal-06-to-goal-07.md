# Goal 06 → Goal 07 handoff

## A. Goal 06 implementation summary

**Status: Complete**, with browser E2E unverified because isolated OIDC is unavailable. Goal 07 is preparation only; no frontend implementation is included.

Created:

- apps/api/src/presentation/http/scheduling-tours.controller.ts: the existing SchedulingToursController, retaining all seven methods (list, create, get, updateStops, suggestOrder, estimateTravel, publish), decorators, guards, DTO references and public facade calls.
- apps/api/src/presentation/http/scheduling-http.ts: the existing parseId and auditContext functions, shared by extracted and remaining Scheduling controllers.
- apps/api/src/presentation/http/scheduling-tours.controller.test.ts: six focused cases for routes/registration, delegation/context, malformed inputs, coercion/strictness, optional note semantics and error precedence.
- docs/architecture/goal-06-to-goal-07.md: this handoff.

Changed:

- scheduling.controller.ts: removes only the tour controller, its unused imports and the two helper definitions; remaining controller bodies/decorators are unchanged and import the shared helpers.
- apps/api/src/modules/scheduling.module.ts: imports SchedulingToursController directly from its new file, preserving its existing position in the controller list.
- apps/api/integration/clients.integration.test.ts: adds tour HTTP list/detail/suggestion, malformed/query/verb/date checks, version coercion and publication snapshot response assertions.
- docs/domains/scheduling.md: transport boundary documentation.
- Local ignored Graphify artifacts refreshed with graphify update . using the AST-only convention.

No files removed. No DTO/schema, application/domain, repository/routing, database/migration, frontend, controller class/method name, token/provider or error-filter changes. No compatibility barrel or duplicate controller registration was introduced.

Sizes: scheduling.controller.ts **991 lines / 37,433 bytes → 836 / 31,864**; scheduling-tours.controller.ts **181 / 5,969**; scheduling-http.ts **18 / 587**. The tour class remains the same 124-line implementation. The old file retains eleven controller groups; Office tour transport now has independent ownership. The increased combined import overhead is intentional and is not a performance improvement.

DTOs remain in scheduling.dto.ts: moving them was unnecessary for this boundary and could add Swagger component or import-identity risk. No generic parser, base controller, pipe or framework was added. Existing typed request parsing, principal extraction and BadRequestException behavior remain unchanged.

## B. Verification results

| Exact check                                                                                                                       | Result                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| bun run architecture:check                                                                                                        | Pass: 159 existing violations, zero new/obsolete entries                                 |
| bun run architecture:test                                                                                                         | Pass: 15 tests / 33 assertions                                                           |
| bun run lint                                                                                                                      | Pass: 33 workspace tasks                                                                 |
| bun run typecheck                                                                                                                 | Pass: 33 workspace tasks                                                                 |
| bun run test                                                                                                                      | Pass: 51 Turbo tasks                                                                     |
| bun run test:integration                                                                                                          | Pass: 32 Turbo tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80 |
| bun run build                                                                                                                     | Pass: OpenAPI generation plus 32 build tasks                                             |
| bun run format:check                                                                                                              | Pass                                                                                     |
| bunx oxlint --deny-warnings --format=agent                                                                                        | Pass                                                                                     |
| bun run --filter @care/api typecheck                                                                                              | Pass after correcting test-double typing                                                 |
| bun test apps/api/src/presentation/http/scheduling-tours.controller.test.ts apps/api/src/presentation/http/scheduling.dto.test.ts | Pass: 8 tests / 70 assertions                                                            |
| bun test --timeout=300000 apps/api/integration/clients.integration.test.ts                                                        | Pass: 880 assertions                                                                     |
| bunx oxlint --fix                                                                                                                 | Pass after removing unused imports and unnecessary test side-effect import               |
| bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'     | Pass                                                                                     |
| graphify update .                                                                                                                 | Pass: AST-only, 13,003 nodes / 39,395 edges / 695 communities; no API cost               |

Turbo reused unchanged workspace results where applicable. The initial focused test expected raw request context; the established requestContext helper adds principal tenantId, so the assertion was corrected. Test-double return/call typing was corrected for API typechecking. An unnecessary reflect-metadata side-effect import produced a warning and was removed; Nest's metadata-based tests still pass. No production behavior or existing test was weakened.

Contract comparison: parsed pre/post apps/api/openapi.json objects are **structurally identical**, preserving paths, verbs, operation IDs, components, references, tags, requiredness and nullability. All **18 generated client files are byte-identical** by SHA-256. Generation used bun run build; output was not hand-edited.

All twelve pre-extraction Scheduling controller class ASTs are identical after ignoring source offsets: the tour class is in its new file, and the other eleven bodies/decorators are unchanged. Route metadata tests verify controller prefix, all seven method/path pairs, explicit status metadata, both guards and exactly one registration in SchedulingModule. The PostgreSQL/API scenario reaches all seven routes through Nest and continues exercising existing visit/availability/substitution behavior; the broader calendar and Operations integrations also pass.

New boundary coverage includes missing/malformed UUID/query inputs, strict unknown fields, invalid local-date ranges, coerced estimate/publication versions versus strict stop-update versions, absent/undefined/null dispatcher notes, invalid/over-limit stops, missing principal, malformed-input precedence over application authorization, denied/cross-tenant access, stale versions, unavailable routing and immutable publication responses.

Browser E2E is **unverified**: a bounded read-only probe of configured .env.test OIDC discovery returned no response. API integration uses its existing isolated OIDC setup. No production data, secrets or identity configuration were changed.

Graphify refreshed the code graph successfully. Community changes received hub-derived fallback labels; semantic relabeling is outside the requested AST-only refresh.

Runtime behavior/query structure is unchanged: handlers and application calls are identical, and shared helper implementations were moved intact. No performance improvements are claimed; production latency/load was not measured. Architecture baseline was neither expanded nor regenerated.

## C. Remaining backend debt

- apps/api/src/presentation/http/scheduling.controller.ts still contains eleven groups, repeated principal checks (VisitsController, AgreementVisitGenerationController, availability/worklist and others), inline myPublishedToursQuerySchema at scheduling.controller.ts:93 and assignmentResponse at scheduling.controller.ts:824. Broader extraction is deferred.
- scheduling.dto.ts (including updateTourStopsSchema at line 211 and tourVersionSchema at line 228) still combines 1,129 lines of strict Zod schemas and Swagger classes; tourVersionSchema coercion differs intentionally from updateTourStopsSchema. Preserve actual semantics rather than “standardizing” them.
- scheduling.mapper.ts has assignment mapping overlapping the controller-local assignment response. No deduplication was attempted outside the tour boundary.
- VisitsController's repeated ApiQuery decorators remain unchanged; removal needs separate contract evidence.
- problem-details.filter.ts retains centralized Scheduling error mapping. Application authorization/tenant scopes remain authoritative; no transport permission redesign is implied.
- Existing 159 architecture findings, Scheduling repository/calendar foreign persistence, Operations legacy adapters/reconciliation and Billing legacy projection/claims debt remain outside Goal 07.
- Browser E2E and production performance remain unverified. These are limitations, not authorization for frontend or backend redesign.

## D. Goal 07 preparation: Clients frontend feature pilot

Inspected apps/web/src/app, components, lib, packages/ui, generated API use, Server Actions, Office/Caregiver layouts, i18n, tests and E2E. Read apps/web/AGENTS.md and the installed Next 16 forms guide; future implementation must read the relevant installed guides before changing frontend code. There is currently **no apps/web/src/features/** directory.

1. **Current boundaries:** App Router route folders act as feature boundaries for Clients, planning, agreements, benefits, communications and invoices. Common components contains both reusable UI/application infrastructure and feature-specific components. packages/ui owns design primitives with per-component exports, not business feature orchestration.
2. **Large pages:** clients/[id]/page.tsx is **2,860 lines / 116,835 bytes**; planning/page.tsx **1,883 / 79,665**. ClientDetailPage handles async params/query, authenticated API/client loading, permissions, navigation and Suspense. ClientDetailContent fetches addresses/contacts/insurance/Pflegegrad and provider lookups, then renders many edit forms and sections. Local async sections own documents, visits, admission history and timeline; numerous form/label/display helpers sit at the bottom. Planning mixes bounded scheduling reads, permissions, calendar projections, filters and mutations; leave it outside the pilot.
3. **Feature versus shared components:** client-profile-overview.tsx is a Clients-only Server Component composed of contact/work summaries with bounded authorized reads and Suspense. client-profile-section-nav.tsx is a Clients-only Client Component for keyboard focus scrolling. Their only route consumer is Clients detail. Reuse RHFActionForm, AsyncEntityCombobox, page-patterns, ResourceReference, DataPagination, loading skeletons and @care/ui controls; do not copy them into the feature or move business UI to packages/ui.
4. **Actions:** clients/actions.ts is **566 lines / 22,592 bytes**; planning/actions.ts **588 / 24,063**. Both are use-server modules with repeated FormData readers, UUID/date parsing, API/tenant access, revalidation and redirect handling. Clients actions return false or boolean/void for inline forms; planning actions generally redirect with error/updated query values. Do not unify these contracts during Goal 07.
5. **Validation/errors:** current Clients actions manually trim/read values and apply required/choice/UUID/date rules; RHFActionForm separately derives client validation from rendered control constraints, handles false/string failures, preserves Next redirect exceptions, refreshes after success and supports unsaved-change warnings. Frontend validation is advisory; API rules remain authoritative. A feature parser/schema must preserve existing accepted values, null/omitted behavior and false/redirect outcomes, not impose new rules.
6. **Permissions/data ownership:** detail page uses generated ClientResponseDto plus tenant/provider-aware hasClientPermission; resource links and subsections have separate schedule, agreement, benefits, billing, documents, communications and operations gates. Shared lib/api.ts authenticates through Better Auth/Authentik, resolves the tenant cookie and creates request-scoped API clients/grant caches. Action mutations must call these server helpers themselves; hidden IDs and page visibility are not authorization. Do not relocate data access into a browser bundle or introduce cross-request tenant caches.
7. **Server/client boundary:** page, ClientDetailContent and profile overview are Server Components; section nav and RHFActionForm are Client Components. Keep credentials/API access/permission-aware fetching server-side. Pass only existing safe serializable props across client boundaries; do not add use-client to a large server page for convenience. Feature code should depend on shared lib/i18n/UI, not route modules.
8. **Layouts/routing:** Office layout checks session/current tenant, composes permission-aware navigation, preserves sidebar/mobile state and modal slots. Caregiver layout is separate. Existing client paths, hash anchors, document query pagination, related-resource links and scheduling return targets must remain unchanged. This is file/ownership restructuring, not a UI or routing redesign.
9. **Localization:** English/German catalogs and next-intl namespaces remain stable. Server components use getTranslations/getLocale; clients use localized provider subsets. Existing formatting helpers carry locale/timezone. Preserve accessible labels, IDs, details/summary semantics, focus navigation, live error notices and keyboard/touch behavior. Read docs/frontend/internationalization.md.
10. **Tests/tooling gaps:** web test currently runs only src/i18n; feature tests will need an explicit script entry or invocation. scripts/check-i18n.ts scans src/app and src/components, so introducing features also requires adding that directory to its scan. Existing lib tests and caregiver drafts tests exist outside the default web test target. E2E suites include office-shell, identity-access, accessibility-keyboard, admission-planning and related-resource workflows. Relevant client-profile viewport/focus/a11y checks are in accessibility-keyboard.spec.ts; no dedicated Clients feature component suite exists today.

Confirmed pilot candidates: the personal-data edit block in ClientDetailContent (around lines 644–741), its TextField/SelectField helpers (around 2569–2647), updateClientAction (actions.ts around 93–117) and feature-specific overview/nav components. Provider context, address/contact, insurance/Pflegegrad, routing/preferences and related-domain sections are larger follow-up slices, not all part of the first move.

## E. Goal 07 implementation plan

Smallest cohesive slice: **Clients personal-data editing and profile presentation ownership**. Establish feature structure with real component/schema/action ownership, without rewriting the whole 2,860-line detail route.

Suggested target tree:

- apps/web/src/features/clients/components/client-personal-data-form.tsx — Server Component for the existing edit-personal-data details/form block.
- apps/web/src/features/clients/components/client-form-fields.tsx — existing TextField/SelectField implementations, imported back by remaining Clients route forms where still needed; do not create a new generic form system.
- apps/web/src/features/clients/components/client-profile-overview.tsx — move the existing Clients-only Server Component intact.
- apps/web/src/features/clients/components/client-profile-section-nav.tsx — move the existing Client Component intact.
- apps/web/src/features/clients/schemas/client-personal-data.ts — pure typed form parsing/schema equivalent to the current update action's required/choice/nullable rules.
- apps/web/src/features/clients/actions/client-profile.actions.ts — use-server update action with unchanged authentication, tenant header, API PATCH, return values and revalidation.
- apps/web/src/features/clients/model/client-profile.ts — only genuinely shared generated type aliases/prop types; avoid duplicating API models or creating a repository/state layer.
- Focused parser/action/component tests colocated with the feature and included in the web test command.

Implementation sequence:

1. Inspect live state and relevant installed Next.js guides. Record current rendered personal-data fields, names/IDs, required/optional values, translations, permission gates, action outcomes and fetch/revalidation behavior before moving code.
2. Introduce features/clients with concrete component responsibilities. Keep ClientDetailPage's routing, notFound/auth/permission composition, initial loading, query handling and remaining async sections in the route. Extract the existing personal-data edit block and its field helpers without changing markup or blanket clientifying the server component.
3. Move overview/nav unchanged and update their sole route imports. Avoid broad feature barrel exports that mix server-only actions/data with Client Components. Direct imports make boundaries explicit.
4. Extract the current updateClientAction implementation and pure input rules to the feature. Keep the existing route action export as a thin explicit async compatibility wrapper if remaining callers need it; feature components import the feature action, never the route. Preserve false/void behavior, PATCH payload omission/nulls, generated API contracts and both /clients and /clients/{id} revalidation. Never rely solely on page permissions; shared API authentication/tenant resolution and backend authorization remain in the mutation path.
5. Extract only existing validation rules; do not add stricter field limits, date validity rules, normalization or new error messages as part of relocation. Keep create/address/contact/insurance/Pflegegrad/preferences/routing actions and planning action helpers unchanged. Goal 08 owns cross-feature validation/Server Action result/error consistency.
6. Reuse @care/ui, RHFActionForm and existing application components. Keep existing canUpdateClient gating, English/German messages, details/summary behavior, unsaved-change handling and focus/section navigation. No frontend redesign or new dependencies.
7. Add feature parser tests for empty/trimmed names, nullable optional values, choice handling, invalid IDs and current date semantics; action regressions for authenticated API/tenant headers, error false returns and revalidation; component/route or E2E coverage for editing, permission-gated rendering, both locales, keyboard focus and unsaved forms. Ensure tests are actually included in scripts. Extend the existing i18n scanner to features with no weakened exclusions.
8. Run architecture/lint/typecheck/unit/integration/build/format/strict-lint gates, i18n:check and relevant frontend/E2E workflows when isolated OIDC is available; otherwise state browser verification gaps clearly. Check no API/generated-client/backend/migration changes, no server-code imports into client bundles and no unintended fetch/query expansion. Refresh Graphify and create the Goal 08 handoff.

Exclusions: application-wide feature migration, planning/calendar, other Clients domain subsections, cross-feature action-result standardization, backend refactoring, authorization policy changes, URL/locale redesign, global form framework changes, visual redesign and new client-side data/state layers. Risks: server/client import contamination, lost server-action authentication/revalidation, changed RHF child-field discovery, schema behavior drift, accidental translation/focus regressions and tests/i18n scanning silently excluding the new directory.

## F. Copy-ready Goal 07 prompt

> Implement Goal 07 in woobble/care: establish apps/web/src/features/clients as the frontend feature-architecture pilot. Read docs/architecture/goal-06-to-goal-07.md (D–E), architecture overview/boundaries/dependency map, frontend internationalization docs, apps/web/AGENTS.md and relevant installed Next.js guides first. Inspect actual worktree, Clients/planning pages/actions, shared components/UI/tests and Graphify; preserve unrelated changes. No multi-agent mode or production data/secrets.
>
> Extract the Clients detail personal-data edit form, existing field helpers, Clients-only profile overview/nav, equivalent personal-data input schema/parser and updateClientAction into explicit feature components/schemas/actions. Keep route pages responsible for URLs, async params/query, initial authenticated data, permissions, Suspense and remaining sections. Retain a thin async route-action compatibility wrapper where needed. Feature code depends on shared lib/i18n/UI, not route modules; avoid barrels mixing server actions and Client Components.
>
> Preserve all field IDs/names/markup, canUpdateClient gating, server-side authentication/tenant API access, backend authorization, generated API types, PATCH null/omitted behavior, false/void action results, revalidation, related links/hash anchors, unsaved-change/focus behavior and English/German translations. Keep Server Components server-side and the section nav/RHF boundary unchanged. Reuse existing design components; add no dependencies, new state layer, UI redesign, API/schema/migration changes or stricter validation.
>
> Add meaningful parser/action/component/E2E regressions and ensure feature tests run. Extend i18n scanning to features. Run required architecture/lint/typecheck/unit/integration/build/format/strict-lint gates, i18n:check and graphify update . Run Office/Caregiver/Clients browser checks only with isolated OIDC available, otherwise report unverified. Keep planning and other Clients subsections outside scope. Defer global action-result/error/validation consistency to Goal 08.
>
> Create mandatory docs/architecture/goal-07-to-goal-08.md with status/files/ownership, server/client/auth/i18n decisions, actual verification/gaps, before/after responsibilities/sizes and an evidence-based Goal 08 plan/prompt. Goal 08 focuses on consistent frontend validation, Server Action results and form error handling. Do not implement Goal 08.
