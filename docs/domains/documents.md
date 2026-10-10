# Documents and exports

The `documents` module owns organization-scoped template versions, private logo assets, generated PDF artifact metadata, and verified retrieval. Source modules remain authoritative for service evidence, agreements, benefits, and billing. The API builds a source-authorized snapshot, renders it through the shared `pdf-lib` renderer, and stores the PDF in private object storage. The module does not calculate benefit balances, price services, or change source lifecycles.

## Supported documents

- **Leistungsnachweis:** generated from a finalized evidence package or a bounded client service period. Acknowledgement state is shown as recorded; only an available, authorized signature artifact is rendered.
- **Leistungsvereinbarung:** generated from the stored agreement and its service terms. The generator does not look up current prices to fill historical agreements.
- **Rechnung and Rechnungskorrektur:** remain Billing-owned documents. Billing uses the shared renderer and its immutable issued/correction snapshots.
- **Budgetübersicht:** generated from the Benefits projection for a client and an explicit `asOf` date.

The supported office workflows provide previews for evidence and agreement documents, persisted generation, download, and client document history. Selecting `de` or `en` for generation is independent of the Office interface locale. User-entered descriptions and contract text are preserved without automatic translation.

## Templates and provider identity

Templates are scoped by tenant, organization, and document type. They store the logo asset reference, primary color, header and footer, optional contact details, default document language, and agreement terms. A template change inserts a new immutable version. Generated metadata records the version used, so a branding change never rewrites a historical artifact. Provider legal identity and address are read from the organization and Billing profile instead of copied into another issuer record.

Logo upload accepts bounded PNG and JPEG files only. The API checks image dimensions and actual decodability, embeds the image with `pdf-lib`, stores it in private object storage under a generated key, and records its digest and dimensions. Document rendering never fetches an external logo URL.

## Snapshots, storage, and retrieval

Each artifact records its source type and ID, source version, client and resource scope, document language, template version, generation actor, MIME type, object size, and SHA-256. A generation idempotency key prevents duplicate artifacts for a retried request. Ready artifacts are immutable; only the lifecycle transition to superseded is allowed. Failed generation does not alter the source business record.

PDF bytes and logo objects remain in private S3-compatible storage. The database stores opaque object keys, never public storage URLs. Downloads require `documents.read` and current access to the underlying client, agreement, evidence, benefit, or invoice source. The API verifies the stored bytes against the artifact digest before returning them. Caregivers do not receive financial documents through the document permission family.

The template, logo, and artifact tables use forced tenant row-level security. Database triggers reject template/logo mutation, artifact deletion, and invalid artifact state changes. Generation and template changes write audit metadata and versioned outbox events without care narratives or signature contents.

## CSV exports

Exports are bounded by date and organization and use stable, versioned schemas defined in `modules/documents/src/infrastructure/export-schemas.ts`:

| Schema                   | Endpoint                                | Purpose                                                  |
| ------------------------ | --------------------------------------- | -------------------------------------------------------- |
| `billing_invoices_v1`    | `/api/v1/billing/exports/invoices`      | Invoice totals and payment status                        |
| `billing_lines_v1`       | `/api/v1/billing/exports/invoice-lines` | Invoice line amounts, quantities, and funding references |
| `billing_receivables_v1` | `/api/v1/billing/exports/receivables`   | Outstanding balances and receivable state                |
| `benefit_allocations_v1` | `/api/v1/benefits/exports/allocations`  | Provider-side benefit consumption allocations            |

CSV values use RFC-style quote escaping and CRLF line endings. Text cells beginning with spreadsheet formula characters are prefixed to reduce formula injection risk; explicitly typed numeric cells remain numeric. An optional UTF-8 BOM is available for spreadsheet compatibility. Exports are audited and require `documents.exports.read` plus the relevant billing or benefit scope.

These are operational exports, not DATEV, E-Rechnung, or Pflegekassen claim formats. They do not certify reimbursement or replace statutory billing records.
