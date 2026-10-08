import { describe, expect, it } from 'bun:test';
import { formatCurrency, formatDate, formatNumber, formatTime } from './format';

describe('locale formatting', () => {
  it('formats dates and numbers for English and German', () => {
    expect(formatDate('2026-10-07', 'en')).toBe('Oct 7, 2026');
    expect(formatDate('2026-10-07', 'de')).toBe('07.10.2026');
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
  });

  it('formats time by locale while retaining the supplied timezone', () => {
    const instant = '2026-10-07T06:30:00.000Z';
    expect(formatTime(instant, 'en', 'Europe/Berlin')).toBe('8:30 AM');
    expect(formatTime(instant, 'de', 'Europe/Berlin')).toBe('08:30');
  });

  it('formats future currency values as EUR by default', () => {
    expect(formatCurrency(1234.5, 'en')).toContain('€');
    expect(formatCurrency(1234.5, 'de')).toContain('€');
  });
});
