import { describe, expect, mock, test } from 'bun:test';

import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';

import { OperationsTasksApplicationService } from './tasks.application';
import type { OperationsTaskData } from './tasks.ports';

const request = { requestId: 'request', correlationId: 'correlation' };
const principal: AuthorizationPrincipal = { userId: 'user', tenantId: 'tenant', grants: [] };

function setup() {
  const transaction = mock(async () => {
    throw new Error('Unexpected database transaction');
  });
  const assertTaskScope = mock(async () => {});
  const validateSource = mock(async () => ({
    organizationId: 'other-provider',
    facilityId: null,
    clientId: null,
  }));
  const data = { assertTaskScope, validateSource } as unknown as OperationsTaskData;
  const service = new OperationsTasksApplicationService(
    { transaction } as UnitOfWork,
    {} as AuditWriter,
    {} as OutboxWriter,
    data,
  );
  return { service, transaction, assertTaskScope, validateSource };
}

describe('task command preflight', () => {
  test.each(['', '   ', 'x'.repeat(201)])(
    'rejects invalid titles before foreign reads or writes',
    async (title) => {
      const f = setup();
      await expect(
        f.service.createTask(principal, { organizationId: 'provider', title }, request, {}),
      ).rejects.toMatchObject({ code: 'OPERATIONS_INVALID_INPUT' });
      expect(f.validateSource).not.toHaveBeenCalled();
      expect(f.assertTaskScope).not.toHaveBeenCalled();
      expect(f.transaction).not.toHaveBeenCalled();
    },
  );

  test('does not authorize cross-provider source associations', async () => {
    const f = setup();
    await expect(
      f.service.createTask(
        principal,
        {
          organizationId: 'provider',
          title: 'Follow-up',
          source: { type: 'visit', id: '00000000-0000-4000-8000-000000000001' },
        },
        request,
        {},
      ),
    ).rejects.toMatchObject({ code: 'OPERATIONS_INVALID_INPUT' });
    expect(f.validateSource).toHaveBeenCalledTimes(1);
    expect(f.transaction).not.toHaveBeenCalled();
  });

  test('denies creation before provider validation or task persistence when permission is absent', async () => {
    const f = setup();
    await expect(
      f.service.createTask(
        principal,
        { organizationId: 'provider', title: 'Follow-up' },
        request,
        {},
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION' });
    expect(f.assertTaskScope).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
  });

  test('rejects invalid expected versions before opening a transaction', async () => {
    const f = setup();
    await expect(
      f.service.patchTask(principal, 'task', { expectedVersion: 0, title: 'Changed' }, request, {}),
    ).rejects.toMatchObject({ code: 'OPERATIONS_INVALID_INPUT' });
    await expect(f.service.completeTask(principal, 'task', NaN, request, {})).rejects.toMatchObject(
      { code: 'OPERATIONS_INVALID_INPUT' },
    );
    expect(f.transaction).not.toHaveBeenCalled();
  });
});
