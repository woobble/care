# Structured clinical documentation

## Boundary and ownership

The `clinical_documentation` module owns typed measurements, structured observations, assessments, and risk assessments. Generic narrative notes remain in `care_documentation.entries`. Visit execution continues to own actual visit times and performed-service outcomes. Structured records do not determine whether a service was performed, change billing facts, or enter a service acknowledgement package.

Each record created in this slice belongs to the Care Documentation for one executed visit. The database links the clinical record to the same documentation and execution through tenant-qualified composite foreign keys. Client and visit identity come from the parent documentation and visit; clinical rows do not copy those identifiers. This makes a cross-client parent reference impossible without a separate, invalid parent link.

Client history is a bounded read projection over records linked to that client's visits. The current-risk view selects the latest applicable assessment per risk type; an expired latest assessment is not presented as current. A standalone client-owned record lifecycle is not introduced here. Such records need separate ownership, authorization, and correction rules instead of weakening the visit-documentation foreign key or inheriting its finalization lifecycle.

Office review shows visit-specific structured records read-only alongside the generic narrative entries. Client history remains the separate bounded view across visits.

## Record types

Measurements support `blood_pressure`, `pulse`, `temperature`, `weight`, `blood_glucose`, `oxygen_saturation`, and `respiratory_rate`. Blood pressure stores integer systolic and diastolic values in `mmHg`. Scalar decimal facts use PostgreSQL `numeric`, not binary floating point. Pulse and respiratory rate use integers. Values are validated structurally; unusual but representable measurements are not rejected as abnormal.

Stored units are explicit and stable: temperature uses Celsius (`Cel`), weight uses kilograms (`kg`), blood pressure uses `mmHg`, pulse uses `bpm`, respiratory rate uses `/min`, and oxygen saturation uses percent (`%`). Blood glucose accepts `mg/dL` or `mmol/L`; the entered value and unit are stored together without conversion. Locale does not choose a medical unit. UI labels may be localized, but codes and units are not translated in storage.

Structured observations use stable category and value codes for mobility, orientation, pain, skin, nutrition, hydration, elimination, sleep, mood, and general condition. Pain may carry a numeric 0–10 score and optional location. Other categories use a category-specific code. Optional notes supplement structured values; they do not replace them.

Assessments have a small internal type, optional result code or numeric score, assessment time, optional validity end, and optional note. They do not claim to implement a validated instrument. Risk assessments use `fall`, `pressure_ulcer`, `dehydration`, or `malnutrition`, with levels `none`, `low`, `moderate`, and `high`. These levels are application categories, not guideline scales.

All clinical event times (`measuredAt`, `observedAt`, or `assessedAt`) are separate from server record-creation time. API timestamps are instants; UI formatting uses the visit's timezone independently from locale. Backdated entry is allowed when the time is valid; future event times are rejected.

## Draft, finalization, and correction

Structured records are optional. A created record must be structurally valid before it is stored; no measurement or assessment is made mandatory for documentation finalization. Draft record edits and deletes use the parent Care Documentation version and a record version. They update the parent version in the same transaction, so they serialize with finalization.

Finalizing the parent freezes its structured records. Database triggers enforce the draft-only write rule as well as the application checks. A correction appends a replacement record with `correctsRecordId` and a reason. The original remains unchanged, and the correction relation is included in authorized history. Corrections do not change the finalized document version or service-evidence snapshot.

## Authorization and privacy

`clinical_documentation.read`, `create`, `update`, `review`, and `amend` are separate permissions. Caregiver writes require an active employee link plus an active visit assignment or recorded participation, including after the visit. Office history reads are filtered by the visit's client, organization, facility, and team scope before clinical values are returned. Caregiver history reads are limited to related visits. Tenant RLS is defense in depth and does not replace these resource checks.

Clinical values and notes appear only in authorized clinical detail and history responses. Audit and documentation-history metadata contain record IDs, kinds, changed-field names, and versions, never measurements, observation notes, assessment notes, or risk notes. Versioned outbox payloads use IDs and type metadata only. Clinical entries do not appear in broad worklists or the client timeline by default.

There is no automatic abnormal flag, diagnosis, triage, warning, alert, or clinical decision support. Medication administration, wound care, SIS, care planning, billing, and generic attachments remain separate future goals.
