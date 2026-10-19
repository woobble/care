# Accessibility audit — 2026-10-19

## Gate status

The latest Goal 15F gate is **Blocked**. The focused 151-scan rerun has zero WCAG 2.2 A/AA violations, and all 78 current incomplete contrast occurrences were inspected and measured where the rendered surfaces allowed it. Actual 200% browser zoom, text-only scaling, and screen-reader testing could not be performed in this headless environment. The Goal 15E audit below is retained as the earlier snapshot; Goal 15F's findings and exact manual reproduction steps are appended after it.

## Scope and method

Playwright runs Axe 4.14.0 with WCAG 2.2 A/AA and best-practice tags. No rules are disabled and no selectors are excluded. The expanded Office route matrix contains **139 scans**:

| Locale and theme | Rendered states                                                                             | Scans | Lowest evaluated text contrast | Axe contrast checks incomplete |
| ---------------- | ------------------------------------------------------------------------------------------- | ----: | -----------------------------: | -----------------------------: |
| English, light   | 18 Office routes at 390×844, 768×1024, 1440×900, 720×450, and 320×720; open appearance menu |    91 |                         4.50:1 |                             25 |
| German, light    | 15 representative Office routes at 390×844 and 1440×900                                     |    30 |                         4.50:1 |                             29 |
| English, dark    | 18 Office routes at 1440×900                                                                |    18 |                         5.32:1 |                             10 |

The 18 routes cover the dashboard, client search and profile, admission form, service agreement, scheduling, benefits, invoice review, claims, documents, operations worklist, tasks and deadlines, administration membership and scope editor, employees, services, and admissions. The German sample covers the first 15. The 720×450 viewport matches the available CSS viewport width of a 1440×900 desktop at 200% zoom; it is a reflow proxy, not an actual browser zoom or text-only scaling test. The 320 px pass is a narrow-viewport check.

An additional **19 scans** cover three visit-details dialog sizes, four recoverable settings errors, nine Caregiver states, and three Office open states (account menu, mobile navigation Sheet, and page-two German pagination). The dialog test checks Enter activation, focus wrapping, Escape, and focus return. The Caregiver flow covers the unlinked-account error, the Office user-link combobox results, Today, visit detail at 390×844 and 720×450, an in-progress visit, uncertain documentation submission, and both acknowledgement methods. The complete sampled set is **158 Axe scans**; each workflow test asserts that no WCAG-tagged violation is present.

The route and workflow tests also check keyboard traversal, visible focus, reduced motion, accessible names and labels, mobile overflow, and 24×24 CSS-pixel targets. The Caregiver journey uses touch actions on a Pixel 7 browser context. No screen reader was available: `orca`, `nvda`, and `accerciser` are not installed in the audit environment.

## Findings and corrections

The table records issues observed during the audit, their reproduction state, and the verified correction. Current scans no longer report these issues as WCAG failures.

| Criterion                             | Affected element and severity                                             | Reproduction                                                                                                                                                      | Correction and verification                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WCAG 2.5.3, Label in Name             | Office account-menu trigger; high, Axe serious                            | Open the account menu on an Office page and compare its accessible name with the visible initials and profile name.                                               | The accessible name now starts with the visible initials and includes the profile name. The account-menu route and open-state scans pass.                                                                                                                                                                                                      |
| WCAG 4.1.2, Name, Role, Value         | Office account menu; high, Axe serious                                    | Open the account menu and scan while the portal is active. Its modal behavior hid page content from assistive technology while leaving focusable controls behind. | Set the account dropdown to nonmodal behavior. The open account menu scan no longer reports `aria-hidden-focus`.                                                                                                                                                                                                                               |
| WCAG 4.1.2, Name, Role, Value         | Calendar visit event; high, Axe serious                                   | Scan the scheduling route and activate a visit event with Enter. The calendar library exposed an interactive wrapper around a nested link.                        | The wrapper is presentational and the event uses a native link. The visit-details dialog remains keyboard operable with focus wrapping, Escape dismissal, and focus return.                                                                                                                                                                    |
| WCAG 1.4.3, Contrast (Minimum)        | Primary actions and links while hovered; high, Axe serious                | Hover primary buttons, badges, and bubbles in the recoverable settings-error states.                                                                              | Use solid theme-specific hover tokens. All four error-state scans pass; Axe reports no contrast failures.                                                                                                                                                                                                                                      |
| WCAG 1.4.3, Contrast (Minimum)        | Dark destructive text in alerts and errors; high, Axe serious             | Render destructive status and alert content in the dark theme.                                                                                                    | Adjust the dark destructive token and foreground pairing. Dark route and error-state scans pass.                                                                                                                                                                                                                                               |
| WCAG 1.4.11, Non-text Contrast        | Caregiver signature-pad boundary; high, measured 1.35:1 before correction | Open the evidence acknowledgement form with “Draw a signature” selected at 390×844 and compare its dashed boundary with the background.                           | Move the global default border color into the base layer so component border utilities take effect, then use the primary token for the signature pad. The rendered screenshot sample now measures **7.39:1 at both the 10th percentile and median** across painted boundary pixels. The typed-name option remains available as an alternative. |
| No WCAG criterion (Axe best practice) | Async user-link popover name; moderate, Axe reported serious impact       | Open “Link an active user” on an employee page and inspect the search results popup.                                                                              | Give the popup the visible control label. The `aria-dialog-name` result is absent from the rerun.                                                                                                                                                                                                                                              |

