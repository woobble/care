import { describe, expect, test } from 'bun:test';

import { csvNumber, encodeCsv } from './csv';

describe('CSV encoding', () => {
  test('quotes delimiters, doubles quotes, and protects spreadsheet formulas', () => {
    expect(
      encodeCsv(['recipient', 'amount', 'note'], [['Provider, "A"', csvNumber('-12.50'), '=1+1']]),
    ).toBe('recipient,amount,note\r\n"Provider, ""A""",-12.50,\'=1+1\r\n');
  });

  test('quotes line breaks and supports a UTF-8 BOM', () => {
    expect(encodeCsv(['note'], [['line one\r\nline two, safe']], { bom: true })).toBe(
      '\uFEFFnote\r\n"line one\r\nline two, safe"\r\n',
    );
  });

  test('rejects rows that do not match the stable schema width', () => {
    expect(() => encodeCsv(['a', 'b'], [['one']])).toThrow(RangeError);
  });
});
