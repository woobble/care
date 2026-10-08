# ADR 0018: Keep generic care planning separate from official SIS® representation

- Status: Accepted
- Date: 2026-10-08

## Context

The care-planning domain needs useful concepts for person perspective, professional assessment, needs, resources, goals, measures, risk responses, and evaluation. The German Structure Model supplies a broad care-process context, but the official SIS® has authorized content and technical requirements that cannot be recreated or inferred from a general description. No authorized official SIS artifacts or technical requirements are used for this foundation.

## Decision

Model generic care planning independently, using locale-neutral domain concepts and a revisioned history. Support only high-level compatibility with situation/information collection, measures planning, progress/deviation documentation, and evaluation; do not reproduce or paraphrase official SIS content, topic structure, wording, layout, or workflow. Do not label the generic model or UI as SIS®, official, equivalent, or compliant.

If an official SIS integration is pursued, isolate it behind a separately owned, versioned adapter or representation boundary. That boundary must be based on authorized source materials and requirements, keep official schemas and presentation out of the generic aggregate, and make any cross-model mapping explicit, version-aware, and provenance-preserving. Authorization to use official materials and conformance review are prerequisites; the adapter pattern does not imply either.

## Consequences

The generic care-plan model can evolve around the product's care-planning needs without pretending to capture official SIS semantics. Official terminology, content, and version changes remain isolated to the future adapter. Mappings will need review for unsupported or lossy concepts; the system must not silently infer official answers from generic fields.

The current foundation makes no claim to implement, reproduce, or comply with official SIS requirements. Official screens, validation, import/export, retention, and data contracts remain undecided until authorized requirements are available.

## Alternatives considered

- Name generic fields after presumed SIS topics: rejected because it would present an unsupported approximation as an official structure and bind generic care planning to unknown proprietary requirements.
- Recreate an official form from memory or public descriptions: rejected because those sources do not establish authorization, exact version, or technical conformance.
- Make the generic plan itself the official SIS representation: rejected because the domains have different ownership, versioning, and compliance requirements.
