# Frontend internationalization

The web application uses `next-intl` for application-owned text and supports English (`en`) and German (`de`). English is the canonical catalog and the deterministic default; German is the complete secondary catalog.

## Locale resolution and routes

Operational routes are locale neutral: `/clients`, `/planning`, `/care/today`, and related routes do not contain a locale prefix. Locale is presentation state and is independent of tenant selection and scheduling timezone.

The request locale is resolved in `apps/web/src/i18n/request.ts` from the `CARE_LOCALE` cookie. `apps/web/src/i18n/config.ts` validates the cookie against the supported locale tuple and returns English for a missing or invalid value. The application does not infer a locale from browser language. The language switcher writes the selected value through a Server Action, then refreshes the current route so Server Components render again. The cookie is HTTP-only, `SameSite=Lax`, scoped to `/`, secure in production, and expires after one year.

The locale is kept in a cookie rather than a user row so the presentation preference can later move to an account preference without coupling domain APIs to translation. Login, logout, Office, and Caregiver navigation leave the cookie intact.

## Next.js integration

`apps/web/next.config.ts` installs the `next-intl` plugin and points it at `src/i18n/request.ts`. The root layout resolves the locale and messages, sets the matching `<html lang>` value, and provides `NextIntlClientProvider`. Server Components use `getTranslations`; Client Components use `useTranslations`.

The locale configuration is the source of the `Locale` TypeScript type. Message types are derived from `messages/en.json`. Locale-specific navigation helpers and middleware are not used because the authenticated application does not have locale-prefixed routes.

## Catalogs and terminology

The catalogs are `apps/web/messages/en.json` and `apps/web/messages/de.json`. English is canonical. Messages use semantic namespaces for shared UI, navigation, authentication, administration, clients, employees, planning, visits, execution, care documentation, service evidence, audit, and errors.

Keep important terms consistent: _Client_ is _Klient/in_ in German, _Visit_ is _Einsatz_, _Service_ is _Leistung_, _Service planning_ is _Leistungsplanung_, _Care documentation_ is _Pflegedokumentation_ or _Dokumentation_ where context is clear, and _Service evidence_ is _Leistungsnachweis_. Tenant-entered organization, facility, service, client, and care-note content is displayed as stored.

To add or change a message, update the same semantic path in both catalogs. English wording should be concise and operational; German wording should use natural professional care terminology. Keep stable codes, enum values, routes, permissions, and event names out of the catalogs unless presenting a localized label for them.

Run `bun run i18n:check` to validate JSON parsing, key parity, and a practical scan of application TSX for likely hardcoded UI text. Run `bun run --filter @care/web test` for locale, catalog, formatting, and presentation-key tests. The parity test and command require exact English/German key structure; production does not silently substitute an untranslated English message for a missing German key.

## Formatting and data boundaries

Use the shared helpers in `apps/web/src/i18n/format.ts` for user-visible dates, date-times, times, numbers, and EUR values. Pass the active locale and the relevant scheduling timezone explicitly. Locale does not determine timezone. Form control values such as `datetime-local` use machine-compatible values and are not localized.

API responses and persisted values remain locale neutral. Statuses, reason codes, permissions, audit actions, and Problem Details codes stay stable; the presentation layer maps them to typed translation keys. Client timeline entries contain action codes and timestamps rather than translated summaries. User-entered content is not translated.

The service evidence acknowledgement statement is an immutable, versioned snapshot and remains in its existing German wording. Changing its wording requires a separate evidence-statement/version decision, not a catalog edit.

## Adding a supported locale

Add the locale once to `src/i18n/config.ts`, provide a complete catalog under `messages/`, include it in request configuration and provider typing, and keep catalog parity in the i18n check. Add or update locale-resolution and representative formatting tests. Do not add a locale prefix to operational routes or translate persisted/API domain values.
