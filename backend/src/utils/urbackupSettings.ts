/**
 * UrBackup returns a client's (or group's) settings as
 * {key: {use, value?, value_group?, value_client?}}. `use` is a bitmask:
 * 1 = take the group's value, 2 = take this client's own value, 4 = take
 * what the client reported. A setting the client only inherits comes back
 * with value_group and no value, so the effective value is value ?? value_group.
 */
export interface FlatClientSettings {
  settings: Record<string, any>;
  useValues: Record<string, number>;
  /** Keys whose value comes from the group, not from this client or group itself. */
  inherited: string[];
}

export function flattenClientSettings(raw: Record<string, any>): FlatClientSettings {
  const settings: Record<string, any> = {};
  const useValues: Record<string, number> = {};
  const inherited: string[] = [];
  for (const [key, val] of Object.entries(raw || {})) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const v = val as Record<string, any>;
      if ('value' in v && v.value !== null && v.value !== undefined) settings[key] = v.value;
      else if ('value_group' in v && v.value_group !== null && v.value_group !== undefined) settings[key] = v.value_group;
      if ('use' in v) {
        const use = Number(v.use);
        useValues[key] = use;
        if (!(use & 2) && (use & 1)) inherited.push(key);
      }
    } else if (typeof val !== 'object') {
      settings[key] = val;
    }
  }
  return { settings, useValues, inherited };
}

/** Group names: shown in UrBackup's own interface and stored as given. */
export function validateGroupName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Group name is required' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Group name is required' };
  if (name.length > 64) return { error: 'Group names can be at most 64 characters' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f'"`\\]/.test(name)) return { error: 'Group names cannot contain quotes, backslashes or control characters' };
  return { name };
}

/**
 * UrBackup pattern lists (exclude_files and friends) are `;`-separated.
 * Windows paths are case-insensitive, so duplicates are compared that way.
 */
export function splitPatterns(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of raw.split(';').map(s => s.trim())) {
    if (p && !seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); out.push(p); }
  }
  return out;
}

/** Every pattern of each list in turn, without duplicates. */
export function mergePatterns(...lists: string[][]): string[] {
  return splitPatterns(lists.flat().join(';'));
}

/** The patterns of `list` that are not in `remove`. */
export function subtractPatterns(list: string[], remove: string[]): string[] {
  const drop = new Set(remove.map(p => p.toLowerCase()));
  return list.filter(p => !drop.has(p.toLowerCase()));
}

export function samePatterns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p.toLowerCase() === b[i].toLowerCase());
}
