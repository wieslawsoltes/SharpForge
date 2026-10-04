import { sha1 } from '../binary/sha1.js';
import { normalizeAssemblyVersion, normalizeAssemblyCulture } from '../metadata/assembly-identity.js';
import { hierarchyKey, invalidHierarchy } from './hierarchy-budget.js';

/** Exact declared identities only: no assembly loading, signature verification or version unification. */
export function hierarchyAssemblyIdentity(metadata, row, reference = false) {
  const offset = reference ? 0 : 1;
  const version = normalizeAssemblyVersion(row.slice(offset, offset + 4));
  const flags = row[reference ? 4 : 5];
  const key = hierarchyKey(metadata, row[reference ? 5 : 6]);
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) invalidHierarchy('assembly flags');
  const content = flags & 0xe00;
  if (content !== 0 && content !== 0x200) invalidHierarchy('assembly content type');
  const fullKey = !reference || !!(flags & 1);
  if (fullKey ? key.length !== 0 && key.length < 16 : key.length !== 0 && key.length !== 8) invalidHierarchy('assembly key');
  if (!reference && !!(flags & 1) !== !!key.length || reference && flags & 1 && !key.length) invalidHierarchy('assembly key flag');
  const token = fullKey && key.length ? sha1(key).subarray(12).reverse() : key;
  const name = metadata.string(row[reference ? 6 : 7]);
  if (!name || name.length > 512 || /[\0/\\]/.test(name)) invalidHierarchy('assembly name');
  const culture = normalizeAssemblyCulture(metadata.string(row[reference ? 7 : 8]).toLowerCase());
  const tokenText = Array.from(token, byte => byte.toString(16).padStart(2, '0')).join('');
  return { key: JSON.stringify([name.toLowerCase(), version, culture, tokenText, content, flags & 0x100]), retargetable: !!(flags & 0x100) };
}
