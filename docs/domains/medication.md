# Medication management and administration

The medication module owns a tenant-local medication catalog, client medication orders, scheduled occurrences, finalized administration records, and append-only corrections. It is separate from Care Planning, Clinical Documentation, Visit Execution, and billing. A medication order records instructions from a documented source; an administration record records what a caregiver documented during an assigned visit.

This is not a prescribing or dispensing system. Catalog entries are local labels, not verified pharmaceutical data. The platform does not assess clinical suitability, infer interactions or contraindications, recommend doses or substitutions, or decide that medication should be withheld. Creating an order in the platform does not issue a legal prescription.

## Definitions and orders

Definitions are tenant scoped and can be activated or archived. They contain stable form and route codes, with optional ingredient, strength, manufacturer, and external code. They do not infer facts from a name. An order revision snapshots the definition fields that explain the medication historically, so later catalog edits do not rewrite the order.

An order starts as a draft. Activation requires a source reference and an active definition. Active orders can be paused, resumed, revised, or discontinued. Each lifecycle change or edit appends an immutable revision and advances the order version. Mutations use an expected version and serialize on the order row. Discontinued orders are terminal.

Dose amount is a positive decimal stored to three fractional places; dose unit, route, and schedule are structured fields. Strength describes the catalog item and is separate from the ordered quantity. The system does not convert between them.

## Scheduling and due occurrences

Schedules are fixed local times, elapsed intervals from an explicit UTC anchor, or as-needed (PRN). Fixed times use the client's facility timezone, falling back to its organization timezone. Repeated DST times resolve to the earlier instant; nonexistent local times move forward by the DST gap. Interval schedules are elapsed durations and do not reset to wall-clock times.

Scheduled occurrences are persisted only when a bounded client-history or assigned-visit read needs them. Client history accepts ranges no more than 30 days apart; an assigned visit projects a small local-date window and returns that visit's local date. Generation is idempotent, with a unique key per tenant, order revision, and scheduled instant. An order edit or pause/discontinuation cancels only pending occurrences for the old active version; recorded history and old revisions remain.

An occurrence is not an administration. A past pending occurrence is shown as “Overdue / not documented”; the system does not infer a missed dose or an omission. PRN orders produce no scheduled occurrences. They require a recorded administration reason and enforce any configured maximum dose, maximum count in a frequency window, or minimum interval.

## Administration and corrections

Caregivers can record `administered`, `not_administered`, `refused`, or `withheld` for a due occurrence or a permitted PRN order. A finalized record references the exact order revision, client, visit, occurrence when scheduled, employee, ordered dose, outcome, and server capture time. In this initial workflow an administered quantity must match the ordered quantity and unit. Other outcomes require a reason code and cannot claim an actual dose. A reason or note is documentation only; the system does not make a clinical decision from it.

Recording requires an active visit assignment for the user's linked active employee, a non-cancelled visit for the same client, the active order version, an in-validity occurrence, and a passing competency check. The server records the current time; backdated administration is not supported.

Finalized records cannot be updated or deleted. An authorized correction appends a versioned record with the correcting employee, time, and required reason. The original remains available, and history presents the latest correction alongside the correction chain. Corrections serialize on the owning order row to prevent duplicate correction versions.

Medication administration remains independent of performed services and Care Documentation. Recording one does not mark the other complete or copy the medication facts into generic care notes.

## Medication reconciliation

A reconciliation documents medication information reported by external sources and compares it with the internal plan. It does not prescribe or decide which instruction is clinically correct. Each reconciliation starts in `draft`; comparison moves it to `in_review`. An unfinished record may be cancelled. Completion is available only from review and requires a current comparison, a disposition for each actionable discrepancy, no unresolved clarification, and an authorized reviewer. Completed and cancelled records are terminal.

Sources have stable types: physician, hospital discharge, pharmacy, client, representative, or other. Their provenance is recorded separately as clinician instruction, pharmacy record, client report, representative report, or other. Entries stay linked to their source, and multiple statements are kept separately rather than merged. Incomplete facts remain unknown. Correcting an entry appends a replacement linked to the prior entry with a reason, preserving the original statement.

