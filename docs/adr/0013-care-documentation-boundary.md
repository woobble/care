# ADR 0013: Separate care documentation from visit execution

- Status: Accepted
- Date: 2026-10-07

## Context

Visit execution needs to capture actual times, outcomes, quantities, performers, and outcome reasons. Narrative notes, observations, deviations, incidents, and evidence serve a different purpose and need their own completeness, finalization, privacy, and correction rules.

## Decision

Create a `care_documentation` module and PostgreSQL schema with one draft or finalized document per executed visit. Documentation can be drafted while execution is in progress, but it can be finalized only after execution completes and required evidence is complete. Every performed service, including an unplanned service, requires linked evidence; incomplete records expose structured missing requirements.

Execution retains actual facts and structured outcome reasons. Narrative entries, service evidence, amendments, and documentation history belong to care documentation. Finalized documents and their entries and evidence are immutable. Authorized corrections append amendments without rewriting the original.

Caregiver access requires a valid visit relationship. Office review and amendment use separate permissions and follow the visit's resource scope. Narrative text is excluded from audit metadata, history metadata, outbox payloads, worklist results, and client timeline summaries.

## Consequences

The API no longer accepts execution operational notes or performed-service notes; the migration preserves existing values in care documentation before dropping those columns. Execution may complete while documentation remains a draft. Consumers must create or access documentation separately and finalize it explicitly.

The separate schema adds tables and constraints for documents, entries, service evidence, amendments, and history. Version checks and row locks serialize edits and finalization. Database triggers protect finalized content and append-only records.

## Alternatives considered

- Keep narrative fields in visit execution: rejected because execution would own narrative, evidence, and finalization rules unrelated to actual execution facts.
- Require complete documentation before execution completion: rejected because it prevents caregivers from ending operational execution while documentation remains incomplete.
- Reopen finalized documentation for correction: rejected because it destroys the original finalized record.