Two moderate `region` best-practice results remain when the appearance menu and account menu are open. They have no WCAG success criterion and are not included in the A/AA failure count. The account menu and Sheet remain interactive menu/dialog patterns; keep these best-practice results visible in the raw reports rather than suppressing the rule.

## Rendered contrast evidence

Axe measured text contrast from the rendered states, with no contrast violations. Its lowest evaluated ratios were 4.50:1 in light mode and 5.32:1 in dark mode. It marked **64 route-matrix nodes** incomplete, plus one Caregiver combobox node and one Office Sheet node. Incomplete checks can include layered or otherwise indeterminate backgrounds and still need human review.

The Caregiver E2E captures rendered screenshots and samples actual pixels at the signature-pad boundary and acknowledgement button. At 390×844, the signature boundary measured 7.39:1 at the 10th percentile and median across 93 painted boundary samples; the submit-button fill measured 7.39:1 across 154 samples. A pixel sample includes antialiased edge pixels; the reported percentiles describe the sampled visible boundary/fill. Keyboard checks also verify a visible focus indicator, but the contrast of every focus ring and component boundary has not been measured.

## Goal 15E remaining work and limits

- Run a manual screen-reader pass through the tested Office and Caregiver workflows when a supported screen reader is available. The Playwright accessibility tree and Axe results do not replace this.
- Test actual 200% browser zoom or text-only scaling. The 720×450 viewport is only a geometry-equivalent reflow proxy.
- Review all 66 Axe-incomplete contrast nodes and sample non-text contrast for other component and focus states.
- Extend coverage to more routes, roles, locales, data states, overlays, loading and empty states. This audit is representative, not exhaustive.
- Keep the two non-WCAG `region` best-practice findings visible for review.

No WCAG conformance, certification, or production accessibility clearance is claimed.

## Reproduction

The isolated runner fixes synthetic service ports and uses `.env.test` only. From the repository root:

```bash
node --env-file=.env.test scripts/accessibility-e2e.mjs up
node --env-file=.env.test scripts/accessibility-e2e.mjs migrate
node --env-file=.env.test scripts/accessibility-e2e.mjs seed
node --env-file=.env.test scripts/accessibility-e2e.mjs e2e
node --env-file=.env.test scripts/accessibility-e2e.mjs down
```

The last command removes only the isolated `care-platform-e2e-goal15e-a11y` project and its disposable volumes. The full Authentik E2E suite passed **13/13** on the final run. The audit run used synthetic data and no production service contact was observed.

An earlier dependency-install command printed `.env.production` and `.env` filenames without variable values. Available output cannot establish whether that command performed automatic dotenv processing, so this report makes no broader claim about it. No production environment file was inspected for this audit.

## Goal 15F manual verification continuation — 2026-10-19

### Current contrast review

The focused rerun used the same 139-scan English/German light and English dark Office matrix, nine Caregiver states, and three Office open states. It completed **151 Axe scans** with zero WCAG 2.2 A/AA violations. The current detailed reports contain **78 incomplete contrast occurrences**: 76 in the Office route matrix, one Caregiver combobox search field, and one text line inside the Office mobile navigation Sheet.

