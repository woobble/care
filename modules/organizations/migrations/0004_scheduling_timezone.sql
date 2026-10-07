ALTER TABLE organizations.organizations
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Berlin';

ALTER TABLE organizations.facilities
  ADD COLUMN timezone text;

ALTER TABLE organizations.organizations
  ADD CONSTRAINT organizations_timezone_ck
    CHECK (length(trim(timezone)) BETWEEN 1 AND 100);

ALTER TABLE organizations.facilities
  ADD CONSTRAINT facilities_timezone_ck
    CHECK (timezone IS NULL OR length(trim(timezone)) BETWEEN 1 AND 100);
