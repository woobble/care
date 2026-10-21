import { z } from 'zod';

import type { FormActionFailure } from '@app/web/lib/form-action-failure';

import { readUuid } from './client-form-data';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const requiredName = z.preprocess(text, z.string().min(1, 'required'));
const nullableText = z.preprocess((value) => text(value) || null, z.string().nullable());
function nullableChoice<const Values extends readonly [string, ...string[]]>(values: Values) {
  return z.preprocess((value) => {
    const parsed = text(value);
    return values.includes(parsed) ? parsed : null;
  }, z.enum(values).nullable());
}

export const clientUpdateSchema = z.object({
  id: z.preprocess((value) => readUuid(typeof value === 'string' ? value : null), z.string()),
  firstName: requiredName,
  lastName: requiredName,
  preferredName: nullableText,
  dateOfBirth: nullableText,
  dateOfDeath: nullableText,
  gender: nullableChoice(['female', 'male', 'diverse']),
  salutation: nullableChoice(['mr', 'ms', 'mx', 'other']),
  email: nullableText,
  phone: nullableText,
  mobile: nullableText,
});

export type ClientUpdateInput = z.output<typeof clientUpdateSchema>;
export type ClientUpdateField = keyof ClientUpdateInput;
export type ClientUpdateFailure = FormActionFailure<ClientUpdateField>;

export function parseClientUpdate(formData: FormData) {
  // Read known fields with get(), preserving first-entry and non-string semantics.
  return clientUpdateSchema.safeParse(
    Object.fromEntries(
      clientUpdateSchema.keyof().options.map((name) => [name, formData.get(name)]),
    ),
  );
}
