import { auditSchema } from '@care/audit';
import { benefitsSchema } from '@care/benefits';
import { billingSchema } from '@care/billing';
import { payerDirectorySchema, billingClaimsSchema } from '@care/billing';
import { careDocumentationSchema } from '@care/care-documentation';
import { clientsSchema } from '@care/clients';
import { communicationsSchema } from '@care/communications';
import { documentsSchema } from '@care/documents';
import { employeesSchema } from '@care/employees';
import { identitySchema } from '@care/identity';
import { onboardingSchema } from '@care/onboarding';
import { operationsSchema } from '@care/operations';
import { organizationsSchema } from '@care/organizations';
import { platformSchema } from '@care/platform';
import { schedulingSchema } from '@care/scheduling';
import { serviceAgreementsSchema } from '@care/service-agreements';
import { serviceEvidenceSchema } from '@care/service-evidence';
import { servicesSchema } from '@care/services';
import { visitExecutionSchema } from '@care/visit-execution';

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
  ...operationsSchema,
  ...communicationsSchema,
  ...onboardingSchema,
  ...auditSchema,
  ...platformSchema,
};
