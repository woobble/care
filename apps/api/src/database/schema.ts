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
import { clinicalDocumentationSchema } from '@care/clinical-documentation';
import { carePlanningSchema } from '@care/care-planning';
import { serviceEvidenceSchema } from '@care/service-evidence';
import { competencyPoliciesSchema } from '@care/competency-policies';
import { workforceComplianceSchema } from '@care/workforce-compliance';
import { medicationSchema } from '@care/medication';

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
  ...clinicalDocumentationSchema,
  ...carePlanningSchema,
  ...serviceEvidenceSchema,
  ...competencyPoliciesSchema,
  ...workforceComplianceSchema,
  ...medicationSchema,
  ...auditSchema,
  ...platformSchema,
};
