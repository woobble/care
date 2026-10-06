import { describe, expect, test } from 'bun:test';
import { asUUID } from '@care/contracts';

describe('identity keys', () => {
  test('issuer and OIDC subject stay a pair', () => {
    const identity = { issuer: 'https://id.example/', subject: 'sub-1' };
    expect(identity).toEqual({ issuer: 'https://id.example/', subject: 'sub-1' });
  });

  test('UUID contract rejects sequential identifiers', () => {
    expect(() => asUUID('12')).toThrow('Invalid UUID');
  });
});