| Axe incomplete reason             | Occurrences | Rendered foreground/background review                                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partially obscured                |          59 | The 57 Office route-matrix nodes measured 6.14:1–18.16:1 against their resolved solid surfaces. The Caregiver combobox text measured 13.07:1 after compositing its 30% input fill over the popover; its placeholder measured 4.71:1. The Office Sheet text measured 6.55:1. | All measured text exceeds 4.5:1. Client-profile navigation is horizontally scrollable; keyboard focus now scrolls each link into view, and a focused-ring check verifies visibility at 390 px and 1440 px. Remaining Axe incomplete statuses reflect clipped or layered rendering, not low contrast. |
| Overlapped                        |          14 | The computed foreground against each solid field surface measured 17.05:1–18.16:1. The scan contains synthetic entered values in the admission, service, and admin controls.                                                                                                | All measured text exceeds 4.5:1. The overlaps are layout relationships detected by Axe; they did not reduce the text/background contrast.                                                                                                                                                            |
| Partially overlaps other elements |           1 | The computed foreground against its resolved solid surface measured 11.86:1.                                                                                                                                                                                                | The rendered text exceeds 4.5:1; this is an Axe review prompt, not a contrast failure.                                                                                                                                                                                                               |
| Gradient background               |           4 | The two dark scheduling statistic cards use the same `145deg` gradient. Browser-rendered endpoint colors measured 14.70:1–14.84:1 for values and 7.04:1–7.11:1 for captions.                                                                                                | Both endpoints exceed 4.5:1 for normal text. These were calculated from the actual computed gradient stops and foreground colors.                                                                                                                                                                    |

The 15 nodes previously reported as “no value” were populated with synthetic values before the scans: 12 admission fields, two service fields, and one admin invitation email. The locale-specific admission fields were populated in both English and German. Axe evaluated the rendered text and no longer reports an empty-value contrast check.

The historic Goal 15E artifact retained the total **66** (64 route-matrix nodes, one Caregiver combobox node, and one Office Sheet node), but it did not retain those nodes' selectors or per-node diagnostics. A fresh, detailed rerun found 78 occurrences across the same matrix and focused states. Its current 78 occurrences are all dispositioned above; the lack of retained Goal 15E selectors means the old 66 cannot be mapped one-for-one to the new report. This evidence gap is recorded rather than treating the current count as an exact identity match.

### Non-text and focus contrast

The shared `--input` border token was too light. It now measures 3.40:1 on the light page background and 3.62:1 on light card/popover surfaces; dark-mode token ratios are 4.11:1, 3.76:1, and 3.60:1 on those corresponding surfaces. Rendered screenshot sampling of the admission form border measured 3.62:1 at the 10th percentile and median in light mode (133 samples), and 3.76:1 at the 10th percentile and median in dark mode (161 samples; 3.36:1 lowest sampled pixel). These exceed WCAG 2.2 AA's 3:1 non-text threshold.

Shared keyboard focus rings now use the solid theme ring token. The ring-to-surface token ratios are 3.97:1 on the light page background and 4.23:1 on light cards/popovers; dark mode measures 7.58:1, 6.93:1, and 6.64:1. The keyboard matrix checks focus visibility, and the client-profile navigation regression verifies that every focused link and its 2 px ring remain visible after focus-driven horizontal scrolling.

The Caregiver signature-pad boundary measured 6.94:1 at the 10th percentile and median over 154 rendered samples. The acknowledgement button fill measured 7.39:1 across 154 samples. Both exceed 3:1. The updated screenshot sampler samples the painted border against the field surface and avoids blending a 1 px border with its interior fill.

### Confirmed fixes

- Darker light/dark input-border token and full-strength shared input-border utilities make form boundaries visible.
- Shared focus-ring utilities use full-strength ring colors; destructive focus overrides also use solid destructive colors.
- The command search placeholder no longer applies 50% opacity; its measured contrast is 4.71:1.
- The client profile's horizontal section navigation scrolls the focused link into view. Horizontal padding and scroll margins preserve the 2 px focus ring.
- The office stylesheet's explicit field borders use the input token, including clickable operation cards and Caregiver evidence choices.
- The boundary sampler uses the actual computed border color and an adjacent rendered surface pixel, fixing the false low result caused by sampling above the input beside unrelated content.

