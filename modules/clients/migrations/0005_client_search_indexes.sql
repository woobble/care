-- Substring search is used by the server-side client list. Keep each index on
-- the values that the UI can search without exposing those values in results.
CREATE INDEX clients_email_trgm_idx
  ON clients.clients USING gin (email gin_trgm_ops)
  WHERE email IS NOT NULL;
CREATE INDEX clients_phone_trgm_idx
  ON clients.clients USING gin (phone gin_trgm_ops)
  WHERE phone IS NOT NULL;
CREATE INDEX clients_mobile_trgm_idx
  ON clients.clients USING gin (mobile gin_trgm_ops)
  WHERE mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS clients_preferred_name_trgm_idx
  ON clients.clients USING gin (preferred_name gin_trgm_ops)
  WHERE preferred_name IS NOT NULL;
CREATE INDEX client_insurances_number_trgm_idx
  ON clients.client_insurances USING gin (insurance_number gin_trgm_ops)
  WHERE insurance_number IS NOT NULL;
CREATE INDEX client_insurances_member_number_trgm_idx
  ON clients.client_insurances USING gin (member_number gin_trgm_ops)
  WHERE member_number IS NOT NULL;
