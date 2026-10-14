const API_PATH_PREFIX = '/api/v1/';

/** Resolve a server-side API path without allowing it to select another origin. */
export function resolveCareApiUrl(path: string, baseUrl: string): URL {
  const containsControlCharacter = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (
    !path.startsWith(API_PATH_PREFIX) ||
    path.startsWith('//') ||
    path.includes('\\') ||
    containsControlCharacter
  ) {
    throw new Error('Care API requests require a rooted /api/v1 path.');
  }

  const trustedBase = new URL(baseUrl);
  const target = new URL(path, trustedBase);
  if (target.origin !== trustedBase.origin || !target.pathname.startsWith(API_PATH_PREFIX)) {
    throw new Error('Care API request URL must remain within the API origin and path.');
  }

  return target;
}
