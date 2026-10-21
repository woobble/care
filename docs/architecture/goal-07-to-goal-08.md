# Goal 07 → Goal 08 handoff

## A. Implementation summary

**Goal 07 status: Complete**, with browser E2E, screenshot comparison and browser accessibility unverified because isolated OIDC discovery is unavailable. Goal 08 and Goal 09 are preparation only.

Clients now owns its personal-data editing form, form field helpers, profile overview, profile section navigation and update Server Action. There is one active implementation of each extracted responsibility. No framework, dependencies, routes, backend changes, migrations, public API changes or UI redesign were introduced.

```text
apps/web/src/features/clients/
├── actions/update-client.ts
├── components/
│   ├── client-form-fields.tsx
│   ├── client-personal-data-form.tsx
│   ├── client-profile-overview.tsx
│   └── client-profile-section-nav.tsx
├── lib/client-form-data.ts
└── clients.test.ts
```

Created: the seven files above, `apps/web/scripts/check-i18n.test.ts` and this handoff. The overview and navigation files moved from `apps/web/src/components/`; the old files were removed after checking all consumers. Their contents are byte-identical to the originals.

Changed:

- `apps/web/src/app/(office)/clients/[id]/page.tsx`: imports feature components/helpers and renders the personal-data form under its existing `canUpdateClient` condition.
- `apps/web/src/app/(office)/clients/new/page.tsx`: reuses feature field helpers, retaining its autocomplete attributes and empty select defaults.
- `apps/web/src/app/(office)/clients/actions.ts`: imports the existing parsing/navigation/cache helpers from the feature and delegates its compatibility update action to the feature implementation. All other action bodies remain unchanged.
- `apps/web/scripts/check-i18n.ts`: also traverses `src/features`, with the same text-detection rules; updates the diagnostic directory description.
- `apps/web/package.json`: includes `src/features` and `scripts` in the existing Bun test command.
- Ignored local Graphify artifacts: refreshed through AST-only `graphify update .`.

The route still owns async route/search parameters, initial client loading, permission composition, not-found behavior, navigation/section anchors, route errors and Suspense composition. The overview retains its existing internal Suspense cards and server reads. The form receives a generated `ClientResponseDto`; it does not reconstruct route or permission context or fetch the client again.

Sizes below count newline-delimited lines and UTF-8 bytes in the actual worktree, relative to HEAD before extraction:

| File                              | Before lines / bytes | After lines / bytes |
| --------------------------------- | -------------------: | ------------------: |
| Clients detail route              |      2,860 / 116,835 |     2,684 / 111,205 |
| Clients route actions             |         566 / 22,592 |        512 / 20,605 |
| Profile overview, moved           |         578 / 20,181 |        578 / 20,181 |
| Profile section navigation, moved |             27 / 716 |            27 / 716 |
| Feature personal-data form        |                    — |         112 / 3,889 |
| Feature form fields               |                    — |          85 / 1,775 |
| Feature update action             |                    — |          41 / 1,413 |
| Feature form-data helpers         |                    — |          49 / 1,618 |
| Feature tests                     |                    — |        452 / 16,127 |
| i18n scanner                      |          113 / 4,501 |         115 / 4,573 |
| i18n scanner regression test      |                    — |          35 / 1,410 |
| Web package manifest              |           48 / 1,419 |          48 / 1,440 |

The line reduction is deliberately limited to a coherent first feature slice.

## B. Architectural decisions

Dependency direction is route → Clients feature → shared UI/API client/utilities. Feature files never import a route. Direct imports avoid a barrel that could mix server and client dependencies.

`ClientPersonalDataForm` is an async Server Component using `getTranslations` and the existing client-side `RHFActionForm`. Rendered children and the Server Action reference cross the existing RHF boundary. `ClientProfileOverview` remains server-side, retaining its authenticated tenant-scoped reads, permission checks, provider lookups, redaction/unavailable labels, resource links, date formatting and two Suspense cards. No requests were added or moved to the browser.

Only `ClientProfileSectionNav` has `use client` among the feature components. Its descendants, ARIA label, class name and focus-capture scrolling are unchanged. The route still supplies permission-filtered links and anchors. The production client-reference manifest includes only this unchanged navigation module from the feature; form/overview/action-helper implementations are absent from the client module list. This verifies module placement, not a measured before/after download-size comparison.

