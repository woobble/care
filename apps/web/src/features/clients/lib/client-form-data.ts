import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function readNullableText(formData: FormData, name: string): string | null {
  return readString(formData, name) || null;
}

export function readNullableDate(formData: FormData, name: string): string | null {
  return readString(formData, name) || null;
}

export function readUuid(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return uuidPattern.test(id) ? id : undefined;
}

export function requireClientId(formData: FormData): string {
  const id = readUuid(formData.get('id'));
  if (!id) redirect('/clients?error=INVALID_REQUEST');
  return id;
}

export function readChoice<const Values extends readonly string[]>(
  formData: FormData,
  name: string,
  values: Values,
): Values[number] | undefined {
  const value = readString(formData, name);
  return values.includes(value) ? (value as Values[number]) : undefined;
}

export function clientPath(id: string, error: string): string {
  return error
    ? `/clients/${encodeURIComponent(id)}?error=${encodeURIComponent(error)}`
    : `/clients/${encodeURIComponent(id)}`;
}

export async function refreshClient(id: string): Promise<void> {
  revalidatePath('/clients');
  revalidatePath(`/clients/${id}`);
}
