ALTER TABLE billing.invoice_documents
  ADD COLUMN renderer_version integer NOT NULL DEFAULT 1 CHECK (renderer_version > 0),
  ADD COLUMN template_version integer NOT NULL DEFAULT 0 CHECK (template_version >= 0),
  ADD COLUMN locale text NOT NULL DEFAULT 'de' CHECK (locale IN ('de', 'en'));
