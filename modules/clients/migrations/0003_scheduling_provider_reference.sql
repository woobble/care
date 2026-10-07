ALTER TABLE clients.clients
  ADD CONSTRAINT clients_scheduling_provider_reference_uq
    UNIQUE (tenant_id, organization_id, primary_facility_id, id);
