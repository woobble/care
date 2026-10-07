import { auditSchema } from '@care/audit';
import { clientsSchema } from '@care/clients';
import { employeesSchema } from '@care/employees';
import { identitySchema } from '@care/identity';
import { organizationsSchema } from '@care/organizations';
import { platformSchema } from '@care/platform';
import { servicesSchema } from '@care/services';
import { serviceAgreementsSchema } from '@care/service-agreements';

export const databaseSchema = {
  ...identitySchema,
  ...organizationsSchema,
  ...employeesSchema,
  ...clientsSchema,
  ...servicesSchema,
  ...serviceAgreementsSchema,
  ...auditSchema,
  ...platformSchema,
};
