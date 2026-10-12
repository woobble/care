GRANT USAGE ON SCHEMA billing TO care_worker;
GRANT SELECT ON billing.payer_arrangements,
  billing.invoices,
  billing.invoice_corrections,
  billing.payment_allocations,
  billing.payment_reversals TO care_worker;
