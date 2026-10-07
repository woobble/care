# Client master data

The `clients` module owns a client's structured identity, provider context, lifecycle, addresses, contacts, insurance relationships, Pflegegrad history, and timeline projection.

## Provider context and legacy records

Each new client must reference one organization and one primary facility in the same tenant, with the facility belonging to that organization. Composite foreign keys enforce these relationships. Existing rows are not assigned arbitrary providers during migration: their two provider columns remain null as a pair. A database trigger prevents new unassigned rows, and the explicit provider-context command assigns an existing legacy row after normal authorization and validation. Tenant-scoped users can read unassigned legacy rows; organization- and facility-scoped queries exclude them. Changing context writes audit and outbox records in the same transaction.

Organization scope includes clients owned by that organization. Facility scope includes clients whose primary facility matches the scope. Client-team and caregiver/client assignment semantics are unsupported because no client-team or caregiver-assignment model exists.

## Master data

Personal names are structured as first, last, and optional preferred name. Gender and salutation are independent optional fields. Addresses support home, billing, and other types, international two-letter country codes, optional validity dates, and one primary address per client. Changing primary address is transactional.

Related people are stored as client contacts, not identity users. A contact can have multiple structured roles, including primary contact, emergency contact, legal representative, authorized contact, and invoice recipient. The model includes a relationship type and a limited representation foundation for power of attorney, legal guardianship, and authorized representatives. Contact notes are capped and are not a place for medical information.

Insurance relationships store an insurance type, insurer name, optional identifiers and validity dates. The module uses direct structured insurer data instead of a generic external-party model. This keeps the current scope small; claims and billing remain out of scope. Insurance identifiers are not copied into audit metadata, outbox payloads, or structured application logs.

Pflegegrad is represented as historical records with grade 1 through 5, validity, decision date, optional insurer reference, and pending/confirmed/revoked status. Confirmed validity periods cannot overlap. A missing effective confirmed record means there is no current Pflegegrad. Future pending changes can coexist with a current confirmed grade.

The timeline is a read-only client-oriented projection of client audit actions. It returns a timestamp, actor ID, stable action, and short summary; it does not expose raw audit metadata or insurance identifiers.

## API and UI

The API exposes explicit child-resource operations under `/api/v1/clients/:id`, plus provider-context and timeline operations. Parent client authorization runs before child access. Office pages manage client details without direct database access and use types generated from OpenAPI. Search supports text, lifecycle status, organization, facility, current Pflegegrad, pagination, and stable sorting by last name, first name, creation time, or birth date.

Normal application workflows do not hard-delete clients. Team scope and `assigned_clients` remain unsupported until their relationship models and authorization semantics are explicitly designed.
