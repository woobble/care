ALTER TABLE service_agreements.agreements
  ADD CONSTRAINT service_agreements_scheduling_reference_uq
    UNIQUE (tenant_id, client_id, organization_id, facility_id, id);

ALTER TABLE service_agreements.agreement_services
  ADD CONSTRAINT agreement_services_scheduling_reference_uq
    UNIQUE (tenant_id, agreement_id, id, service_definition_id);
