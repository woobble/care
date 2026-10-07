# Service catalog

The `services` module owns provider service categories, service definitions, and organizational availability. It is a foundation for later service agreements, care plans, scheduling, performed services, and billing; it is not a billing module.

## Definitions and categories

Categories are tenant-owned labels with an optional code, description, ordering, and active/archived status. Service definitions have a tenant-unique code, name, optional description, category, unit (`occurrence`, `minute`, `hour`, or `day`), optional default duration, active/archived status, and validity dates. There is no pricing, payer billing code, claim, or invoice data.

Archiving preserves definitions and categories for historical references. Archived categories cannot be selected for new definitions. An existing service can continue to be edited in other fields while retaining an already archived category; changing it to another category requires an active category. Validity is represented by dates, but the platform does not implement full immutable temporal versions. Use a new service definition when a change would alter the meaning of historical references.

## Availability and access

Availability assigns a service to an organization, optionally at one facility, with active status and optional validity dates. Composite foreign keys enforce same-tenant provider references and facility/organization consistency. Replacing assignments retires prior active rows and inserts the requested current assignments in one transaction, retaining old rows for inspection.

Service search supports text, status, category, organization, facility, date, and pagination. Active definitions valid at the requested date are returned. Organization-scoped readers see organization availability and facility-scoped readers see matching facility availability plus organization-wide availability for their facility's organization. Service read permission is separate from tenant-scoped catalog mutation permissions. The seeded Caregiver has read access only; Office can maintain categories, definitions, and availability.

## API, UI, and events

The API exposes category and service CRUD-with-archive operations, search, and availability replacement. The Office UI provides catalog search, category maintenance, service creation/editing/archiving, and availability controls. API requests and responses flow through generated OpenAPI types. Mutations write audit actions and version 1 outbox events in the same transaction; the worker logs them until downstream workflows exist.
