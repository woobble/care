# ADR 0016: Keep structured clinical records typed and linked to visit documentation

- Status: Accepted
- Date: 2026-10-08

## Context

Generic care notes cannot reliably represent measurements, coded observations, assessments, or risk history. These facts need stable machine codes, numeric storage, bounded client history, and correction semantics. They also must not change execution outcomes or expand what a signatory acknowledges.

## Decision

Create a `clinical_documentation` module with typed relational records for measurements, observations, assessments, and risk assessments. Each record in this goal belongs to one Care Documentation and its execution. Client and visit context are derived through that parent, with tenant-qualified composite foreign keys. Client history and current-risk views are bounded projections across visit records. Standalone client-owned record creation is deferred because it needs its own lifecycle and access rules.

Care Documentation remains the lifecycle owner. Draft structured changes lock and increment the parent version. Parent finalization freezes its clinical records. Corrections append typed replacement records that reference the original and carry a reason; originals are not overwritten. Structured records are optional for finalization.

Measurements use typed PostgreSQL numeric or integer columns. Blood pressure has separate systolic and diastolic fields. Glucose stores the explicit input unit (`mg/dL` or `mmol/L`) with no conversion. All other supported measurements use the declared unit in their type contract. Presentation labels are localized; stored codes and units are not.

## Consequences

Clinical data has a separate API permission family and is filtered by visit resource scope. Audit and outbox metadata omit clinical values and notes. Service-evidence snapshots remain limited to service facts and are unaffected by clinical record changes.

Client histories represent facts from visits. A future fact that exists independently of a visit must use a client-owned lifecycle and must not be attached to a finalized visit document as an ordinary edit.

## Alternatives considered

- Store clinical facts as generic narrative entries: rejected because codes, numeric values, and queryable histories would be lost.
- Store all clinical facts in JSON: rejected because core values and constraints should be typed relational data.
- Put clinical values in service evidence: rejected because signatory acknowledgement covers service facts only.
- Make all client history client-owned now: rejected because this goal's authoring workflow is visit-bound and client-owned records require different lifecycle and authorization rules.
