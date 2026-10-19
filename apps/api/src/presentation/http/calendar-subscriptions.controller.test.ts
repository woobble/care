import { describe, expect, test } from 'bun:test';

import { CalendarSubscriptionRateLimiter } from './calendar-subscriptions.controller';

describe('calendar subscription rate limiter', () => {
  test('applies separate client and token limits and resets each window after one minute', () => {
    const limiter = new CalendarSubscriptionRateLimiter();

    for (let index = 0; index < 120; index += 1) {
      expect(limiter.allowClient('192.0.2.1', 1_000)).toBe(true);
    }
    expect(limiter.allowClient('192.0.2.1', 1_000)).toBe(false);
    expect(limiter.allowClient('192.0.2.2', 1_000)).toBe(true);

    for (let index = 0; index < 30; index += 1) {
      expect(limiter.allowToken('token-hash-a', 1_000)).toBe(true);
    }
    expect(limiter.allowToken('token-hash-a', 1_000)).toBe(false);
    expect(limiter.allowToken('token-hash-b', 1_000)).toBe(true);
    expect(limiter.allowClient('192.0.2.1', 61_000)).toBe(true);
    expect(limiter.allowToken('token-hash-a', 61_000)).toBe(true);
  });
});
