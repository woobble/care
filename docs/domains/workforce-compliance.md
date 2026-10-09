# Workforce qualification compliance

Workforce Compliance provides an administrative, read-side view of qualification validity, impending expiry, and readiness under the tenant's active professional competency policies. It helps administrators identify gaps and affected operations. It does not certify legal compliance, determine professional licensure, or authorize business actions.

## Ownership and sources of truth

The workforce-compliance module owns tenant monitoring settings, structured compliance findings, and derived readiness and expiry projections. The employees module remains the source of qualification definitions, employee assignments, validity dates, definition lifecycle, and revocation history. The competency-policies module remains the source of operation requirements and immutable policy versions.

Compliance reads derive results from those current records. They do not persist a second qualification status, eligibility decision, or readiness snapshot. A displayed result is advisory and may change after an assignment, employee, definition, policy, setting, or reporting date changes.

## Qualification status

Qualification status is derived for an explicit reporting date from the assignment lifecycle and inclusive validity dates. An open-ended date is unbounded, not unknown. Revocation takes precedence over date validity.

| Derived status  | Condition on the reporting date                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `revoked`       | The assignment has been revoked, regardless of its validity dates.                                                  |
| `not_yet_valid` | The assignment is active and its `valid_from` date is after the reporting date.                                     |
| `expired`       | The assignment is active and its `valid_until` date is before the reporting date.                                   |
| `expiring_soon` | The assignment is active and valid today, has a finite end date within the warning horizon, and is not yet expired. |
| `valid`         | The assignment is active and valid today, with no end date inside the warning horizon.                              |

Validity is inclusive: an assignment is valid when `valid_from <= reporting_date <= valid_until`, ignoring either bound when it is null. It expires on the day after `valid_until`. Revoked assignments are never valid. These rules reuse the competency policy date semantics. The lifecycle status of a qualification definition is separate from the derived status of an employee's assignment; archiving a definition does not erase the assignment record.

The expiry worklist may include an expiring qualification even when another credential keeps the employee eligible under an `ANY` policy. The credential's own expiry and its effect on an operation are separate findings.

## Readiness and policy impact

Readiness is evaluated per employee and supported operation against that operation's current active policy. The supported operations are `care_plan.activate` and `care_plan.evaluate`. Draft, inactive, and historical policy versions do not determine current readiness. The shared competency matcher applies the policy's existing `ANY` or `ALL` rule to the complete set of required qualifications: `ANY` needs at least one valid requirement; `ALL` needs every requirement to be valid. An empty or invalid requirement set does not grant eligibility.

The derived readiness states are:

- `ready`: current requirements are met and the full active policy remains met through the warning horizon.
- `at_risk`: current requirements are met, but a required validity change will make the full policy fail within that horizon.
- `not_ready`: an active policy exists, but the employee does not meet it on the reporting date.

When a mandatory policy is missing, inactive, or invalid, employee readiness is not evaluated and the API returns a null readiness state. The operation receives a blocking configuration finding instead. This keeps a policy administration issue separate from employee qualification gaps.

The projection evaluates the whole policy over the horizon. For `ANY`, one credential expiring does not create an eligibility risk if another required credential remains valid through the horizon. For `ALL`, expiry of any required credential can create risk. Policy impact is reported separately from raw expiry so a credential that is not needed to preserve an operation is not described as an operational failure.

There is no employee-to-operation responsibility mapping. The system therefore cannot claim that an employee is noncompliant or that an operation is `not_applicable` to that employee. Readiness remains operation-specific and informational. A missing, inactive, or invalid mandatory policy is a blocking configuration finding, separate from employee findings; it is never treated as `not_applicable` and never suppressed because no employee currently has the required qualifications.

Future readiness assumes that the active policy version remains active and unchanged throughout the horizon. The system does not predict future policy changes or treat a draft as authoritative. Care Plan activation and evaluation continue to make their own transactional authorization decision against the policy and qualification state at the time of the action.

