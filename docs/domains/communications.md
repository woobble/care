# Client communications

The `communications` module owns interaction history, attributed amendments, and client communication preferences. Clients remains authoritative for client identities, contact records, relationship types, roles, and representation data. Operations remains authoritative for follow-up task state, assignment, due dates, and activity.

## Interaction vocabulary

Interactions are append-oriented records with an author, occurrence time, and optimistic version. Their stable API and database codes are:

| Field     | Supported codes                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direction | `inbound`, `outbound`, `internal`                                                                                                                                                                       |
| Channel   | `phone`, `in_person`, `email`, `letter`, `portal`, `other`                                                                                                                                              |
| Category  | `general_inquiry`, `appointment_coordination`, `cancellation_rescheduling`, `service_request`, `service_agreement`, `documentation`, `billing_payment`, `benefits_payer`, `complaint_feedback`, `other` |
| Outcome   | `information_provided`, `request_received`, `action_required`, `appointment_agreed`, `no_answer`, `resolved`, `other`                                                                                   |

Channel and direction describe a recorded interaction. They do not mean the application placed a call or sent an email, letter, or message. A category or outcome is a classification, not a separate case lifecycle.

## Contacts, authority, and preferences

Communications reuses client contacts. Relationship types are `daughter`, `son`, `spouse`, `relative`, `legal_representative`, `guardian`, and `other`. Contact roles are `primary_contact`, `emergency_contact`, `legal_representative`, `authorized_contact`, and `invoice_recipient`. External callers who are not stored contacts can be attributed with a short `contactLabel`; this is an unverified snapshot and does not create a permanent contact.

At recording time, the interaction snapshots the contact label and authority basis. A current representation record with a `legal_representative` role yields `legal_representative`; the explicit `authorized_contact` role yields `authorized_contact`. Other relationships, including primary, emergency, family, or relative, yield `not_confirmed` unless an authority role also applies. The snapshot preserves what the system knew when the interaction was recorded; it does not establish a legal finding or disclose protected details to the contact.

Preferences store a preferred channel, language, contact, contact times, correspondence mode (`unspecified`, `postal`, or `electronic`), and contact restrictions. A preferred contact may still have `contactAuthorization: not_confirmed`; preference is not authority. Preferences do not imply marketing consent or permission to disclose client information.

There is no consent-management model in this module. The preferences API explicitly returns `consentStatus: "unknown"`, and the Office form labels that status as unknown/not recorded. The status remains unknown here even if evidence exists in another process; staff must use the applicable authorization records and privacy rules before disclosure. Missing contact authority is represented separately as `not_confirmed` on the interaction snapshot.

## Source records and follow-up

An interaction may link to one typed source: `visit`, `service_agreement`, `operations_task`, `invoice`, `claim`, or `document`. Communications validates tenant, client, and the caller's permission for that source before storing it. A link records context only; it does not change Scheduling, agreements, Billing, Claims, or Documents.

Follow-up tasks are created and managed through Operations with source type `communication`. Operations validates the interaction and client relationship, emits task audit/outbox events, and remains the only owner of task lifecycle. Communications reads one grouped, tenant-qualified status projection per interaction for the global list and up to three open task details for the client overview. It does not return task detail rows in the global list, create task state, or duplicate Operations activity. Task details and changes continue through Operations APIs.

## Corrections, access, and audit

Corrections require an expected version and a reason. Each update stores the full superseded snapshot, author, and time in an immutable amendment row before advancing the current interaction. Conditional version updates prevent concurrent changes from silently overwriting one another.

Reading history requires both `communications.read` and `client.read` in the caller's client scope. Recording requires `communications.create`; editing and amendment require `communications.update` and `communications.amend`; preference changes require `communications.preferences.manage`. Task details are included only when the caller also has `operations.read`. Source IDs are exposed only when the caller has the corresponding source permission. All tables have forced tenant RLS and tenant-qualified client/contact references.

Interaction and preference changes write audit records and versioned outbox events in the same transaction. Narratives, contact details, restrictions, and preference values are not copied into generic audit or outbox metadata. The global Office view is server-paginated, uses deterministic chronological ordering, and supports client, provider scope, channel, direction, category, outcome, date, recorder, and follow-up filters.

## Non-goals and known limitations

This module does not provide telephony, call recording, email sending or synchronization, SMS/WhatsApp, push notifications, campaigns, automated messaging, a CRM pipeline, a client portal, AI summaries, transcription, clinical documentation, or a generic consent platform. Recording `email` or `phone` only describes an interaction staff report having taken place.

Consent is not captured or verified; its API status is always `unknown`. External `contactLabel` values are unverified. Authority is derived from the current Clients roles and stored representation dates, then kept as an interaction-time snapshot; corrections are needed if that historical attribution was wrong. Contact restrictions and preferred times are staff-entered text, not enforced delivery controls. Search matches subject and summary text with bounded database queries, not a full-text index. There are no automatic follow-up tasks, reminders, or scheduled reconciliation; staff use the Operations worklist to handle tasks.
