import { expect, test } from 'bun:test';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { ClinicalRecordAmendmentConflictError } from '@care/clinical-documentation';
import { ProblemDetailsFilter } from './problem-details.filter';

test('maps a duplicate clinical amendment to a conflict problem', () => {
  let responseBody: Record<string, unknown> | undefined;
  let responseStatus: number | undefined;
  const response = {
    status(status: number) {
      responseStatus = status;
      return this;
    },
    type() {
      return this;
    },
    json(body: Record<string, unknown>) {
      responseBody = body;
      return this;
    },
  } as unknown as Response;
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ context: { requestId: 'request-1' } }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new ProblemDetailsFilter().catch(new ClinicalRecordAmendmentConflictError(), host);

  expect(responseStatus).toBe(409);
  expect(responseBody).toMatchObject({
    status: 409,
    code: 'CLINICAL_RECORD_AMENDMENT_CONFLICT',
    traceId: 'request-1',
  });
});
