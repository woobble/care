import pino, { type Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';

export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'authorization',
        'accessToken',
        'refreshToken',
        'idToken',
        'client_secret',
        'password',
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
      ],
      censor: '[redacted]',
    },
  });
}

export function correlationIdFromRequest(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-care-correlation-id'];
  return typeof value === 'string' ? value : uuidv7();
}
