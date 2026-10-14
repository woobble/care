export function safePlanningReturnTo(value: string | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://care.invalid');
    if (url.origin !== 'https://care.invalid' || url.pathname !== '/planning') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