`update-client.ts` retains `use server`, `updateClientAction(FormData): Promise<boolean | void>` and the original implementation. It uses the same authenticated `getApiClient` and `getTenantHeader`; backend authorization remains authoritative. Invalid IDs redirect before the API call, blank names return false, API errors return false, successful updates revalidate `/clients` then `/clients/{id}` and redirect afterwards. Redirect signals are not caught. Optional text/date fields still trim to null when missing, empty or non-string. Invalid/empty enum choices still become null. Date parsing has deliberately not become stricter.

The route's `use server` module exports a thin **async compatibility wrapper**. A direct named re-export was rejected by the installed Next.js production compiler with “Only async functions are allowed to be exported in a use server file”; the wrapper passes the production build. Existing callers can keep their route action import. New feature components import the feature implementation directly.

Existing parsing, ID, URL and revalidation helpers live in `lib/client-form-data.ts` and are shared with the remaining route actions; their implementations are unchanged. This module imports Next server APIs and must remain outside client imports. It is not a new validation/result abstraction.

`TextField` and `SelectField` are feature-owned because their consumers are Clients forms. They still wrap `@care/ui` Input, Label and NativeSelect; RHFActionForm remains shared. The unrelated definition-list `Field`, contact/address/date/enum presentation helpers and remaining section helpers stay in the route. Creation reuses TextField under its existing Field import alias and shares SelectField. TextField gained an optional autocomplete prop; SelectField's value prop is optional with the creation default of an empty string. Editing still passes its explicit defaults and constraints. The creation page's JSX is unchanged; its duplicate local wrappers were removed.

## C. Verification results

| Exact command                                                                                                                   | Final result                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `bun run architecture:check`                                                                                                    | Pass: 159 existing violations; zero new or resolved baseline entries                                   |
| `bun run architecture:test`                                                                                                     | Pass: 15 tests / 33 assertions                                                                         |
| `bun run lint`                                                                                                                  | Pass: 33 workspace tasks                                                                               |
| `bun run typecheck`                                                                                                             | Pass: 33 workspace tasks                                                                               |
| `bun run test`                                                                                                                  | Pass: 51 Turbo tasks; web 23 tests / 396 assertions                                                    |
| `bun run i18n:check`                                                                                                            | Pass: 3,585 catalog keys in parity; no static JSX UI text found                                        |
| `bun run build`                                                                                                                 | Pass: OpenAPI generation and 32 build tasks                                                            |
| `bun run test:integration`                                                                                                      | Pass: 32 tasks; API 7 tests / 1,566 assertions; worker 3 / 13; database/RLS 5 / 80                     |
| `bun test apps/web/src/features/clients apps/web/scripts/check-i18n.test.ts`                                                    | Pass: 11 tests / 334 assertions                                                                        |
| `bun run --filter @care/web typecheck`                                                                                          | Initial test used ES2023 findLast under ES2022; corrected to reverse/find; final root typecheck passes |
| `bunx oxlint --fix`                                                                                                             | Pass                                                                                                   |
| `bunx oxfmt --config oxfmt.json . '!apps/web/test-results/**' '!apps/api/openapi.json' '!packages/api-client/src/generated/**'` | Pass                                                                                                   |
| `bun run format:check`                                                                                                          | Pass                                                                                                   |
| `bunx oxlint --deny-warnings --format=agent`                                                                                    | Pass                                                                                                   |
| `graphify update .`                                                                                                             | Pass: AST-only; 13,029 nodes / 39,479 edges / 701 communities; zero API cost                           |

Turbo reuses unchanged workspace results. Local execution logs are in `/tmp/care-goal07/`; these temporary logs are not repository artifacts.

Focused tests cover field names/IDs/defaults, labels/required indicators, options, nullable and file inputs, exact update payloads, existing permissive date handling, malformed IDs, blank/missing required names, API failure outcomes, tenant context, authentication redirect propagation, revalidation ordering, route compatibility, create omission versus update null behavior, permission-dependent overview requests/links, both locale catalogs, component boundaries, anchor composition and focus-triggered scrolling. These are Bun tests using mocked request/Next/translation boundaries and React element inspection. RHF hooks and DOM hydration are not exercised by these unit tests.

