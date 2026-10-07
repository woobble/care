# Service evidence and signatory acknowledgement

## Meaning and boundary

`service_evidence` owns immutable evidence packages and the acknowledgement records attached to them. A package is a snapshot of finalized service evidence presented to a signatory. An acknowledgement records who confirmed that snapshot, in what capacity, by which application-level method, and when.

This workflow does not approve an invoice or claim, certify care medically, verify identity cryptographically, or provide a qualified electronic signature. It covers service evidence only; observations, incidents, and other clinical narrative are not included in the package. Billing remains a separate domain.

## Package creation and snapshot

The API prepares a package only when its visit execution is completed and its care documentation is finalized and complete. There is one package version per documentation record and package creation is idempotent for unchanged source versions.

The snapshot contains the client and visit identity and display name, planned visit time and timezone, actual execution interval, source execution and documentation versions, amendment count, and deterministically sorted performed-service items. Each item preserves service code and name, unit, planned and actual quantity, outcome, outcome reason, performer, and documentation evidence state. The package is sufficient to render the original acknowledgement even if catalog or provider data later changes.

Canonical hashing is explicit. `canonicalEvidenceSnapshot` constructs a new object with a fixed property order and normalizes each item's fields, sorts items by `performedServiceId` using code-point order, serializes with `JSON.stringify`, and hashes the UTF-8 bytes with SHA-256. The hash is verified before acknowledgement and signature retrieval. Reordering the source item array does not change the hash; changing an included value or version does.

Packages are immutable in PostgreSQL. The latest package is current only while its documentation version, execution version, and amendment count match the locked source records. A documentation amendment or execution correction makes the old package outdated. The old snapshot and acknowledgements remain historical; preparing again creates the next package version and acknowledgement is required for that version.

## Signatories and outcomes

The client may confirm personally without a contact record. A representative is offered only when the contact belongs to the client, has the `legal_representative` role, has a supported representation type, and its optional validity dates include the acknowledgement date. Dates are inclusive. The record snapshots the signatory name, relationship, representation type, capacity, and contact reference.

Confirmation methods are `touch_signature` and `typed_confirmation`. The centralized statement is versioned (`de-v1`) and copied to each acknowledgement. Typed confirmation checks the entered name against the selected signatory after Unicode normalization, whitespace normalization, and case folding. Neither method represents qualified electronic signing.

A refusal or inability to confirm creates a `declined` record with method `staff_recorded_decline`, a structured reason code, and an optional protected note. It never creates a signature or implies consent. A decline is terminal for that package; a changed package is required before another outcome can be recorded.

Acknowledgement facts are append-only. An Office user with `acknowledgement.revoke` may explicitly revoke a confirmed record with a required reason. The database permits only the revocation timestamp, actor, and reason to change. The record remains in history, and a later confirmation or decline may be appended for the same package after revocation. At most one non-revoked acknowledgement exists per package.

## Signature artifact and privacy

The browser sends normalized stroke coordinates. The domain validates non-empty visible strokes, finite coordinates in the unit square, at most 32 strokes and 2,000 points, and a 48 KB serialized artifact limit. The canonical versioned stroke JSON is stored in a private S3-compatible bucket; PostgreSQL stores only the opaque key and SHA-256 digest. Keys contain tenant and acknowledgement IDs, not names or service data. A failed database capture removes its uncommitted object where possible.

Signature bytes and object URLs are not written to audit metadata, logs, list responses, or outbox events. The authorized detail endpoint loads the private artifact and verifies both the artifact hash and package hash before returning strokes. There are no permanent public URLs or signed URL responses. Historical signature retention follows acknowledgement history; automatic deletion is not implemented.

Decline notes are not included in audit or event payloads. They are available only in the authorized package detail. Worklists return names, visit date, state, signatory summary, package version, and hashes, never signature content.

## Authorization, audit, and events

Caregiver access requires the authenticated user to map to an active employee with a valid assignment or recorded participation in the visit. Office access uses visit and client resource scope. Package preparation, acknowledgement capture, acknowledgement read, and revocation have separate permissions. RLS is forced on both tables, and tenant-qualified foreign keys preserve package, client, representative, and employee ownership.

Package creation and supersession and acknowledgement creation, decline, and revocation write audit records and version 1 outbox events in the same database transaction. Audit metadata and events contain IDs, status, capacity, version, and hashes only. The worker currently logs/acknowledges these events and starts no billing or other external workflow.

## API and UI

Caregivers review the displayed service list after documentation finalization, select the client or an eligible representative, then draw a signature, confirm a matching name, or record a decline. The tablet/mobile view has reset and undo controls and checks for horizontal overflow. Typed confirmation is the accessible alternative to pointer or touch capture.

Office users can filter the `Leistungsnachweise` worklist, review package and acknowledgement history, view an authorized signature, and revoke a confirmation with a reason. The client timeline contains fixed acknowledgement, decline, and revocation summaries only.

## Deferred boundaries

There is no client portal, remote signing request, qualified or advanced electronic signature, identity verification service, representative portal, billing, invoice, claim, price, payer, or benefit-consumption behavior in this module.
