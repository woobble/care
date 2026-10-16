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

The scenario clock defaults to 2026-10-12 in `Europe/Berlin`; four weeks of recurring visits are generated from that configurable start date. For a fresh tenant, set `PILOT_REFERENCE_DATE` so today's Berlin date falls within the schedule and run the first seed after an eligible Client 06–10 visit window has ended. This lets the seed complete today's visit without marking a future appointment as performed. All five weekdays are represented in that client group. Keep the same reference date on reruns so generated visits remain stable. The application-wide clock is unchanged. OSRM is optional and disabled in this scenario.

To give a local Authentik user Office access to the tenant, run:

```sh
DEV_SEED_OIDC_SUB=<local-authentik-subject> bun run pilot:seed:identity
```

The command uses the existing identity seed flow. The completed visit also has a seed-only Caregiver actor linked to the assigned caregiver; this actor has no sign-in mapping and cannot be used to log in. The fixture does not create Authentik accounts, invitations, or additional human Office identities.

## Seeded records

- One synthetic tenant and provider organization, two facilities, and two teams at each facility.
- Ten employees: three office staff and seven Betreuungskräfte. Caregivers have weekday availability and facility-specific assignments.
- Twenty fictional clients, fifteen active and five pending onboarding. Client 01 has a fictional representative; Client 02 has a contact whose authority needs review.
- Six provider-priced services: Alltagsbegleitung, Hauswirtschaft, Einkaufsbegleitung, Terminbegleitung, Freizeitbegleitung, and Entlastung pflegender Angehöriger. Funding categories are examples and do not establish statutory eligibility.
- Twenty service agreements, fifteen active recurring agreements and five drafts awaiting review.
- One hundred twenty visits across four weeks, grouped in published tours. A planned absence has a confirmed substitute and the affected tours are republished. No route estimates are expected without OSRM.
- Seven synthetic funding sources. Client 01 has a provisional §45b entitlement with a €25 provider-reported external-consumption entry and a separate provisional §45a conversion entitlement with a €25 provider-reported external-benefit input. The conversion input is an explicit synthetic fixture fact, not a statutory calculation or payer-confirmed balance. Clients 06–10 each have an explicitly unconfirmed synthetic external funding source.
- One visit for an eligible Client 06–10 on the current Berlin date, executed through the normal visit lifecycle with finalized synthetic documentation and a current evidence package. Completion is recorded on its visit-execution record; the scheduling visit remains `planned`. Its synthetic actual interval is aligned to the scheduled window through the audited time-correction workflow. The fixture records no acknowledgement or signature from a client.
- One confirmed 50% allocation from a manually configured “other” funding source, with the remaining 50% billed to the client. The local billing profile contains synthetic bank and tax settings. Do not use these values outside this local demonstration.
- Two issued invoices that reconcile to the performed service: a synthetic payer invoice and a client invoice. The payer invoice has a locally recorded synthetic accepted claim and payment. The client invoice has a synthetic partial payment and a remaining receivable; amounts depend on the selected service.
- Fifteen source-linked Operations tasks covering draft agreements, onboarding, contact authority, provider-reported benefit review, the client invoice remainder, and the local claim exercise.

Scenario limits: this seed covers planned leave and a confirmed substitution, but it does not seed sickness absence, a failed/conflicting assignment, expiring employee qualifications, or automated deadline projections. Separately, the Operations API integration test covers unassigned visits, upcoming and overdue invoices, agreement and qualification expiry, benefit and payer authorization deadlines, onboarding follow-up/start dates, dashboard overdue counts, source filtering, and recurring-task idempotence. OSRM route estimates are also not part of the default local scenario.

The synthetic claim acceptance and payments are records for exercising local workflows only; they are not payer responses, bank activity, or proof of reimbursement. The confirmed funding allocation is also a synthetic scenario fact, not statutory eligibility or a confirmed external budget.

## Workflows to inspect

1. Review onboarding clients, Client 01's representative, Client 02's unverified contact, and the active client list.
2. Review active agreements and the five drafts awaiting review.
3. Open Scheduling for the four-week window. Inspect published tours, assignments, and the confirmed substitution.
4. Open the completed Client 06–10 visit, finalized documentation, evidence package, and split funding allocation.
5. Review the payer and client invoices, the local claim exercise, and the partial client payment in Billing and Claims.
6. Open Operations and follow the 15 synthetic tasks to their source records.
7. Review Client 01's provisional benefit entry. Do not treat the provider-reported amount as a confirmed payer balance.

The integrated Authentik browser journey creates separate synthetic records in the local Demo Care tenant and exercises admission, caregiver execution and evidence, benefit allocation, invoice issuance, manual claim acceptance, payment linking, and reassignment authorization. It temporarily grants its test administrator access to the pilot to review the 15-task Operations list and a source link, then removes that pilot membership. The existing journey retains immutable billing history in Demo Care.

## Reproducibility and inspection

Run `bun run pilot:seed` again with the same `PILOT_REFERENCE_DATE` to reuse the dedicated tenant. The visit summary should report `generated=0` and `already-existing=120`; invoices, claims, payments, allocations, and tasks are checked against their existing source records and totals. Inspect the tenant by slug `muster-betreuungsdienst-nrw` or organization name `Muster Betreuungsdienst NRW`.

For an isolated local PostgreSQL test project on a non-default port, set `PILOT_DEDICATED_TEST_DATABASE=true` and `PILOT_TEST_DATABASE_PORT` to that port, and point both local database URLs at it. Both URLs must still use loopback, the `care` database, and their expected database users. The exception is disabled by default; do not set it for a shared development database.

