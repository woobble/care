# Client data and privacy

Client addresses, contact details, insurance identifiers, representation references, Pflegegrad records, and notes are personal data. They remain in the tenant-owned client module and are protected by API authorization, scoped parent-client access, application tenant predicates, and forced PostgreSQL RLS.

The application does not log client request bodies or child-resource values. Audit metadata records resource IDs and changed-field names rather than copies of personal values. Versioned outbox payloads use resource IDs and operation metadata. Client timeline responses are a client-oriented projection and omit raw audit metadata. Validation errors are generic and do not echo submitted values. Insurance identifiers are only rendered in the authorized client detail workflow and are never included in list search or timeline output.

All users with an applicable `client.read` grant can read the client child resources through the API; this slice does not define separate permissions for insurance identifiers or contact details. Review this access boundary before adding broader caregiver workflows. Contact notes are length-limited and the UI explicitly discourages medical information there.

Service catalog data is operational configuration. It is tenant-isolated and has separate `service.read` and catalog mutation permissions. It contains no prices, claims, or billing records.
