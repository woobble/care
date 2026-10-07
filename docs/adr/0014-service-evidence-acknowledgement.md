# ADR 0014: Snapshot service evidence before acknowledgement

- Status: Accepted
- Date: 2026-10-07

## Context

Finalized care documentation can later receive an appended amendment, and execution times can be corrected through an explicit command. Service catalog labels and provider context can also change. Acknowledging live rows would therefore make a historical confirmation change meaning after it was captured.

## Decision

Create the `service_evidence` module as the owner of immutable evidence packages and signatory acknowledgements. A package is generated only from completed execution and complete finalized documentation. It snapshots all service facts displayed to the signatory, has a deterministic canonical JSON representation, and stores its SHA-256 digest.

An acknowledgement binds to the package ID and hash and snapshots the signatory identity and capacity plus the statement version. Touch signatures are stored as canonical stroke JSON in private S3-compatible storage; PostgreSQL stores the object key and digest. Typed confirmation is an application-level alternative. Declines are explicit records and do not imply consent.

Amendments and execution corrections make a package outdated by source-version comparison. The package and its acknowledgements remain unchanged, and a new package version requires a new outcome. A confirmed record can only be changed through an explicit, audited revocation; after revocation a new acknowledgement or decline may be appended. Forced tenant RLS and resource-scope checks protect every read and command.

## Consequences

The database has separate forced-RLS tables for evidence packages and acknowledgements, with tenant-qualified references and append-only triggers. Package hashes can be independently verified; signature artifacts can be integrity-checked at authorized retrieval. The API exposes package preparation, acknowledgement, decline, revocation, worklist, and authorized signature retrieval.

The model keeps service acknowledgement separate from care narrative, billing, claims, identity verification, and qualified signatures. Signature retention remains aligned with acknowledgement history; automatic retention/deletion policy is future work.

## Alternatives considered

- Resolve service facts dynamically from execution and documentation: rejected because later amendments, corrections, and catalog changes would alter what historical acknowledgements appear to cover.
- Store only a package hash: rejected because the exact service facts must remain reconstructable without relying on mutable source data.
- Treat acknowledgement as part of care-documentation finalization: rejected because documentation finalization and signatory acknowledgement have separate actors, authorization, lifecycle, and correction rules.
- Store signature bytes in PostgreSQL or publish an object URL: rejected because the application already has private S3-compatible storage and signatures require controlled retrieval.