### Zoom, text scaling, and screen-reader status

Actual 200% browser zoom and text-only scaling are **Blocked** by the available browser environment. `/usr/bin/chromium` is present, but the test browser runs headless. A Ctrl+Shift+= probe left `{dpr: 1, width: 1200, scale: 1}` unchanged; a Chrome zoom preference and extension probes also had no effect. This is not a successful zoom test. There is no supported visible browser session with safe input automation; `Xvfb`, `xvfb-run`, and `xdotool` are unavailable. The existing 720×450 viewport remains only a reflow proxy, and 390 px/320 px mobile viewport checks do not establish zoom conformance.

Screen-reader verification is **Blocked**. `orca`, `nvda`, and `accerciser` are not installed. Axe and the browser accessibility tree were not used as substitutes.

When a supported visible browser and screen reader are available, start the isolated `.env.test` stack from the repository root, run `migrate` and `seed`, then sign in to the synthetic Office account. Set browser zoom to 200% in its UI and repeat at text-only 200% where supported. At both 390×844 and 1440×900, inspect `/operations`, `/planning?date=<synthetic-date>`, `/benefits`, `/billing/invoices`, and `/administration/users/<synthetic-user-id>` for clipping, overflow, sticky obstruction, button visibility, dialogs, and form validation. In Caregiver, inspect Today, open the seeded visit, complete documentation, and test the signature and typed-name acknowledgement alternatives. Repeat the same routes with the screen reader: navigate landmarks/headings; search for a synthetic client; submit an invalid admission and hear error announcements; activate a scheduling event with Enter; check dialog focus wrap, Escape, and focus return; open/close the Sheet; and verify Caregiver visit state, acknowledgement, and administration scope names, roles, and states.

### `region` findings

Both remaining moderate Axe `region` best-practice findings were reproduced: one in the open appearance menu and one in the open account menu. Each targets the Radix `div[data-radix-popper-content-wrapper]` portal. The portals hold explicitly semantic menu content (`menu`/`menuitemradio` for appearance and the account menu actions), with their own keyboard interaction; the findings have no WCAG success criterion. They are intentionally portalled interactive menus rather than unlandmarked page content, so no redundant `region` landmark was added. The best-practice findings remain visible in the raw scans.

### Regression and gate

The final focused regressions passed the 139-scan keyboard matrix (**1/1**, 2.5 minutes) and the Caregiver evidence and Office shell journeys (**2/2**, 46.1 seconds). The keyboard matrix now enters synthetic values into the previously empty fields before Axe runs. The two commands were:

```bash
node --env-file=.env.test scripts/accessibility-e2e.mjs e2e \
  apps/web/e2e/accessibility-keyboard.spec.ts
node --env-file=.env.test scripts/accessibility-e2e.mjs e2e \
  apps/web/e2e/office-shell.spec.ts \
  apps/web/e2e/care-delivery-evidence.spec.ts
```

The fresh keyboard report contains one moderate `region` occurrence in the appearance menu; the Office open-state report contains the account-menu `region`; the Caregiver report has no violation. There were no WCAG-tagged violations. The full 13-test Authentik result and repository quality gates are listed below.

| Accessibility gate | **Blocked** | Contrast review and focused regression pass. Actual 200% browser zoom, text-only scaling, and screen-reader workflows remain unverified because the required environment is unavailable. Historical Goal 15E target identities were not retained, so the old count cannot be mapped one-for-one to the refreshed observations. No WCAG conformance or certification is claimed. |

The full Authentik E2E suite passed **13/13 tests in 8.1 minutes** after the shared UI changes. Root quality gates passed: `bun run lint` (33/33 packages), `bun run format:check` (710 files), `bun run i18n:check` (3,585 messages), `bun run typecheck` (33/33 packages), `bun run test` (51/51 tasks), and `bun run build` (32/32 tasks, including OpenAPI and API-client generation). `bun run build` ran with the repository's `NODE_ENV=test` setting; the environment-selection tests also passed without loading production configuration. Graphify refreshed the graph to 12,700 nodes and 38,369 edges.

The isolated test project is `care-platform-e2e-goal15e-a11y`; use `.env.test` only. Its Compose cleanup removes only that project and disposable volumes. Other Compose projects remain untouched, and no production services, credentials, or `.env.production` were accessed.
