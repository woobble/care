/** Keys in Common.formValidation; results carry codes, never backend messages. */
export type FormActionErrorKey = 'required' | 'actionFailed';

export type FormActionFailure<Field extends string = string> = Readonly<{
  ok: false;
  fieldErrors?: Partial<Record<Field, readonly FormActionErrorKey[]>>;
  formError?: FormActionErrorKey;
}>;

export function isFormActionFailure(value: unknown): value is FormActionFailure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

export function safeFormActionErrorKey(value: unknown): FormActionErrorKey {
  return value === 'required' ? 'required' : 'actionFailed';
}
