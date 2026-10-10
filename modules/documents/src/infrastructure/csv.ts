export interface CsvNumber {
  readonly kind: 'number';
  readonly value: string;
}

export type CsvValue = string | number | CsvNumber | null | undefined;

export function csvNumber(value: string): CsvNumber {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new TypeError('Invalid CSV numeric value');
  return { kind: 'number', value };
}

export function encodeCsv(
  columns: readonly string[],
  rows: readonly (readonly CsvValue[])[],
  options: { bom?: boolean } = {},
): string {
  const output = [columns.map(encodeCell).join(',')];
  for (const row of rows) {
    if (row.length !== columns.length) throw new RangeError('CSV row does not match its schema');
    output.push(row.map(encodeCell).join(','));
  }
  return `${options.bom ? '\uFEFF' : ''}${output.join('\r\n')}\r\n`;
}

function encodeCell(value: CsvValue): string {
  if (value == null) return '';
  const text = typeof value === 'object' && value.kind === 'number' ? value.value : String(value);
  const safe =
    typeof value === 'object' && value.kind === 'number'
      ? text
      : hasFormulaPrefix(text)
        ? `'${text}`
        : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function hasFormulaPrefix(text: string): boolean {
  let index = 0;
  while (index < text.length && text.charCodeAt(index) <= 0x20) index += 1;
  const first = text[index];
  return first === '=' || first === '+' || first === '-' || first === '@';
}