### Retrospective four-week execution run

To verify one completed visit in each simulated week, use a fresh, isolated Compose project and database. A start date is considered retrospective when every scheduled date in its 28-day window has passed. The seed then completes one eligible visit per available week using the existing visit-execution, documentation, evidence, and audited time-correction workflows. Only the representative finance visit is allocated and invoiced; other completed services remain unbilled.

Example using the historical run's dedicated ports:

```sh
export CARE_E2E_POSTGRES_PORT=15435
export CARE_E2E_S3_PORT=19042
export CARE_E2E_FILER_PORT=19044
docker compose -p care-goal13-fourweek -f compose.yaml -f compose.e2e.yaml up -d --wait postgres seaweedfs
docker compose -p care-goal13-fourweek -f compose.yaml -f compose.e2e.yaml --profile bootstrap run --rm --no-deps seaweedfs-init

export NODE_ENV=development
export DATABASE_URL=postgres://care_app:care_dev_only@localhost:${CARE_E2E_POSTGRES_PORT}/care
export MIGRATION_DATABASE_URL=postgres://care_owner:care_owner_dev_only@localhost:${CARE_E2E_POSTGRES_PORT}/care
export WORKER_DATABASE_URL=postgres://care_worker:care_worker_dev_only@localhost:${CARE_E2E_POSTGRES_PORT}/care
export PILOT_DEDICATED_TEST_DATABASE=true
export PILOT_TEST_DATABASE_PORT=${CARE_E2E_POSTGRES_PORT}
export S3_ENDPOINT=http://localhost:${CARE_E2E_S3_PORT}

bun run migrate
bun run seed
PILOT_REFERENCE_DATE=2026-09-14 bun run pilot:seed
PILOT_REFERENCE_DATE=2026-09-14 bun run pilot:seed
```

The second seed run should report `generated=0`, `already-existing=120`, and `weekly execution timeline=4/4 available weeks`. A different reference date on the same database creates another scheduled window; use the same fixed date for idempotent reruns. For a new simulation date, use a new isolated project/database. Inspect execution, document, evidence, allocation, invoice, claim, and payment relationships with read-only queries; do not repair business state with direct database writes.

### Isolated Authentik and browser run

The checked-in Compose override assigns non-default host ports. Use a unique Compose project name so Docker gives the database and storage separate project-scoped volumes:

```sh
export CARE_E2E_POSTGRES_PORT=15433
export CARE_E2E_REDIS_PORT=16380
export CARE_E2E_AUTHENTIK_PORT=19020
export CARE_E2E_S3_PORT=19022
export CARE_E2E_FILER_PORT=19024
export CARE_E2E_SMTP_PORT=11027
export CARE_E2E_MAILPIT_PORT=18026
docker compose -p care-goal13-e2e -f compose.yaml -f compose.e2e.yaml up -d --wait
docker compose -p care-goal13-e2e -f compose.yaml -f compose.e2e.yaml run --rm --no-deps seaweedfs-init
```

If a port is already in use, choose another non-default port and keep the matching database, OIDC, storage, and Compose port variables consistent.

With the development credentials from `.env.example` (or matching credentials from your local `.env`), configure the host-run API and web processes for that project:

```sh
export NODE_ENV=development
export DATABASE_URL=postgres://care_app:care_dev_only@localhost:${CARE_E2E_POSTGRES_PORT}/care
export MIGRATION_DATABASE_URL=postgres://care_owner:care_owner_dev_only@localhost:${CARE_E2E_POSTGRES_PORT}/care
export WORKER_DATABASE_URL=postgres://care_worker:care_worker_dev_only@localhost:${CARE_E2E_POSTGRES_PORT}/care
export PILOT_DEDICATED_TEST_DATABASE=true
export PILOT_TEST_DATABASE_PORT=${CARE_E2E_POSTGRES_PORT}
export OIDC_ISSUER=http://localhost:${CARE_E2E_AUTHENTIK_PORT}/application/o/care-platform/
export S3_ENDPOINT=http://localhost:${CARE_E2E_S3_PORT}
export WEB_ORIGIN=http://localhost:3000
export PLAYWRIGHT_BASE_URL=http://localhost:3000
```

Then apply migrations, create the generic local demo tenant, and run the pilot seed with a fixed date. Run the browser suite from its workspace so the root `test:e2e` wrapper cannot start or seed the shared default Compose project:

```sh
bun run migrate
bun run seed
PILOT_REFERENCE_DATE=2026-10-12 bun run pilot:seed
cd apps/web
bun run test:e2e
```

The targeted substitution and caregiver draft checks can be run with `bun run test:e2e -- e2e/substitution-access.spec.ts` and `bun run test:e2e -- e2e/care-delivery-evidence.spec.ts`. Install the Playwright Chromium build with `bunx playwright install chromium` if it is not already present.

To discard a disposable E2E environment, first inspect the exact project with `docker compose -p care-goal13-e2e -f compose.yaml -f compose.e2e.yaml ps`, confirm its project label is `care-goal13-e2e`, then run `docker compose -p care-goal13-e2e -f compose.yaml -f compose.e2e.yaml down -v --remove-orphans`. This removes only containers and volumes for that named project. Never substitute the shared `care-platform` project name. The pilot seed itself never drops or truncates records, and no volume cleanup was performed for this run.
