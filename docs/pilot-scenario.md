# Synthetic Betreuungsdienst pilot

The pilot uses the existing local development stack. Names, addresses, contacts, insurance references, funding, payer, invoices, claim decisions, payments, notes, and documents are synthetic. The payer arrangement is a local workflow fixture; it is not a real mandate or authorization. No claim is transmitted and no real money or client acknowledgement is represented.

## Setup

Start the local services, apply migrations, and seed the dedicated pilot tenant:

```sh
bun run infra:up
bun run migrate
bun run pilot:seed
```

The command requires `NODE_ENV=development`, local loopback PostgreSQL URLs for the `care_app` and `care_owner` roles, and a reachable local S3-compatible object store. It validates its environment and does not drop or truncate data. Reruns reuse records and stop when an identifier belongs to unexpected data.

The scenario clock defaults to Monday, 2026-10-12, in `Europe/Berlin`; four weeks of recurring visits are generated from that date. Client 06's finance visit is scheduled on Monday. On the first execution of that visit, the reference date must also be today's Berlin date, because the existing visit lifecycle does not support backdating a completed visit. For a fresh setup on a different day, set `PILOT_REFERENCE_DATE` to today's date and use a Monday or Wednesday so Client 06 has a recurring visit. The application-wide clock is unchanged. A rerun reuses an already completed workflow. OSRM is optional and disabled in this scenario.

To give a local Authentik user Office access to the tenant, run:

```sh
DEV_SEED_OIDC_SUB=<local-authentik-subject> bun run pilot:seed:identity
```

The command uses the existing identity seed flow. The completed visit also has a seed-only Caregiver actor linked to Client 06's assigned caregiver; this actor has no sign-in mapping and cannot be used to log in.

## Seeded records

- One synthetic tenant, provider organization, facility, and two teams.
- Eight employees: two office staff and six Betreuungskräfte. Caregivers have weekday availability.
- Twenty fictional clients, fifteen active and five pending onboarding. Client 01 has a fictional representative; Client 02 has a contact whose authority needs review.
- Six provider-priced services: Alltagsbegleitung, Hauswirtschaft, Einkaufsbegleitung, Terminbegleitung, Freizeitbegleitung, and Entlastung pflegender Angehöriger. Funding categories are examples and do not establish statutory eligibility.
- Twenty service agreements, fifteen active recurring agreements and five drafts awaiting review.
- One hundred twenty visits across four weeks, grouped in published tours. A planned absence has a confirmed substitute and the affected tours are republished. No route estimates are expected without OSRM.
- Three synthetic funding sources. Client 01 has a provisional §45b entitlement and a €25 provider-reported external-consumption entry; the remaining balance is unconfirmed and is not presented as payer-confirmed.
- One completed Client 06 visit with finalized synthetic documentation and a current evidence package. The fixture records no acknowledgement or signature from a client.
- One confirmed 50% allocation from a manually configured “other” funding source, with the remaining 50% billed to the client. The local billing profile contains synthetic bank and tax settings. Do not use these values outside this local demonstration.
- Two issued invoices that reconcile to the performed service: a synthetic payer invoice and a client invoice. The payer invoice has a locally recorded synthetic accepted claim and payment. The client invoice has a synthetic partial payment of €6 and a €12 outstanding balance.
- Fifteen source-linked Operations tasks covering draft agreements, onboarding, contact authority, provider-reported benefit review, the client invoice remainder, and the local claim exercise.

Scenario limits: this seed covers planned leave and a confirmed substitution, but it does not seed sickness absence, a failed/conflicting assignment, expiring employee qualifications, or automated deadline projections. OSRM route estimates are also not part of the default local scenario.

The synthetic claim acceptance and payments are records for exercising local workflows only; they are not payer responses, bank activity, or proof of reimbursement. The confirmed funding allocation is also a synthetic scenario fact, not statutory eligibility or a confirmed external budget.

## Workflows to inspect

1. Review onboarding clients, Client 01's representative, Client 02's unverified contact, and the active client list.
2. Review active agreements and the five drafts awaiting review.
3. Open Scheduling for the four-week window. Inspect published tours, assignments, and the confirmed substitution.
4. Open Client 06's completed visit, finalized documentation, evidence package, and split funding allocation.
5. Review the payer and client invoices, the local claim exercise, and the partial client payment in Billing and Claims.
6. Open Operations and follow the 15 synthetic tasks to their source records.
7. Review Client 01's provisional benefit entry. Do not treat the provider-reported amount as a confirmed payer balance.

The integrated Authentik browser journey creates separate synthetic records in the local Demo Care tenant and exercises admission, caregiver execution and evidence, benefit allocation, invoice issuance, manual claim acceptance, payment linking, and reassignment authorization. It temporarily grants its test administrator access to the pilot to review the 15-task Operations list and a source link, then removes that pilot membership. The existing journey retains immutable billing history in Demo Care.

## Reproducibility and inspection

Run `bun run pilot:seed` again to reuse the dedicated tenant. The visit summary should report `generated=0` and `already-existing=120`; invoices, claims, payments, allocations, and tasks are checked against their existing source records and totals. Inspect the tenant by slug `muster-betreuungsdienst-nrw` or organization name `Muster Betreuungsdienst NRW`.

No cleanup command is provided. The pilot is isolated to its dedicated tenant and the seed never removes data.
