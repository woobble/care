# Billing and invoicing

The `billing` module owns provider billing profiles, payer arrangements, invoice candidates, draft and issued invoices, correction documents, payments, and receivables. It consumes completed performed services, finalized service evidence, effective-dated service prices, and Benefits allocations. It does not write benefit ledger facts or infer payer reimbursement.

## Billing candidates and funding

A candidate is built from a completed performed service and its service date, actual quantity, effective service price, current evidence package, configured acknowledgement requirement, billing profile, and applicable funding allocations. Blocker codes explain missing execution, documentation, evidence, price, funding resolution, recipient, provider configuration, or supported invoice format.

Each allocation and the remaining private-pay portion is separately attributable. Draft reservations and issued amounts are counted across all funding sources for the performed service. Issued corrections reduce the amount counted as billed; cancelled drafts release their reservation. Draft preparation and issuance lock the source performed services and revalidate the available amount in the transaction.

An entitlement or benefit allocation does not authorize direct payer billing. A direct-payer arrangement must be effective on the service date and have an authorized mandate with documented source and reference. Without it, an eligible service can be addressed to the client for reimbursement.

## Prices, tax, and snapshots

Services own effective-dated prices and explicit pricing units. Billing snapshots the service description, date, actual quantity, price, funding reference, tax treatment, tax basis, and exact cent totals on each invoice line. Historical invoices are not recalculated from current catalog prices. Money uses integer EUR cents and centralized rounding.

Provider profiles reuse organization identity and address. Issuance snapshots the issuer and recipient, billing profile, payment terms, and legally relevant bank and tax details. The tax identifier is required when the invoice exceeds EUR 250. The small-invoice exception at or below EUR 250 follows § 33 UStDV. Tax treatment and any exemption basis are explicitly configured; the service category does not imply tax exemption.

## Lifecycle, numbering, and corrections

Office staff can prepare, update, and cancel drafts. Issuance revalidates current source facts, assigns a provider-scoped transaction-safe number, snapshots the invoice, and queues a private PDF artifact. Issued invoice and line facts are immutable. Number assignment history is append-only; failed pre-issuance validation consumes no number.

Corrections are separate documents linked to the original invoice and affected lines. They preserve the original invoice and PDF, use an append-only correction history, and reduce only the remaining receivable. They cannot exceed the unpaid amount or correct the same line amount twice. A fully corrected unpaid invoice has receivable state `corrected`, with zero paid amount.

PDFs include the issuer and recipient, invoice identifier and dates, service lines and units, tax treatment, totals, payment deadline, bank details, and relevant funding references. Stored objects are private; the database records invoice/document version, object key, generation state, and SHA-256. Retrieval checks tenant and resource permissions and verifies the content hash. Failed PDF generation is distinct from invoice issuance and can be recovered by regenerating from the immutable snapshot. The shared document renderer also powers Leistungsnachweise, service agreements, and budget overviews; template configuration and artifact history are described in [Documents and exports](documents.md).

Billing provides bounded CSV exports using the versioned `billing_invoices_v1`, `billing_lines_v1`, and `billing_receivables_v1` schemas. These operational exports preserve invoice snapshots and derived receivable state; they are not DATEV or structured E-Rechnung output.

The data model retains structured invoice requirements, but XRechnung and ZUGFeRD generation are not implemented. A profile requiring a structured format blocks candidate readiness and issuance; an ordinary PDF is not presented as a compliant E-Rechnung.

## Payments and receivables

Office staff records bank-transfer, cash, or other payments. Payment allocations are separate, may cover multiple invoices, and cannot exceed either the remaining payment amount or the invoice's open receivable. Incorrect allocations are reversed with an attributed append-only fact. Overpayments are rejected.

Receivable state is derived from the issued gross amount, corrections, active payment allocations, and due date: unpaid, partially paid, paid, overdue, or corrected. Benefit allocations and invoice issuance are not payment facts.

## Authorization, audit, and events

Billing permissions are separate from client and benefit permissions: read, manage, issue, correct, payment read/manage, and settings manage. Each operation also checks tenant, organization, facility, and client scope. Billing tables use forced tenant RLS. Database triggers protect issued invoice snapshots and append-only numbering, corrections, and payment history.

Financial mutations write audit rows and versioned outbox events in the same transaction. Events contain identifiers and necessary financial metadata, not care narratives or signature contents. Caregiver roles receive no billing access by default.

## Regulatory references and limitations

- [§ 14 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html) — invoice particulars.
- [§ 31 UStDV](https://www.gesetze-im-internet.de/ustdv_1980/__31.html) — linked-document particulars and service period.
- [§ 33 UStDV](https://www.gesetze-im-internet.de/ustdv_1980/__33.html) — reduced particulars for invoices up to EUR 250.
- [§ 27 UStG](https://www.gesetze-im-internet.de/ustg_1980/__27.html) and the [BMF E-Rechnung guidance](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html) — transition and structured-format requirements.

Direct Pflegekasse claims transmission, insurer interfaces, structured E-Rechnung generation, bank synchronization, payment initiation, reminders, and general-ledger accounting remain outside this slice.
