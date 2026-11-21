/**
 * Endpoint names become UrBackup client names and storage folder names.
 * UrBackup's add_client doubles an apostrophe ("Jen's" is stored as
 * "Jen''s"), and the other characters are not allowed in Windows folder
 * names, so the name the client sends would no longer match.
 */
export const FORBIDDEN_NAME_CHARS = `'"\`\\/:*?<>|`;
export const MAX_CLIENT_NAME_LENGTH = 64;

/** Returns the cleaned-up name, or an error message. */
export function validateClientName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Endpoint name is required' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Endpoint name is required' };
  if (name.length > MAX_CLIENT_NAME_LENGTH) return { error: `Endpoint names can be at most ${MAX_CLIENT_NAME_LENGTH} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: 'Endpoint names cannot contain control characters' };
  const bad = [...new Set([...name].filter(ch => FORBIDDEN_NAME_CHARS.includes(ch)))];
  if (bad.length) {
    return { error: `Endpoint names cannot contain ${bad.join(' ')} (not allowed: ${[...FORBIDDEN_NAME_CHARS].join(' ')})` };
  }
  if (name.endsWith('.')) return { error: 'Endpoint names cannot end with a dot' };
  return { name };
}
