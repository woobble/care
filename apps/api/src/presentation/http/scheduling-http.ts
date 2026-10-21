import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import type { ApiRequest } from '@app/api/http/request';

export function parseId(value: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException();
  return parsed.data;
}

export function auditContext(request: ApiRequest): { ip?: string; userAgent?: string } {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  };
}
