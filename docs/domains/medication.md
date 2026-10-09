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

## Authorization and privacy

The API uses `medication.read`, `medication.order.manage`, `medication.administration.read`, `medication.administer`, and `medication.administration.correct`, combined with the caller's client resource scope. Office reads and order changes are client scoped. The seeded Caregiver role can request assigned-visit medication reads and administration, but the application also requires the linked active employee and an active assignment to that visit; the role grant does not expose a tenant-wide medication list or history.

`medication.administer` and `medication.administration.correct` use the shared professional competency policy evaluator. Missing, inactive, or unsatisfied policy requirements fail closed, including for administrators. Authorization evidence records the policy version and matched qualification IDs without medication names, dose values, notes, or other clinical narrative.

The `medication` schema uses tenant-qualified references and forced RLS on every table. Application queries also carry tenant predicates and authorize the client or assigned visit. Office history is bounded by a required date range. Caregiver reads return only the assigned visit's relevant due items and administration history. Audit metadata and outbox events contain resource IDs, operation, and version metadata, never medication names, doses, notes, or reasons.

## Persistence and events

The schema contains `definitions`, `orders`, `order_revisions`, `administration_occurrences`, `administration_records`, and `administration_corrections`. UUIDv7 IDs, tenant-qualified foreign keys, unique occurrence identity, precise numeric constraints, immutable history triggers, and client/date indexes preserve referential and historical integrity. Occurrence facts are immutable except that a pending row can be cancelled or marked recorded.

Order lifecycle changes and administration recording/correction write audit entries and versioned outbox events in the same transaction. The worker currently logs these events; medication does not trigger billing or notifications.