The policy editor does not yet provide a draft-version impact preview. Administrators can review current policy coverage, employee readiness, requirement gaps, and qualification expiry impact before changing a policy; the current and proposed eligible employee sets are not compared until a separate preview is implemented.

## Reporting dates, timezones, and thresholds

The reporting timezone is resolved in this order: the applicable facility, the employee's organization, then the tenant's Workforce Compliance setting. The tenant setting defaults to `Europe/Berlin`. A facility without its own timezone falls back to its organization. Reporting dates and day horizons use this timezone, independent of the user's English or German UI locale.

Employee readiness uses each employee's resolved timezone. Operation-level policy summaries use the tenant reporting timezone so policy coverage stays stable when the visible employee set changes or is empty.

The default critical expiry threshold is 30 days and the default warning threshold is 90 days. Tenants may configure both as positive whole days from 1 through 365; the critical threshold must not exceed the warning threshold. An expiry on or before the reporting date plus the critical threshold receives critical priority; an expiry after that date and on or before the reporting date plus the warning threshold receives warning priority. These are administrative prioritization settings, not legal or regulatory deadlines.

The system validates configured reporting timezones as supported IANA timezone identifiers. Date comparisons use ISO calendar dates at the resolved reporting location; localized display formatting does not affect status or API values.

## Findings and policy coverage

Findings use stable locale-neutral codes and include only identifiers and details needed to explain the result, such as severity, affected operation, active policy version, qualification definition or assignment, and effective date. Missing or expired mandatory qualifications, revocation, not-yet-valid assignments, and expiry risk remain distinct conditions. Policy coverage findings identify operations with missing, inactive, or invalid configuration without attributing that configuration gap to an individual employee.

The report evaluates current records and, for an explicit past date, selects the policy version from its retained activation and deactivation intervals. Assignment creation and revocation timestamps are retained. The projection does not snapshot each evaluation, so a past display date cannot recreate all historical readiness facts: qualification validity-date edits, qualification-definition lifecycle changes, employee status and links, tenant thresholds, and organization, facility, or tenant reporting-timezone changes use their current values.

Summary expiry counts are qualification-assignment counts. `employeesWithMissingRequirements` is a distinct employee count across the caller's visible scope and counts only unmet requirements under valid active policies; missing, inactive, and invalid policy findings are reported as configuration findings. Scope predicates run before all these aggregates.

## Authorization, scope, and privacy

Compliance reads require dedicated compliance read authority and remain tenant-bound. PostgreSQL forced RLS protects the tenant settings, employee, qualification, and competency-policy rows. Application queries also include the tenant predicate and restrict employees to the actor's authorized employee visibility scope before pagination, aggregation, or summary counts. Organization scope follows employee ownership. Facility scope requires an active employee assignment and active facility; team scope requires active membership and an active team. A tenant-wide grant sees the tenant; a scoped grant sees the union of its authorized scopes; no usable scope yields no employee rows.

The qualification worklist applies its visibility and expiry filters in SQL before counting and paging. A partial index on `(tenant_id, valid_until)` supports tenant-wide range filters for dated assignments.

Summary, per-operation policy, and qualification-impact projections process the full visible employee set in fixed batches of 250, with qualifications and facility timezones fetched per batch rather than once per employee. Their total work grows with the caller's visible workforce; the batch bounds database reads and memory per query but does not cap the aggregate workforce size.

Detailed employee findings require the separate detail grant. Settings changes require the settings-management grant. Worklists and summaries minimize personnel data and do not expose certificate content, contact details, private notes, or unrelated employee records. Read operations do not create an audit or outbox event for every calculation.

## Settings changes and events

Changes to warning days, critical days, or the reporting timezone are tenant-scoped settings mutations. Each successful change is audited and writes the versioned `workforce_compliance.settings_updated` outbox event in the same transaction. Audit and event metadata identify the tenant, settings version, and changed fields without copying employee qualification or contact data. The passage of time and a query that discovers an expiry do not create a mutation, audit entry, or outbox event.

The worker has no notification side effect for these findings. Email, push, SMS, automated renewal, certificate verification, and other background responses are outside this slice.
