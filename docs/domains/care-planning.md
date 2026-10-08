# Care planning

This document defines the domain boundary and invariants for generic, longitudinal care planning. It does not claim API or UI workflows beyond those present in the implementation, and it does not describe an official SIS® form. The separate [SIS / Structure Model boundary](sis-structure-model.md) explains that distinction.

## Ownership and scope

Care planning connects a client's care-relevant situation to needs, resources, risks, goals, planned measures, and evaluation. It is a first-class domain, separate from visit execution and daily documentation. Its provider context is the client, organization, and facility together; that context must be consistent with the client's provider relationships.

The domain owns a stable `CarePlan` identity and its revisions, assessments, needs, resources, planning responses to risks, goals, measures, and evaluations. It does not own client master data, clinical observations or assessments, service catalog definitions, service agreements, visits, or performed services. It references those records through their owning domains.

## Care-process boundary

The model is compatible at a conceptual level with these care-process stages:

1. Situation and information collection
2. Measures planning
3. Progress and deviation documentation
4. Evaluation

The plan holds planning context and intended measures. Progress and deviations remain in visit execution and care documentation. This slice does not link a deviation directly to a care measure. Evaluation records an outcome against a plan revision. These stages are not collapsed into one editable care-plan record, and the stage labels do not reproduce official SIS sections.

## Plan lifecycle and revisions

`CarePlan` represents the continuing plan and its provider context. Its lifecycle is `draft`, `active`, `under_review`, or `ended`. The supported transitions are `draft → active`, `active → under_review`, `under_review → active`, and `active` or `under_review` to `ended`. Ending is terminal. Validity dates are distinct from lifecycle status.

A revision is a versioned snapshot of the plan's assessment and structured planning content. A draft revision can be edited; creating it from the current revision copies forward the current planning content where applicable. Activation makes that revision immutable. Later changes require a new draft revision, while earlier revisions remain readable. Each revision preserves its author, creation time, reason, effective date, and change history. Current plan state is derived from its active revision rather than destructive updates to historical content.

Concurrent edits and activation must detect stale versions. A client should have at most one current plan in `active` or `under_review` status for a given organization/facility provider context; the persistence boundary must enforce this rule under concurrent commands. A distinct care program that needs a second current plan requires an explicit scope in the model rather than an accidental overlap.

## Assessment, needs, and resources

The assessment keeps the person's perspective separate from the professional perspective. The person's concerns, wishes, preferences, habits, priorities, and goals may include narrative text in the person's own terms. Professional assessment records observed needs, capabilities, limitations, risks, and rationale. The model should not translate every perspective into codes or merge professional judgments into the person's wording.

Care needs are structured planning concepts, not diagnoses. They need not use medical diagnosis terminology. Care resources describe abilities and support separately from problems, so the plan can preserve what the person can do and what support is available.

Clinical measurements, observations, assessments, and risk assessments remain owned by clinical documentation. A plan can deliberately reference supporting records; it does not copy all clinical data or silently change when a referenced record is corrected. A clinical risk assessment describes the assessed risk. A care-plan risk reference and its linked measures describe the planning response. This avoids a second, disconnected clinical-risk record.

## Goals, measures, and service planning

Goals are explicit, person-centered outcomes in understandable language. They may link to care needs, but the model does not require a SMART-goal engine.

Measures describe what care staff are expected to do, such as observe, encourage, assist, position, remind, or monitor. A measure may link to needs and goals, and may optionally reference a service definition. It is not itself a contracted service, visit, or billable activity, and need not map one-to-one to a service-catalog entry or scheduled service. An optional planning frequency can be textual or use a fitting existing cadence concept; care planning does not introduce a parallel scheduler.

Service agreements describe provider intent about which services are planned for a client. Care measures describe how care should be provided. They may be related explicitly, but neither is derived automatically from nor substitutes for the other. During a visit, a caregiver may read relevant active measures; planning and revision controls remain unavailable without the corresponding management permission.

## Evaluation

An evaluation is an append-only record tied to a plan and the revision being evaluated. It records who evaluated, when, the result, a summary, and an optional next evaluation due date. Stable internal result codes are locale-neutral: `effective`, `partially_effective`, `not_effective`, `changed_condition`, and `no_change`.

An evaluation can conclude that no revision is needed or that a new revision should be created. It never rewrites measures or changes a revision in place. Review dates are data for future workflows; they do not imply notification scheduling.

## Authorization, privacy, and audit

Plan management, revision activation, evaluation, and caregiver read access are distinct authorization decisions. Management follows tenant, organization, facility, and client resource scopes. Caregiver read access is limited to relevant active measures for visits the caregiver is assigned to or has participated in. This slice checks care-plan permissions and active employee linkage; it does not verify professional qualifications. Tenant administrators must grant authoring permissions only to qualified staff until a qualification policy is configured. Tenant RLS complements, but does not replace, these application-level checks. See [tenant isolation](../security/tenant-isolation.md).

Perspective text, assessment rationale, needs, goals, measure descriptions, and evaluation summaries are sensitive care data. Authorized detail views may return them; broad worklists, audit metadata, outbox payloads, and client timeline summaries must not. Lifecycle audit and versioned events should contain identifiers and changed-field metadata, not narrative plan content. See [privacy](../security/privacy.md).

## Structure Model relationship

The generic care-planning model is intended to be compatible with the broad care-process concept of the German Structure Model. It is not a representation of the official SIS®, does not reproduce its content or layout, and must not be labelled as such. No authorized official SIS artifacts or technical requirements are used for this generic foundation. A future official integration belongs behind a separate adapter and compliance boundary described in [SIS / Structure Model boundary](sis-structure-model.md).
