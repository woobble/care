# Accessibility audit — 2026-10-19

## Gate status

The audited browser states have **zero Axe violations tagged to WCAG 2.2 A or AA** after the corrections below. This is automated and sampled evidence, not a WCAG conformance assessment. Keep the accessibility release gate **Fail** pending an assistive-technology pass, an actual browser zoom or text-only scaling pass, and review of Axe's incomplete contrast checks.

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

## Remaining work and limits

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
