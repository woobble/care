# Payer claims

Claims belong to Billing because they reserve and track portions of issued invoices. Benefits remains the source of funding allocations and entitlement facts; Billing owns invoices and receivables; Documents renders and stores private PDFs.

## Arrangements and payer requirements

The tenant scoped payer directory stores payer identity and contact details. Optional payer identifiers are not invented. A payer arrangement links a client and funding or insurance record to a payer directory entry and records the arrangement type, effective dates, authorization state, documented source and reference, and an optional existing mandate artifact.

Funding eligibility does not authorize direct payment. Direct payer billing requires an applicable active arrangement with documented authorization. Customer reimbursement uses an arrangement that identifies the payer while the invoice remains addressed to the client. Neither arrangement retroactively changes historical invoices or claim snapshots.

Payer billing profiles are immutable, versioned records for a funding type and submission channel. They store the source name, version, effective date, optional HTTPS URL, profile validity, and a bounded checklist of identifiers, evidence, acknowledgement, mandate, invoice and provider recognition requirements. Claims without an applicable configured profile receive readiness blockers. Requirements are not inferred from payer names or funding type.

## Readiness and claim amounts

A claim links to an issued invoice and selected invoice lines. Creation checks the client, organization, payer arrangement, funding source, payer type, invoice status and invoice version. Lines reserve at most the available invoiced amount. Concurrent active claims cannot reserve the same amount twice. Resubmission creates a linked claim for the unresolved amount and keeps the earlier submission and decision.

Readiness checks the configured profile, source invoice and correction freshness, payer authorization, identifiers, current service evidence, acknowledgement and provider recognition when required, and conflicting reservations. Blockers are returned with a field and explanation for Office follow up.

Payer decisions are separate from invoices and payments. Accepted, rejected, partially accepted and clarification outcomes are recorded against immutable claim lines. A rejection does not void or edit the invoice. A correction uses the existing Billing correction workflow.

## Package and manual submission

Preparing a claim stores a versioned package manifest with the issued invoice PDF, relevant service evidence PDFs, a mandate artifact when configured as required, and a claim summary PDF. The manifest records each document hash and source version. Package documents remain private and are downloaded through an authorized API that verifies the stored hash.

Office explicitly records an external manual submission with its channel, timestamp, recipient snapshot, external reference, package version and hash, actor, and protected note. The record documents the provider's action; it does not prove receipt by the payer. The platform does not transmit claims, send email, automate payer portals, or produce an official § 105 SGB XI electronic exchange file.

## Payment reconciliation

Incoming payments remain in the existing Billing ledger. An allocation may reference both the invoice and claim, and it is subject to the invoice receivable balance and the latest payer accepted amount. Reversals remain Billing payment reversals and require claim reconciliation scope when the allocation is claim linked. Claim submission, payer acceptance, and payment received remain separate facts.

## Regulatory boundary and sources

This workflow is administrative support for ambulatory Betreuungsdienste. It does not decide legal entitlement, prove a payer's receipt, guarantee reimbursement, or certify regulatory or electronic format conformance. Operators must review the applicable rules and payer instructions for the service and submission date.

Official references to check when configuring requirements:

- Sozialgesetzbuch XI, § 45a, offers to support everyday life: <https://www.gesetze-im-internet.de/sgb_11/__45a.html>
- Sozialgesetzbuch XI, § 45b, relief amount: <https://www.gesetze-im-internet.de/sgb_11/__45b.html>
- Sozialgesetzbuch XI, § 105, billing and electronic data exchange: <https://www.gesetze-im-internet.de/sgb_11/__105.html>
- NRW Anerkennungs- und Förderungsverordnung (AnFöVO), current consolidated text and amendments: <https://recht.nrw.de/>
- The relevant Pflegekasse or private insurer's published requirements for the selected channel and service period.

The application stores the configured payer source name, version, effective date, URL and validity period with the profile. These are operator supplied references, not a legal determination by the application. In particular, § 105 SGB XI electronic data exchange is not assumed to apply to every § 45a/§ 45b claim.