The scanner regression runs a copied scanner against an isolated temporary directory with nested `src/features/clients/components` JSX. It proves feature traversal catches untranslated text without writing fixtures into the live source tree. An initial live-tree fixture raced concurrent lint/typecheck; moving the fixture outside the worktree resolved both failures. A source boundary assertion was also made independent of formatter whitespace. No production behavior was changed to satisfy tests.

Additional read-only extraction audit (`bun /tmp/care-goal07/verify-extraction.ts`): original and moved overview/navigation bytes match; all 32 original action/helper function ASTs match their current owning implementations; field helper JSX matches apart from the added optional autocomplete attribute; creation page and personal-data JSX match; all 26 remaining route function ASTs match after substituting the extracted JSX at its call site. The comparison ignores source positions, redundant parentheses and multiline JSX indentation. It verifies markup/constraints/defaults, payloads, cache calls and permission composition without claiming browser rendering evidence.

`git diff --exit-code -- apps/api modules packages/api-client` passes after `bun run build`: backend, public OpenAPI and generated client output are unchanged. The App Router file set is unchanged. Architecture validation reports no new violations or dependency cycles; the baseline is untouched.

Browser E2E was not started: a bounded read-only request to `.env.test`'s configured OIDC discovery endpoint failed with no response. Existing `authentik-client.spec.ts` exercises Client creation/locales, and `accessibility-keyboard.spec.ts` exercises the client profile at responsive widths, keyboard navigation and accessibility. They require isolated OIDC and the test application stack. Live editing, browser unsaved-change prompts, hydrated keyboard behavior, axe results and screenshots remain unverified in this environment. Preserved JSX and byte-identical navigation provide structural evidence only. There is no separate frontend integration runner beyond the Bun tests, production Next build and Playwright workflows; the existing backend Clients integration also passed.

Graphify refreshed the code graph and generated the aggregated HTML for its >5,000-node graph. Community changes used hub-derived fallback labels (129 communities renamed); semantic doc extraction/relabeling is outside this AST-only refresh.

## D. Remaining frontend technical debt

Confirmed:

- The 2,684-line Clients detail route still contains address/contact/insurance/Pflegegrad, provider/routing/preferences forms, documents, visits, admission history, timeline, lookups and display helpers. These stay outside this pilot.
- Remaining Clients actions and representative Employee, Planning and Administration actions manually parse FormData with inconsistent failure contracts. Client creation omits empty optional fields; personal-data update sends null. Delete/state actions generally redirect rather than return inline failures.
- Creation/editing now share feature-owned field wrappers while preserving different autocomplete/default props. Other Office forms still repeat similar wrappers. A global field abstraction is a possible later improvement, not a requirement proved by duplication alone.
- RHFActionForm accepts void/boolean/string results, derives Zod rules from mounted controls, displays a global failure notice and a validation summary, and decorates invalid controls with ARIA references. Server failures do not carry typed field errors. It treats any boolean except false as success, and a string as failure; callers may have distinct contracts.
- Existing Web/backend imports remain: `auth.ts` imports Database/Identity for its explicit auth adapter exception; Planning imports `@care/scheduling`; agreement field/cost components import `@module/services/domain/service-price`. The architecture baseline already records the non-exempt direction debt. No new backend dependency was introduced.
- Browser accessibility and visual verification are outstanding because OIDC is unavailable. Catalog parity and the expanded static scan pass; no confirmed translation regression was found. The scan is heuristic, not proof of complete dynamic key/text coverage.

Possible improvements, not implemented: typed server field-error mapping, a stable translated error vocabulary, smaller domain-section components and shared presentation patterns. Do not interpret these as permission to redesign the page or standardize all Office forms at once.

## E. Goal 08 preparation

Inspected `components/rhf-action-form.tsx`, Clients feature/route actions and new/detail forms, Employee actions, Planning actions, Administration actions, `lib/api.ts`, `i18n/errors.ts`, generated API-client adapter/types, i18n tests and the existing browser workflows.

