# Client onboarding and admission

Onboarding owns prospect cases, needs assessments, checklist responses, readiness, lifecycle history, and admission decisions. Clients, contacts, communications, benefits, service agreements, documents, tasks, services, and visits remain authoritative in their existing modules.

## Lifecycle

Cases move through `inquiry`, `assessment`, `preparation`, and `ready_for_admission` before admission. `declined` and `withdrawn` are terminal until a staff member reopens the case. Every mutation uses the expected case version. Admission reevaluates readiness in the same transaction that activates a linked pending client, stores a decision snapshot with the checklist template version, and writes audit and outbox records.

A prospect can exist without a client record. Staff can later link an existing client or register one pending client from the prospect. Intake communication stays linked to the case; after client linkage, existing client contacts and communications are reused.

## Readiness and evidence

The provider-scoped checklist has versioned items. Automatic findings read client, Benefits, service-agreement, visit, and document state from their source modules. Manual responses require attribution; `not_applicable` requires a reason. Manual responses cannot override automatic blockers.

Funding readiness requires documented details for provider-specific arrangements. Private payment does not require Pflegegrad. Benefits readiness requires readable funding and entitlement records. Agreement readiness requires an active agreement that covers every requested service. A PDF alone does not establish acceptance.

The case detail view also reports effective catalog price availability for requested services and the planned provider/date. This is a read-only view of Services data. It does not set agreement prices or reserve funding. Service catalog access is checked independently; missing access is shown as unknown.

Provider-selected document evidence links existing document artifacts. Onboarding does not store files. Scheduling links the existing visit record and remains subject to Scheduling's normal availability and conflict checks.

## Operations and authorization

The admission worklist is paginated and supports organization, facility, stage, owner, date, overdue, readiness, and search filters. Operations projects readiness blockers and overdue follow-ups as source-backed work items. Existing occurrence reconciliation resolves issues after source state changes.

Every case and template query is tenant and provider scoped. Each linked source is independently authorized by its owning module. Prospect data is protected by the same case scopes as linked-client cases. Caregiver access is not implied by office onboarding permissions.

The API is under `/api/v1/onboarding`. Permissions are `onboarding.read`, `onboarding.create`, `onboarding.manage`, `onboarding.admit`, and `onboarding.templates.manage`.
