import { expect, test } from 'bun:test';

import { parseClientUpdate } from './client-update.schema';

const id = '12345678-1234-4234-8234-123456789abc';
function form(values: Record<string, string> = {}) {
  const result = new FormData();
  for (const [name, value] of Object.entries({
    id,
    firstName: ' Ada ',
    lastName: ' Lovelace ',
    ...values,
  }))
    result.set(name, value);
  return result;
}

test('valid normalization preserves the exact serialized update body, including permissive dates/text', () => {
  const parsed = parseClientUpdate(
    form({
      preferredName: ' Countess ',
      dateOfBirth: ' invalid date ',
      dateOfDeath: ' 0000-00-00 ',
      gender: ' female ',
      salutation: ' mr ',
      email: ' not-an-email ',
      phone: ' letters ',
      mobile: ' +49 123 ',
    }),
  );
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw parsed.error;
  const { id: clientId, ...body } = parsed.data;
  expect(clientId).toBe(id);
  expect(JSON.stringify(body)).toBe(
    '{"firstName":"Ada","lastName":"Lovelace","preferredName":"Countess","dateOfBirth":"invalid date","dateOfDeath":"0000-00-00","gender":"female","salutation":"mr","email":"not-an-email","phone":"letters","mobile":"+49 123"}',
  );
});

test('missing, blank, whitespace and File optional fields all retain their old null payloads', () => {
  for (const value of [null, '', '  ', new File(['private'], 'value.txt')]) {
    const input = form();
    for (const name of [
      'preferredName',
      'dateOfBirth',
      'dateOfDeath',
      'gender',
      'salutation',
      'email',
      'phone',
      'mobile',
    ])
      if (value !== null) input.set(name, value);
    const parsed = parseClientUpdate(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data).toEqual({
      id,
      firstName: 'Ada',
      lastName: 'Lovelace',
      preferredName: null,
      dateOfBirth: null,
      dateOfDeath: null,
      gender: null,
      salutation: null,
      email: null,
      phone: null,
      mobile: null,
    });
  }
});

test('required names reject missing, blank and non-string values, but accept unrestricted nonblank text', () => {
  for (const name of ['firstName', 'lastName']) {
    for (const value of [null, '', '   ', new File(['Ada'], 'name.txt')]) {
      const input = form();
      if (value === null) input.delete(name);
      else input.set(name, value);
      const parsed = parseClientUpdate(input);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error('Expected required-name failure');
      expect(parsed.error.issues.map((issue) => [issue.path, issue.message])).toEqual([
        [[name], 'required'],
      ]);
    }
  }
  expect(parseClientUpdate(form({ firstName: '李', lastName: 'a'.repeat(10000) })).success).toBe(
    true,
  );
});

test('enum choices match the existing values and invalid selections become null', () => {
  for (const gender of ['female', 'male', 'diverse', '', 'Female', 'unknown']) {
    const parsed = parseClientUpdate(form({ gender }));
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.gender as string | null).toEqual(
      ['female', 'male', 'diverse'].includes(gender) ? gender : null,
    );
  }
  for (const salutation of ['mr', 'ms', 'mx', 'other', '', 'MR', 'unknown']) {
    const parsed = parseClientUpdate(form({ salutation }));
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.salutation as string | null).toEqual(
      ['mr', 'ms', 'mx', 'other'].includes(salutation) ? salutation : null,
    );
  }
});

test('UUID version, variant, case and whitespace acceptance stays compatible', () => {
  for (const valid of [
    id,
    ` ${id.toUpperCase()} `,
    '12345678-1234-1234-9234-123456789abc',
    '12345678-1234-8234-b234-123456789abc',
  ])
    expect(parseClientUpdate(form({ id: valid })).success).toBe(true);
  for (const invalid of [
    '',
    'not-a-uuid',
    '12345678-1234-0234-8234-123456789abc',
    '12345678-1234-9234-8234-123456789abc',
    '12345678-1234-4234-7234-123456789abc',
  ])
    expect(parseClientUpdate(form({ id: invalid })).success).toBe(false);
  const input = form();
  input.set('id', new File([id], 'id.txt'));
  expect(parseClientUpdate(input).success).toBe(false);
});

test('first entries win and unrelated/action/tenant fields never enter the payload', () => {
  const input = form({ tenantId: 'forged', organizationId: 'forged', $ACTION_ID: 'ignored' });
  input.append('firstName', 'second value');
  const parsed = parseClientUpdate(input);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw parsed.error;
  expect(parsed.data.firstName).toBe('Ada');
  expect(Object.keys(parsed.data)).toHaveLength(11);
  expect(parsed.data).not.toHaveProperty('tenantId');
  expect(parsed.data).not.toHaveProperty('organizationId');
});
