# Care documentation and service evidence

Care documentation records what was documented about a visit and whether each performed service has supporting evidence. It is separate from the planned visit, the execution facts, and any future billing calculation.

## Ownership and lifecycle

`care_documentation` owns one `CareDocumentation` per executed visit, generic entries, service evidence, amendments, and an append-only history. It references the visit, execution, performed services, and employees through tenant-qualified foreign keys. Client and provider context are derived from the visit so the documentation record does not copy those facts.

Documentation can start during an in-progress execution. A draft may remain incomplete after execution ends. Execution completion depends only on execution facts; documentation finalization is a separate action and requires a completed execution.

The lifecycle is `draft → finalized`. A draft is edited with an expected version. Every successful mutation advances that version in the same transaction as its audit record, history row, and outbox event. A stale version returns `CARE_DOCUMENTATION_VERSION_CONFLICT`. Row locks serialize writes and finalization, so an edit that races finalization either commits before finalization or sees the finalized record and fails.

Finalized documents and their entries and evidence are immutable through both the API and database triggers. Office users with `care_documentation.amend` can append a reason and correction to a finalized document. Amendments do not rewrite the original, do not change its version, and are returned in creation order. Amendments and history are append-only.

## Execution boundary and evidence

Visit execution owns actual start/end times, performed-service status, actual quantity, performer, and any structured reason for a service outcome. Care documentation owns narrative notes, observations, deviations, incidents, and service evidence. Planned quantities and service snapshots remain on their existing planning and execution records.

Every performed service, including an unplanned service, needs a separate evidence record before finalization. Evidence can be updated while the document is a draft and is unique per document and performed service. The `documented` status records the evidence decision; its optional note supplies context. `not_required` is valid only for a service marked `not_performed` and requires an explanation. A non-performed service also needs its execution reason. A partial service needs either its execution reason or explanatory evidence text.

Completeness returns structured missing requirements, including missing evidence, missing non-performance reasons, and missing partial-service explanations. Finalization rejects incomplete documentation. Evidence never changes the performed-service outcome.

## Entries and incidents

Generic entries use `care_note`, `observation`, `deviation`, or `incident`. Entries retain employee attribution, occurrence time when supplied, and their narrative content. Incidents require an occurrence time and an operational severity classification (`low`, `moderate`, `high`, or `critical`). These labels are operational metadata, not a validated clinical severity scale. The module does not infer diagnoses or clinical conclusions.

Medication, wounds, vital signs, SIS, risk assessments, and care planning remain future specialized domains. They should attach typed records to clients, visits, executions, or documentation rather than using an untyped JSON catch-all.

## Authorization and worklists

Caregiver reads and mutations require an active employee link and a valid relationship to the visit through an active assignment or recorded participation. Creating documentation, editing a draft, and finalizing it use separate permissions. Office review uses `care_documentation.review` and follows the visit's client, organization, facility, and team scope. Amendments require the separate `care_documentation.amend` permission.

The Office worklist filters by client name, date, facility, employee, and documentation status, then removes rows outside the caller's resource scope before returning client or employee details. Client-name matching is bounded metadata search; note, observation, deviation, incident, and evidence text are never searched. Caregiver status queries return only visits related to the authenticated caregiver. Worklist DTOs expose missing requirement codes and IDs, never narrative snippets.

## Privacy and audit

Entries, evidence notes, and amendment text are sensitive care data. They are returned only from authorized visit/documentation detail endpoints. There is no full-text search. The client timeline includes only high-value summaries for incident recording, finalization, and amendment; it never includes narrative text.

Audit metadata, history metadata, and outbox payloads contain identifiers, entry types, changed field names, severity where relevant, and versions, but no note, observation, evidence, incident, or amendment text. Domain change, audit, history, and outbox writes share a transaction. The worker currently acknowledges or logs the versioned event types; it performs no external side effect.

All documentation tables use forced tenant RLS, tenant-qualified foreign keys, and tenant-first indexes. IDs generated by the application and migration use UUIDv7 under ADR 0009. API and database boundaries continue to accept any valid UUID for compatibility.

## Billing and signatures

This data is not a claim, invoice, price, benefit-consumption record, formal service signature, or client acknowledgement. Service evidence is a foundation for later workflows and does not assert a legally sufficient signature.
