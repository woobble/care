# Office Operations

Operations owns manual Office tasks, recurring task definitions, deadline projections, reminder policies, and exception history. Source modules retain ownership of agreements, qualifications, benefit balances, invoices, and other business records. Operations reads authoritative data and does not copy it into a mutable deadline table.

## Manual tasks

Tasks support open, in-progress, completed, and cancelled states; low, normal, high, and urgent priorities; optional client/source references; assignment; due dates; comments; and activity. State edits use optimistic version checks. Completed tasks remain stored and can be reopened. Assigned employees must be active and belong to the task organization or facility.

Recurring schedules generate ordinary `OfficeTask` rows. Each generated task has a row in `operations.recurring_task_occurrences` linking it to the definition and its local occurrence date. Editing a definition affects future generation only. Existing tasks retain their due dates, assignees, and history. Pausing or ending a schedule does not cancel generated tasks.

## Recurrence semantics

The bounded rule model supports daily, weekly, monthly, and yearly frequencies with intervals. Weekly rules use ISO weekdays, Monday `1` through Sunday `7`. Monthly dates clamp to the final day of shorter months. Yearly leap-day dates clamp to February 28 in non-leap years.

Schedules use an IANA time zone and local wall-clock time. Ambiguous fall-back times use the earlier instant. A nonexistent spring-forward time is skipped for that scheduled date. `generate_missed` creates missed occurrences from the previous 30 days; older missed dates are skipped. `skip_missed` advances to the next future occurrence. Each run is bounded to 100 definitions, 100 inspected occurrences per definition, and 500 generated tasks.

## Deadline projections

`GET /api/v1/operations/deadlines` projects these source dates:

- Service agreements: `validUntil` for active and suspended agreements.
- Employee qualifications: `validUntil` for active qualifications and active employees.
- Benefits: carryover expiry from Benefits' existing remaining-balance projection and validity end dates for active entitlements.
- Billing: due dates for outstanding invoices and validity end dates for authorized payer arrangements.
- Onboarding: explicit follow-up dates and requested start dates for incomplete admission cases.

Projection windows and source queries are bounded. The response reports truncation so callers can narrow the worklist. Filters and ordering are deterministic; date filters use each organization's time zone. The assigned-employee filter matches deadlines with a linked follow-up task assigned to that employee; unassigned projections do not match. Source permissions are checked before data is returned, and opening a source record still invokes its owning module's authorization.

The current data model has no explicit document review/expiry date, claim response follow-up date, or agreement review date. Those are not inferred. Onboarding follow-up and start-date reminders use the existing admission fields and are configurable under the onboarding category.

## Reminder policies and history

Organization policies apply to agreements, qualifications, benefits, billing, and onboarding deadlines. Defaults are 30, 7, and 0 days before the due date. A deadline remains visible inside the largest configured lead time. Disabling a policy hides noncritical upcoming reminders; overdue and critical items stay visible. Policy edits use optimistic versions and write audit and outbox records.

Acknowledgement and snoozing use Operations' exception occurrence history. They do not change source records. Snoozing is limited to noncritical issues and expires within 30 days. Resolved source conditions remain in history. The deadline history view shows occurrence and interaction history.

Agreement policies may create one follow-up `OfficeTask` per agreement expiry issue. The task links to the agreement, rechecks that the source deadline is still actionable, and uses a tenant-qualified unique key plus a transaction advisory lock to prevent duplicates. A missing or inactive assignee produces an unassigned task with an assignment warning. Completing this task does not renew or otherwise modify the agreement.

There are no email, SMS, or push channels and no separate reminder-occurrence table. Reminders surface through the Operations worklist and existing exception acknowledgement/snooze history.

## Background processing

Run `apps/worker` with `WORKER_DATABASE_URL` and the configured `WORKER_POLL_INTERVAL_MS`. Apply database migrations before starting the worker. Recurrence and deadline evaluations are isolated so failure in one does not skip the other. Recurrence generation uses a tenant advisory lock, row locks, and a unique `(tenant_id, recurrence_definition_id, occurrence_key)` constraint. Deadline evaluation uses source-scoped advisory locks and the unique deadline task key. Retries and worker restarts therefore reuse the same occurrence identity.

The deadline worker periodically projects agreement, qualification, entitlement, payer authorization, receivable, carryover, and onboarding dates into Operations exception history. Benefits supplies carryover dates from its existing remaining-balance projection. Billing computes receivables using invoice corrections and unreversed payment allocations. Onboarding owns its query for incomplete cases and assessment start dates. These reads stay within each tenant and do not create a second copy of source records.

Each source scan is bounded to 500 records and advances a durable per-source cursor in `operations.scheduler_runs`. A scan reconciles only the source ID range it checked. If a source fails, its transaction rolls back, its cursor does not advance, and existing occurrences are left untouched; other sources continue independently. The `operations.scheduler_runs` row records the last start, success or failure, safe failure code, task count, reminder count, and per-source cursors. Failure metadata remains available after later successful runs. The Reminder Settings page exposes deadline evaluation status and counts. Recurrence definitions and generated occurrences remain queryable through the recurring-task API.

Worker roles receive only the Operations table grants needed for generation and audit/outbox writes. New Operations tables use forced tenant RLS. Application reads and writes also check organization, facility, client, source-domain, and assignee permissions.

## API and audit

Recurring-task definitions are managed under `/api/v1/operations/recurring-tasks`. Deadline projections and organization reminder settings use `/api/v1/operations/deadlines` and `/api/v1/operations/reminder-settings`. Existing Operations permissions are reused for worklist access; separate grants control recurrence management and reminder settings.

Meaningful recurrence, policy, task-generation, acknowledgement, and snooze changes write audit and versioned outbox events in the same transaction. Generic event metadata excludes task descriptions and client information.

## Limits

Automatic deadline-task creation currently supports agreement expiry only. There is no calendar sync, workflow engine, external notification channel, or automatic source-record update. Document expiry and claim response deadlines require authoritative source fields and are not projected in this slice.