1. **Return types:** RHFActionForm's ServerAction accepts `void | boolean | string` synchronously or asynchronously. Clients create/update generally return false or redirect; deletes/state commands return void via redirects. Employee create/update use `void | boolean`; Planning's move action uses `{ ok: boolean; errorCode?: string }` while its other actions redirect. These consumers cannot all adopt one contract immediately.
2. **Validation errors:** Clients currently returns false for blank names and redirects for invalid IDs. RHF derives a permissive `z.record(z.string(), z.unknown())` schema with field refinements from required/type/min/max/length/choice constraints. Its local validation errors already have field paths/messages; server errors do not.
3. **API errors:** the generated client adapter supplies typed `{ data, error }` results. Clients update collapses API errors to false; redirect-style forms encode API error codes in query strings. `i18n/errors.ts` maps known codes to translation keys for route error presentation. Do not expose raw Problem Details or arbitrary backend strings as user text.
4. **Display:** RHF renders pending status, disables its fieldset, shows action failures in a role-alert notice and client validation in FieldError. It focuses the first visible invalid control after validation, sets aria-invalid/aria-describedby and preserves unsaved-change warnings. Generic server failures use the supplied translated errorMessage. RHF catches ordinary thrown errors but rethrows Next redirect signals.
5. **Cache/redirect:** update's success sequence is PATCH → revalidate list → revalidate detail → redirect detail. Errors do not invalidate. The compatibility wrapper returns the feature promise without catching signals. Other actions invalidate different route sets and use query/hash destinations.
6. **Parsing:** exact helpers in `features/clients/lib/client-form-data.ts` implement trim, null conversion, enum lookup, UUID validation and redirect-on-invalid-ID. Date fields are nullable strings rather than validated calendar dates. Create uses conditional spreads; update uses explicit nulls. FormData may contain File, duplicate keys and action metadata; `get` currently takes the first entry.
7. **Create/update/delete:** create additionally requires provider UUIDs and optionally builds an address, then redirects to the created resource. Update requires an existing client ID and sends all personal-data fields. Deletes are separate child-resource commands with different identifiers and redirect errors. Do not silently change omission, null or redirect contracts while migrating.
8. **Existing primitives:** Zod, zodResolver, react-hook-form, RHFActionForm, RHFInputField/RHFSelectField/RHFTextareaField, native constraint discovery, FieldError, translated Common.formValidation messages, `errorMessageKey`, generated request/error types and existing API authentication/tenant utilities. Reuse these rather than adding a form library. The feature currently has no new personal-data Zod schema.
9. **Compatibility risks:** changing async Server Action exports, FormData signatures, native field discovery, default/control ownership, optional/null/date semantics, redirect handling, permission/API boundaries, locale message delivery, caller result expectations and refresh timing. Structured field-error results must not be mistaken for success by existing RHF logic.
10. **Smallest useful slice:** Clients personal-data update only, with a feature-owned parser/schema and typed error result plus an opt-in RHF integration. Maintain the route action import and legacy callers. Do not migrate create/delete or Planning in the same step.

## F. Goal 08 implementation plan

First scope: give the extracted Clients personal-data update form a typed validation/failure contract and field/global feedback while preserving successful navigation and current accepted values. Keep the user-facing form, fields and permissions unchanged.

Likely files:

- `features/clients/actions/update-client.ts`
- New `features/clients/lib/client-personal-data-validation.ts` and a focused test
- New feature-local result/error types if useful, without a barrel hierarchy
- `features/clients/components/client-personal-data-form.tsx`
- `features/clients/clients.test.ts`
- `components/rhf-action-form.tsx` for a narrowly opt-in structured result handler, with independent legacy-contract tests
- `app/(office)/clients/actions.ts` if the old entry point needs a result adapter
- English/German catalogs and focused browser tests only where new validation text/behavior requires them

Recommended types: a literal tuple of personal-data field names, a normalized input type derived from the generated update DTO where practical, serializable field errors keyed to that tuple and a small discriminated result such as `{ status: 'error'; fieldErrors?: Partial<Record<ClientPersonalDataField, ValidationMessageKey[]>>; formError?: ActionErrorKey }`. Decide whether an explicit success result is useful for nonredirecting consumers; this action's success currently redirects and needs no success object. These are recommendations, not types introduced by Goal 07. Keep ID/auth redirects outside recoverable field validation and retain API authority. Use typed message keys/codes rather than transporting translated request-locale strings or raw exceptions.