Starting a reconciliation snapshots the client's active and paused orders, including the exact immutable order revision, medication fields, dose, route, schedule, status, and validity dates. Later order edits do not change that baseline. Entries are linked to baselines manually; suggestions and automatic equivalence matching are not used.

Comparison is deterministic. It checks normalized medication names and compares ingredient, strength, dosage form, dose, route, structured schedule, and reported status when the required values are available. Missing values or incompatible dose units produce an `insufficient_information` finding instead of being treated as equal, zero, or a clinical mismatch. Unmatched entries and baselines produce missing-in-source findings. Findings describe information differences and are not clinical severity or error judgments. Each finding needs an explicit decision: accept internal, accept external, requires clarification, or no change. Clarification remains unresolved until the reviewer records an outcome.

Applying an external change requires an `accept_external` decision and an eligible current finding. Only physician and hospital-discharge sources can authorize application, and they must have a source reference. The order revision must still match the captured baseline; otherwise the request fails with `MEDICATION_RECONCILIATION_STALE_ORDER` for renewed review. Eligible dose, route, schedule, pause/resume, and discontinue changes go through the existing medication order application service, with its normal order-management authorization and immutable revisions. Reconciliation completion has a separate professional competency check. Each application has a stable action ID so retries cannot duplicate an order revision. Reconciliation does not create a new medication order from an unmatched external entry; that requires the ordinary authorized order workflow.

The Office client medication page provides source and entry capture, baseline review, manual matching, comparison, decisions, change application, completion, cancellation, and history. The caregiver visit view shows a minimal pending-review indicator for assigned visits; an open reconciliation does not block administration.

## Authorization and privacy

The API uses `medication.read`, `medication.order.manage`, `medication.administration.read`, `medication.administer`, `medication.administration.correct`, and `medication_reconciliation.read/create/update/complete`, combined with the caller's client resource scope. Office reconciliation actions are client scoped. The seeded Caregiver role can read the pending-review indicator only in assigned-visit context; the application also requires the linked active employee and active visit assignment, and the role cannot edit or list reconciliation history across clients.

`medication.administer`, `medication.administration.correct`, and `medication_reconciliation.complete` use the shared professional competency policy evaluator. Reconciliation completion uses operation `medication.reconciliation.complete`. Missing, inactive, or unsatisfied mandatory policy requirements fail closed, including for administrators. Authorization evidence records the policy version and matched qualification IDs without medication names, dose values, notes, or other clinical narrative.

The `medication` schema uses tenant-qualified references and forced RLS on every table. Application queries also carry tenant predicates and authorize the client or assigned visit. Office history is bounded by a required date range. Caregiver reads return only the assigned visit's relevant due items and administration history. Audit metadata and outbox events contain resource IDs, operation, and version metadata, never medication names, doses, notes, or reasons.

## Persistence and events

The schema contains `definitions`, `orders`, `order_revisions`, `administration_occurrences`, `administration_records`, `administration_corrections`, `reconciliations`, `reconciliation_sources`, `reconciliation_entries`, `reconciliation_baselines`, `reconciliation_matches`, `reconciliation_discrepancies`, `reconciliation_decisions`, and `reconciliation_applications`. UUIDv7 IDs, tenant-qualified foreign keys, client consistency constraints, version checks, immutable history triggers, and client/date indexes preserve referential and historical integrity. Occurrence facts are immutable except that a pending row can be cancelled or marked recorded. Completed reconciliation snapshots and their source and review history are immutable.

Order lifecycle changes, administration recording/correction, and reconciliation source, comparison, review, application, completion, and cancellation operations write audit entries and versioned outbox events in the same transaction. Event metadata contains resource IDs, operation, and version/count data, not medication names, doses, notes, or source narratives. The worker currently logs these events; medication does not trigger billing or notifications.
