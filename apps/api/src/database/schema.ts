import { auditSchema } from '@care/audit';
import { clientsSchema } from '@care/clients';
import { employeesSchema } from '@care/employees';
import { identitySchema } from '@care/identity';
import { organizationsSchema } from '@care/organizations';
import { platformSchema } from '@care/platform';

export const databaseSchema = {
  ...identitySchema,
  ...organizationsSchema,
  ...employeesSchema,
  ...clientsSchema,
  ...auditSchema,
  ...platformSchema,
};