Incremental sequence:

1. Record accepted/rejected current FormData cases, including missing/empty/File values, invalid IDs, enum nulls and permissive date behavior. Define intentional validation policy changes separately; a schema alone does not authorize stricter rules.
2. Implement a feature-local pure parser/schema using existing Zod and generated types, preserving the input/output behavior agreed for this slice. Keep authentication, tenant header and API endpoint/payload in the action.
3. Add structured validation/API failure results for the new form path. Retain a compatible route adapter returning false for recoverable errors if existing callers require the old signature/contract. Do not catch redirect exceptions.
4. Add an opt-in structured-result path in RHFActionForm, preserving all existing void/boolean/string callers. Map field errors through RHF setError, keep the global alert/summary and focus semantics, clear stale errors on changes and prevent erroneous refresh/success behavior on failure.
5. Connect only ClientPersonalDataForm. Update both catalogs if introducing messages, keep native fields and default values intact and preserve pending/unsaved behavior.
6. Test parser cases, API errors versus validation errors, authentication/tenant isolation, exact PATCH null/omission behavior, wrapper compatibility, legacy RHF results, field/global announcements, focus, retry, pending state, unsaved prompts, locales and redirects/revalidation. Run Clients creation and detail regressions too.
7. Run architecture, lint, typecheck, unit/integration, i18n, build, format and strict lint gates; run the isolated browser workflows when available and report any gap. Refresh Graphify and create the mandatory next handoff.

Explicit exclusions: global action migration, new form libraries/frameworks, stricter backend rules or API changes, create/delete/other Clients section rewrites, Planning/Employee/Administration migrations, schema/migration changes, routing/auth redesign and presentation redesign. Goal 09 owns shared frontend presentation patterns and UI consistency.

## G. Copy-ready Goal 08 prompt

> Implement Goal 08 in woobble/care: standardize frontend form validation and Server Action results, starting only with the Clients personal-data update form extracted in Goal 07. Read docs/architecture/goal-07-to-goal-08.md, architecture overview/module boundaries, Clients domain and frontend i18n docs, applicable AGENTS.md and the installed Next.js form/server-boundary guides. Inspect the current worktree and Graphify first; preserve unrelated changes. Do not use multi-agent mode.
>
> Implement a small feature-owned typed validation/parser and serializable action-failure result contract in apps/web/src/features/clients. Reuse Zod, react-hook-form, RHFActionForm, shared UI and generated API types. Add opt-in structured field/global error integration to RHFActionForm while preserving all legacy void/boolean/string consumers. Do not introduce a new form library, framework or global migration. Keep the route-level updateClientAction import compatible through its async wrapper/adapter.
>
> Preserve current fields/IDs/defaults/control behavior, accepted FormData values, trimming, optional/null/omitted distinctions, enum and date semantics, PATCH endpoint/payload, authentication, tenant scoping and backend authorization. Keep invalid-ID/auth redirects and successful list/detail revalidation then detail redirect; never swallow Next redirect signals. Do not tighten validation silently. Keep server access server-side, existing Suspense composition, route/permission ownership, English/German messages, pending/unsaved behavior and accessible errors/focus. Map API failures through a typed translated vocabulary rather than raw backend text.
>
> Add meaningful parser/action/component and legacy-result compatibility tests, including field/global failures, API errors, tenant/auth behavior, retry, creation compatibility, locales, focus and redirect/revalidation ordering. Run architecture:check, architecture:test, lint, typecheck, test, test:integration, i18n:check, build, format:check and strict oxlint; run isolated Clients/browser accessibility workflows if available, otherwise explicitly report blockers. Refresh Graphify. No backend, API, database, route, unrelated action or UI redesign changes; do not implement Goal 09.
>
> Create mandatory docs/architecture/goal-08-to-goal-09.md with implementation/ownership, exact verification and gaps, remaining validation/result debt, compatibility risks and a concrete self-contained Goal 09 plan/prompt. Goal 09 focuses on shared frontend presentation patterns and UI consistency. Complete the actual implementation and handoff; report precise results and limitations.
