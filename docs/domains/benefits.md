# Benefits and budget management

The `benefits` module supports budget administration for ambulatory Betreuungs- und Entlastungsdienste. It records funding information and service consumption; it does not submit claims, confirm reimbursement, or create invoices.

## Supported funding

The initial statutory rule is the § 45b SGB XI Entlastungsbetrag: EUR 131 per month from January 2025, for Pflegegrad 1–5. Monthly allocation buckets preserve the amount, rule version, origin month, and expiry date. Unused amounts may be used through June 30 of the next calendar year. Allocation spends the earliest-expiring eligible bucket first and never uses an expired bucket.

§ 45a Abs. 4 SGB XI is represented as a separate conversion entitlement for Pflegegrad 2–5. Its amount depends on external use of ambulatory in-kind benefits. The system therefore requires a recorded external input and does not calculate or display the statutory maximum as guaranteed available funding.

Private payment and explicitly configured other funding are supported as separate client entitlements. Contract evidence may confirm a private or other entitlement. This does not turn a provider-side balance into a payer-confirmed balance. Insurance records remain owned by Client Master Data; a funding source links to an existing record rather than duplicating it.

## Rules and eligibility

Rules are immutable, effective-dated rows with a jurisdiction, version, eligibility conditions, and source references. Monthly buckets retain the applied rule-version ID, amount, origin month, and expiry, so historical calculations do not depend on current rule values. The initial § 45b rule and source references are seeded by `0001_benefits.sql`.

For statutory allocation, eligibility is evaluated for the service date using the client's confirmed Pflegegrad history, the benefit rule, service classification, and provider recognition. In NRW, § 45b allocation requires an active recognition record for the provider and date. Only service definitions explicitly classified as recognized support can qualify; clinical nursing or an unclassified service is not assumed to qualify. § 45a additionally requires external input.

## Funding facts and ledger

Funding source, entitlement, and invoice recipient are different concepts. Client entitlements link a funding source and an effective period. Statutory periods of the same benefit type cannot overlap. Uncertain entitlement data remains provisional.

Monthly entitlements, opening balances, external consumption, corrections, service allocations, reversals, and expirations are represented by immutable buckets and ledger entries. Amounts are integer EUR cents. Adjustments are idempotent and append-only; reversals retain the original allocation and record a linked correction. Historical projections use only ledger facts effective on or before the requested date.

Opening balances and external use carry their source, effective date, reference, recorder, and verification status (`estimated`, `client_reported`, `provider_reported`, or `payer_confirmed`). A manually entered or provider-reported balance is not presented as guaranteed reimbursement. Separate per-entitlement projections show recorded and payer-confirmed balances so conflicting sources are not collapsed into one number.

## Planned and actual use

Scheduling estimates use the service's effective price, explicit pricing unit, quantity, benefit eligibility, and current projection. Price units are not inferred from visit duration. The estimate is advisory: it creates no reservation, allocation, or ledger entry. Period amounts not yet materialized by a write are included as projections; a completed service allocation materializes the applicable entitlement periods in its transaction. A low estimated balance does not block private payment or scheduling.

An actual allocation references a completed performed service. It uses actual quantity and the effective service price, preserving price and quantity snapshots. Staff may split one service amount across multiple entitlements, but total allocations cannot exceed the service amount and the same portion cannot be recorded twice. If no effective price exists, staff must enter the service amount explicitly. Allocation status distinguishes provisional provider-side accounting from use against a payer-confirmed balance; neither status means reimbursement has occurred.

Office can generate a client Budgetübersicht PDF for an explicit date and export bounded provider-side allocations through the versioned `benefit_allocations_v1` CSV schema. The overview and export report recorded benefit facts and do not imply reimbursement. See [Documents and exports](documents.md) for artifact history, template versions, storage, and CSV safety.

## Authorization, audit, and events

The API exposes `benefits.read`, `benefits.manage`, `benefits.adjust`, `benefits.allocate`, and `benefits.review`. Client operations check tenant, organization, facility, and client scope. Worklists are bounded and filtered to the actor's scope. Caregivers do not receive detailed funding and insurance balances by default.

Entitlement, funding-source, adjustment, allocation, reversal, recognition, and materialized-period changes write audit metadata and versioned outbox events in the same transaction. Budget, worklist, and planning-estimate reads do not write ledger rows or emit events. Events carry identifiers and financial audit metadata, not unnecessary client narrative.

## Pricing and billing boundary

Services own effective-dated prices and pricing units. Benefits store the price and quantity facts used for each allocation so later catalog changes do not rewrite history. Invoice generation, claims, insurer interfaces, reimbursement reconciliation, and accounting remain future work.

## Regulatory references

- [§ 45a SGB XI](https://www.gesetze-im-internet.de/sgb_11/__45a.html)
- [§ 45b SGB XI](https://www.gesetze-im-internet.de/sgb_11/__45b.html)
- [Federal Ministry of Health: Pflegeleistungen](https://www.bundesgesundheitsministerium.de/leistungen-der-pflege.html)
- [NRW legal portal](https://recht.nrw.de/) — current AnFöVO text and recognized-offering requirements

The application stores rule source references and effective dates. Legal changes require a new rule version and review; the system does not update statutory rules automatically.
