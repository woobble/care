# Goal 08 → Goal 09 handoff

## A. Implementation summary

**Goal 08 status: Complete.** Clients personal-data update now uses typed Zod parsing and serializable field/form failures. Only that form opts into the shared RHF extension. All required repository gates and 13 isolated browser interaction tests pass. Full authenticated Clients E2E, application hydration and application-wide browser accessibility remain unverified because isolated OIDC discovery is unavailable. Goal 09 and Goal 10 are preparation only.

Created:

- `apps/web/src/features/clients/lib/client-update.schema.ts`: feature schema, normalized output/field/failure types and known-field FormData parser.
- `apps/web/src/lib/form-action-failure.ts`: small shared serializable failure contract, discriminator guard and safe localization-key fallback; no server or feature imports.
- `apps/web/src/features/clients/lib/client-update.schema.test.ts`: six focused parsing/serialized-payload tests.
- `apps/web/e2e/rhf-action-form.spec.ts`: thirteen Playwright interaction cases using the real RHFActionForm and Clients field wrappers.
- `apps/web/e2e/support/form-action-app.tsx`: isolated React fixture with real next-intl catalogs and controllable asynchronous action responses.
- `apps/web/scripts/build-form-test.ts`: builds that fixture with existing Bun tooling, replacing only Next's router hook with a refresh counter.
- `apps/web/playwright.forms.config.ts`: standalone Chromium interaction configuration with no application/OIDC/database server startup; accepts an optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` override.
- This handoff.

Changed:

- `features/clients/actions/update-client.ts`: validates before API access, returns typed failures and retains the existing success sequence.
- `app/(office)/clients/actions.ts`: adapts the feature's failures to false at its existing async update wrapper; all other action bodies remain unchanged.
- `components/rhf-action-form.tsx`: optional structured-error action type, RHF setError/clearErrors integration, translated field/form feedback, field-specific description IDs and version checks against stale responses. Existing focus logic is reused for server failures.
- `features/clients/components/client-personal-data-form.tsx`: adds only `structuredErrors` to the existing form invocation.
- `features/clients/clients.test.ts`: updates feature-action expectations and adds serialization, legacy-adapter and authorization-rejection coverage.
- `apps/web/package.json`: adds `test:forms` using the existing Playwright dependency.
- `apps/web/tsconfig.json`: includes the new Playwright config in typechecking.
- Ignored Graphify outputs: AST-only refresh.

No files removed. No dependencies, backend/API/DTO/database/migration/generated-client changes. Creation, other Clients edit forms, caregiver forms and Office presentation remain outside this implementation.

Sizes count newline-delimited lines and UTF-8 bytes against HEAD at the start of Goal 08:

| File                        | Before lines / bytes | After lines / bytes |
| --------------------------- | -------------------: | ------------------: |
| RHFActionForm               |         705 / 23,038 |        820 / 27,599 |
| Feature update action       |           41 / 1,413 |          34 / 1,305 |
| Personal-data form          |          112 / 3,889 |         113 / 3,914 |
| Clients feature tests       |         452 / 16,127 |        511 / 18,193 |
| Route actions               |         512 / 20,605 |        513 / 20,661 |
| Web package manifest        |           48 / 1,440 |          49 / 1,513 |
| Web tsconfig                |             16 / 303 |            17 / 337 |
| Shared failure contract     |                    — |            16 / 661 |
| Client update schema/parser |                    — |          42 / 1,617 |
| Schema tests                |                    — |         140 / 4,918 |
| Browser tests               |                    — |        297 / 12,468 |
| Browser fixture             |                    — |         114 / 3,845 |
| Browser config              |                    — |            15 / 458 |
| Fixture builder             |                    — |            27 / 912 |

## B. Architectural decisions

### Validation and request compatibility

`clientUpdateSchema` owns all eleven submitted fields, including ID. First/last names trim and must remain nonblank. Optional text/date values trim to strings or null; File and missing values retain their existing treatment. Gender accepts female/male/diverse and salutation accepts mr/ms/mx/other; other selections become null. ID validation reuses the existing readUuid helper, preserving whitespace, case, version 1–8 and variant handling. The schema adds no date, email, phone, name-length or business restrictions.

The parser reads only known names using FormData.get, preserving first-entry behavior and excluding submitted tenant/provider/action metadata. The schema's output order preserves the original serialized PATCH body order. It does not use Object.fromEntries on arbitrary submitted entries. Its ID helper comes from the existing server-side form-data utility; neither parser nor schema is imported into client runtime code.

Invalid ID still redirects to `/clients?error=INVALID_REQUEST`, with precedence over name validation. Required-name errors return only their field names and recognized required-message keys. The API call happens after successful parsing and still uses getApiClient/getTenantHeader, `/api/v1/clients/{id}`, the same path ID and tenant header. The API remains authoritative for permission, tenancy and business validation. No posted tenant ID is trusted.

### Result and compatibility contracts

The shared contract is `FormActionFailure<Field>`: `{ ok: false; fieldErrors?: Partial<Record<Field, readonly FormActionErrorKey[]>>; formError?: FormActionErrorKey }`. `ClientUpdateField` is derived from the feature schema's output keys. Message keys are restricted to the already localized Common.formValidation.required/actionFailed. The runtime fallback also maps unknown message values to actionFailed.

No raw API error, submitted value, Error, ZodError, stack trace or backend detail is returned. Ordinary API rejections, including authorization rejection, become a safe form-level actionFailed failure. Unexpected thrown failures still reach the existing RHF exception handler, which shows safe fallback feedback. Authentication redirects are not caught. There is no artificial success object: success still revalidates `/clients`, then `/clients/{id}`, then redirects to the client detail route.

The feature action returns `Promise<ClientUpdateFailure | void>`. The existing route wrapper keeps `FormData -> Promise<boolean | void>`, converting a returned failure to false and leaving redirect exceptions untouched. There is one update implementation. No other action adopts the new shape.

### RHF integration and boundaries

The component props discriminate between a legacy action and an explicitly opted-in structured action. Only the personal-data form opts in. The shared failure module has no imports and is safe in the client graph; RHF never imports Clients validation, API or server utilities. The feature form remains a Server Component and passes a Server Action reference across the existing RHF client boundary.

For structured failures, RHF sets type-server errors only for matching form controls and does not overwrite an existing client error. It renders labeled, translated FieldError alerts with individual IDs and associates affected native controls through aria-invalid/aria-describedby, preserving unrelated description IDs. Server messages are excluded from the existing client-error summary to avoid duplicate server announcements. A returned formError uses the existing global role-alert treatment. Controlled field wrappers and native client validation are unchanged.

Edits clear the relevant server field error and global server feedback. Resubmission clears only errors still owned by the server path. Other client validation errors are retained. A submission version advances on opted-in edits/submissions; stale server results, refreshes, exception feedback and delayed server-error focus are ignored. Redirect signals always propagate. Focus chooses the first visible invalid native control in DOM order after the transition unlocks the form.

Legacy false/string/void/true results, custom errorMessage precedence, onActionError exception callbacks, refreshOnSuccess, fieldset locking, pending status and unsaved-change listeners retain their behavior. In particular, the existing legacy string-result path still refreshes when refreshOnSuccess is true; this incidental behavior was preserved rather than silently corrected.

## C. Verification

| Exact command                                                                                                                                                                                                                                                          | Result                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun run architecture:check`                                                                                                                                                                                                                                           | Pass: 159 existing violations; zero new or resolved baseline entries               |
| `bun run architecture:test`                                                                                                                                                                                                                                            | Pass: 15 tests / 33 assertions                                                     |
| `bun run lint`                                                                                                                                                                                                                                                         | Pass: 33 workspace tasks                                                           |
| `bun run typecheck`                                                                                                                                                                                                                                                    | Pass: 33 workspace tasks                                                           |
| `bun run test`                                                                                                                                                                                                                                                         | Pass: 51 Turbo tasks; web 32 tests / 473 assertions                                |
| `bun run test:integration`                                                                                                                                                                                                                                             | Pass: 32 tasks; API 7 tests / 1,565 assertions; worker 3 / 13; database/RLS 5 / 80 |
| `bun run i18n:check`                                                                                                                                                                                                                                                   | Pass: 3,585 keys in English/German parity; feature traversal remains active        |
| `bun run build`                                                                                                                                                                                                                                                        | Pass: OpenAPI generation and 32 build tasks                                        |
| `bun run format:check`                                                                                                                                                                                                                                                 | Pass                                                                               |
| `bunx oxlint --deny-warnings --format=agent`                                                                                                                                                                                                                           | Pass                                                                               |
| `bunx oxlint --fix`                                                                                                                                                                                                                                                    | Pass                                                                               |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'`                                                                                                                                        | Pass                                                                               |
| `bun run --filter @care/web typecheck`                                                                                                                                                                                                                                 | Pass                                                                               |
| `bun test apps/web/src/features/clients apps/web/scripts/check-i18n.test.ts`                                                                                                                                                                                           | Pass: 20 tests / 411 assertions                                                    |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/woobb/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell XDG_CONFIG_HOME=/tmp/care-goal08/config XDG_CACHE_HOME=/tmp/care-goal08/cache bun run --filter @care/web test:forms` | Pass: 13 Chromium interaction tests                                                |
| `graphify update .`                                                                                                                                                                                                                                                    | Pass: AST-only, 13,067 nodes / 39,557 edges / 693 communities; zero API cost       |

Turbo reuses unchanged workspace results where applicable. Temporary evidence logs and the compatibility audit script are in `/tmp/care-goal08/`; they are not committed artifacts.

Focused unit tests cover serialized valid payloads, required/trimmed/non-string names, optional omission/null/file cases, every enum choice and invalid selections, UUID behavior, permissive date/text handling, duplicate field entries, exclusion of forged tenant/provider metadata, validation before API access, safe serializable failures, tenant/auth context, authorization rejection, cache ordering, redirect propagation and legacy wrapper compatibility.

The thirteen browser cases execute the real RHFActionForm, react-hook-form, Zod client validation, Clients field wrappers and next-intl in Chromium. They verify legacy results/custom messages/refreshes, explicit opt-in, both languages, field labels and individual ARIA references, existing description preservation, DOM-order focus, edit/retry clearing, form fallback sanitization, native required validation, submit locking and pending status, keyboard navigation, unsaved-change dialog, overlapping/stale results, redirect propagation, existing client-error preservation and safe exception feedback. Axe reports zero violations for the fixture's structured field-error state.

The fixture mounts React directly and substitutes the Next router's refresh hook and action transport. It does **not** prove Next application hydration, authenticated routing, actual Server Action transport, production styling/color contrast, production screenshots or the whole Clients workflow. The production Next build independently verifies the actual Server Action/component compilation boundaries.

Full Clients E2E was not started: the bounded read-only OIDC discovery probe using `.env.test` returned no response. Authenticated application E2E, application hydration and application browser accessibility remain unverified. The standalone form tests do not require that environment and were actually run; their scoped browser evidence should not be confused with full E2E.

Environment/test corrections: the default Playwright command expected revision 1248, while revision 1247 was available. A full-Chrome launch encountered crashpad configuration restrictions; the existing headless shell with writable temporary XDG directories ran successfully. JSON fixture imports needed Node import attributes. One dialog test initially waited for click completion before dismissing the modal; dismissing from the event handler resolved its timeout. No production behavior was changed to accommodate these test setup issues.

An initial concurrent root test/build attempt raced generated-client output and failed with ENOENT in generation. The build finished successfully, then `bun run test` was rerun without concurrent generation and passed. Avoid parallel root commands that both regenerate the client. Initial type/lint errors in test fixtures were corrected before the final gates.

Additional compatibility evidence (`bun /tmp/care-goal08/verify-compatibility.ts`): 174 before/after action scenarios match after legacy adaptation, including byte-equivalent serialized requests, auth/tenant calls, failure outcomes, revalidation and redirects. All other route action ASTs, native validation, controlled field wrappers and success-notice code remain unchanged. Personal-data component markup matches after removing its single new opt-in attribute. Shared parsing/navigation/cache helpers are byte-identical.

Backend, catalogs, public OpenAPI and generated API output remain unchanged. The App Router file set and route ownership remain unchanged. No architecture-baseline expansion, feature-to-route imports, shared-to-feature imports or new dependency cycles were introduced. Graphify used its aggregated HTML view; 117 changed communities received hub-derived labels. Semantic document extraction/relabeling is outside the AST-only refresh.

## D. Remaining technical debt

Confirmed, outside this slice:

- Other Clients actions and Office/Caregiver forms retain void/boolean/string or action-specific object contracts. The route update adapter intentionally retains its legacy signature.
- RHFActionForm has grown to 820 lines and still combines native schema discovery, registration, unsaved listeners, action state, feedback and controlled wrappers. This change adds an opt-in path; it does not establish a new global framework.
- Only first/last-name failures receive field-level server mapping in this feature. API business/authorization errors use a safe global fallback; arbitrary backend validation details are deliberately not inferred into field errors.
- Controlled RHF fields retain their existing presentation. The new browser fixture verifies native controls used by the personal-data form, not every possible controlled input or custom widget.
- Similar field wrappers remain in Employee/Planning/Operations pages. Clients creation/editing share their existing feature helpers; creation was not migrated to structured results.
- The Clients detail route still has 2,684 lines; Planning has 1,883 lines. Other domain sections and presentation debt remain separate work.
- Existing frontend/backend import debt remains in Planning and agreement price components, alongside the authorized Identity/Database auth-adapter exception. The architecture baseline is unchanged.
- Representative Office pages use different outer spacing/widths, inline error banners, plain-text versus card empty states and different table/card breakpoints. These differences are confirmed in source but are not all defects.
- Full authenticated browser interactions, application styling, screen-reader behavior and cross-page screenshot comparisons remain unverified. The isolated axe pass does not prove application-wide accessibility. No new confirmed production accessibility defect is claimed from the available evidence.

## E. Goal 09 preparation

Inspected shared PageHeader/SectionHeader/EmptyState/ErrorNotice/SuccessNotice in `components/page-patterns.tsx`, RHFActionForm, DataPagination, PageLoadingSkeleton and ResourceReference; UI FieldError, StatusBadge, Skeleton and Table primitives; Clients list/detail, Employees list/detail, Planning, Operations dashboard/worklist and Billing receivables.

| Concern                | Current evidence and implication                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers                | All sampled pages already use PageHeader. SectionHeader exists and is used by Operations; other section headings are often inline. A new global header abstraction is unnecessary.                                                                                                                                                                    |
| Width/spacing          | Clients list uses min-w-0/grid-cols-1/gap-6; Employee list gap-6 and detail gap-8; Operations dashboard gap-5, queue gap-6; receivables centers max-w-6xl. Some differences reflect page purpose; do not normalize widths blindly.                                                                                                                    |
| Errors/status          | ErrorNotice already supplies a semantic role-alert paragraph with standard destructive styling. Employee list repeats it twice, with p-3 versus p-4. Work queue repeats its styling for query/load errors, uses a distinct neutral permission-denied alert, and has success/warning status notices. Receivables already imports ErrorNotice as Alert. |
| Empty/loading          | Clients list and Operations dashboard reuse EmptyState. Employee list has a plain bordered not-found paragraph, receivables a muted empty paragraph and work queue a bordered queue-empty block. PageLoadingSkeleton already provides status/live/busy semantics, while Clients detail retains section-level Suspense skeletons.                      |
| Responsiveness         | Employee list switches cards/table at md; receivables at lg; Clients uses a horizontally scrollable table. UI Table already has an overflow container. Do not impose a shared breakpoint without visual/data evidence.                                                                                                                                |
| Filters/pagination     | DataPagination already preserves filters, custom page parameters/IDs, lower-bound totals, translated controls and responsive page windows. Filters still use per-page wrappers and entity comboboxes. Preserve these query semantics.                                                                                                                 |
| Permissions/actions    | Clients detail and Operations gate actions/links by grants; ResourceReference links only when the caller supplies an authorized href. The Employee list's create link is rendered in its PageHeader; changing its permission policy is separate from presentation consolidation.                                                                      |
| Accessibility/keyboard | Shared notices use alert/status semantics; navigation and ResourceReference have focus styles; pagination labels are translated. Existing browser accessibility tests cover representative Office pages when OIDC is available. Screen-reader and full application verification remain gaps.                                                          |
| Translation/formatting | Sampled pages use next-intl and shared date/number formatting; all keys remain in parity. Preserve the distinction between server catalog access and the reduced client message payload.                                                                                                                                                              |
| Consolidation          | Existing shared patterns can replace literal markup without changing fetches, permission conditions, query handling or strings. Start with one semantic presentation responsibility rather than a generic page framework.                                                                                                                             |

Recommended first scope: **standardize the existing query/load error banners on Employee list and Operations work queue using ErrorNotice**. Four banners can reuse the established component; one Employee load-failure banner currently differs in padding. Users get consistent failure emphasis and density on two related Office list workflows, and the implementation stops duplicating the shared error treatment. The permission-denied, warning and success variants remain explicitly outside this first slice.

This is a small, evidence-backed starting point. Broader empty-state/table/filter/width consistency requires a later scoped decision and browser evidence, not an automatic rollout.

## F. Goal 09 execution plan

Exact first scope:

1. Read current source and record before screenshots/alert semantics for Employee query-error and load-error states and Operations work-queue query-error and load-error states.
2. Replace only those four inline destructive role-alert paragraphs with the existing ErrorNotice component, preserving predicates, translation calls, ordering and surrounding page content. Use the existing component's standard spacing deliberately; document the Employee p-4 to p-3 adjustment.
3. Keep ErrorNotice server-rendered and reuse its existing API. No new shared component, registry, wrapper framework or token system is justified. Change page-patterns.tsx only if a concrete, tested requirement cannot be met through its current children prop.
4. Add regression coverage for the four render conditions, exact localized text and role-alert semantics; verify adjacent filters/actions/results and successful states remain unchanged. Retain Goal 08's form regression suite when assessing shared presentation changes.
5. Capture after screenshots at 390px, 768px and 1440px in both locales. With isolated OIDC available, use existing Office browser fixtures and controlled test API failures/query errors. Never change production data or credentials. Without OIDC, use a scoped component fixture for markup/visual evidence and explicitly leave full-page authenticated screenshots/E2E unverified.
6. Check keyboard order and focus visibility around the alerts, screen-width overflow, semantic headings, role/live announcement behavior and axe. No new interactive control or focus movement is needed for passive route alerts.
7. Run architecture checks/tests, lint, typecheck, unit/integration, i18n, build, formatting and strict lint; refresh Graphify and create the next handoff.

Likely files: `app/(office)/employees/page.tsx`, `app/(office)/operations/worklist/page.tsx`, focused presentation/browser test fixtures and `docs/architecture/goal-09-to-goal-10.md`. Existing components to reuse: ErrorNotice, PageHeader, DataPagination, ResourceReference and UI primitives already present; no migrations or new dependencies.

Acceptance criteria: consistent standard destructive banner styling on those four paths; exact English/German text and conditions; alert semantics retained; unchanged data requests, authorization, routes, filters, pagination, actions and successful rendering; no new hydration boundary or horizontal overflow. Report screenshot/browser evidence at its actual scope.

Exclusions: changing permission-denied/success/warning notices, RHF server-error rendering, error/result contracts, empty states, list widths, table breakpoints, form fields, global Office shell/navigation, backend/API/database changes and an application-wide redesign. Goal 10 will address Office navigation and information architecture; do not implement it here.

## G. Copy-ready Goal 09 prompt

> Implement Goal 09 in woobble/care: shared frontend presentation patterns and UI consistency, starting with only the four existing query/load error banners on Employee list and Operations work queue. Read docs/architecture/goal-08-to-goal-09.md, architecture overview/module boundaries, frontend i18n docs, applicable AGENTS.md and relevant installed Next.js guides. Inspect current worktree, Graphify and actual shared presentation components; preserve unrelated changes. No multi-agent mode.
>
> Reuse ErrorNotice from apps/web/src/components/page-patterns.tsx for the two destructive query/load banners in app/(office)/employees/page.tsx and the two equivalent banners in app/(office)/operations/worklist/page.tsx. Preserve their predicates, translation calls, order, roles and surrounding content. Deliberately adopt the existing standard banner spacing and document the Employee load-error padding adjustment. Do not introduce a new design system, generic page framework, shared component or dependency without a demonstrated need.
>
> Preserve all API requests, authentication/tenant scoping, permission checks, resource-link visibility, route/query behavior, filters, pagination, actions, headings, keyboard order and successful states. Keep server components server-side and English/German text unchanged. Leave permission-denied, success/warning notices, RHFActionForm and Goal 08 result handling, empty states, widths, table breakpoints, other pages and global navigation outside this slice. No backend, API, generated-client, database or migration changes. Do not implement Goal 10.
>
> Add meaningful localized rendering/alert-condition regressions. Capture before/after screenshots for the affected error states at 390/768/1440px in both locales using isolated browser infrastructure where available, and check keyboard accessibility, focus visibility, overflow and axe. If OIDC/full application screenshots are unavailable, run scoped component checks and explicitly report the unverified authenticated page/E2E scope. Do not claim full-page verification from a fixture.
>
> Run architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, build, format:check, strict oxlint and applicable browser tests, including the Goal 08 isolated form regressions as relevant. Avoid concurrent commands that regenerate the API client. Refresh Graphify. Create mandatory docs/architecture/goal-09-to-goal-10.md with status/files/sizes, architectural decisions, exact verification/gaps, remaining presentation debt and an evidence-based self-contained Goal 10 plan/prompt. Goal 10 focuses on Office navigation and information architecture. Complete the implementation and handoff, reporting precise results and limitations.
