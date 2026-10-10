import { auditSchema } from '@care/audit';
import { clientsSchema } from '@care/clients';
import { employeesSchema } from '@care/employees';
import { identitySchema } from '@care/identity';
import { organizationsSchema } from '@care/organizations';
import { platformSchema } from '@care/platform';
import { servicesSchema } from '@care/services';
import { serviceAgreementsSchema } from '@care/service-agreements';
import { schedulingSchema } from '@care/scheduling';
import { visitExecutionSchema } from '@care/visit-execution';
import { careDocumentationSchema } from '@care/care-documentation';
import { serviceEvidenceSchema } from '@care/service-evidence';
import { benefitsSchema } from '@care/benefits';
import { billingSchema } from '@care/billing';
import { payerDirectorySchema, billingClaimsSchema } from '@care/billing';
import { documentsSchema } from '@care/documents';

export const databaseSchema = {
  ...identitySchema,
  ...organizationsSchema,
  ...employeesSchema,
  ...clientsSchema,
  ...servicesSchema,
  ...serviceAgreementsSchema,
  ...schedulingSchema,
  ...visitExecutionSchema,
  ...careDocumentationSchema,
  ...serviceEvidenceSchema,
  ...benefitsSchema,
  ...billingSchema,
  ...payerDirectorySchema,
  ...billingClaimsSchema,
  ...documentsSchema,
  ...auditSchema,
  ...platformSchema,
};
