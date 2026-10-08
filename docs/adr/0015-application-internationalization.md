# ADR 0015: Application internationalization with next-intl

- Status: Accepted
- Date: 2026-10-08

## Context

The authenticated Office and Caregiver application had user-facing German and English text embedded in pages, and locale-specific formatting was inconsistent. The product needs complete English and German presentation while keeping tenant data, domain values, and APIs stable. The application is still in early development, so a clean presentation boundary is preferred over retaining translated summary fields in APIs.

## Decision

Use `next-intl` with the Next.js App Router. English (`en`) is the default and canonical catalog; German (`de`) is the second supported locale. A validated `CARE_LOCALE` cookie stores the selected presentation language. Missing or invalid values resolve to English, and browser language does not override this deterministic default.

Keep authenticated routes locale neutral. Resolve locale centrally in the request configuration, provide messages at the root layout, and let a reusable language switcher update the cookie and refresh the current route. Use typed semantic message namespaces, shared formatting helpers, and presentation mappings for status, reason, audit action, and API error codes.

Keep API contracts, persisted domain values, user-entered content, and audit/event identifiers locale neutral. Client timeline responses expose stable action codes rather than translated summaries; the frontend translates those codes. The signed service evidence statement remains its existing immutable German snapshot.

## Consequences

Users can select English or German in both Office and Caregiver shells, and the cookie survives reload and navigation. Locale does not affect tenant context, resource routes, stored timestamps, or facility/organization timezone semantics. Catalog parity and a static JSX audit are checked by `bun run i18n:check`; locale, catalog, format, and mapping tests run with the web package tests.

When a locale is added, it must be registered centrally and provide a catalog with exactly the English message structure. Missing translations are prevented by repository checks instead of silently relying on production English fallback. Account-level locale storage can replace or supersede the cookie later without changing domain APIs.

## Alternatives considered

- Locale-prefixed routes: rejected because the authenticated product routes identify resources and workflows, not presentation language.
- Browser-language detection: rejected because English is the deterministic product default for new sessions.
- Localized API responses or stored enum labels: rejected because those values are consumed by domain logic, audit, events, and multiple clients.
- Persisting translated client timeline summaries: replaced with stable action codes so each presentation client can localize them.
- A second translation framework or translation service: rejected because `next-intl` covers the current server/client rendering needs without another runtime or workflow.
