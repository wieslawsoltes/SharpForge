import {copyBuiltinArraySlots} from './builtin-registry-array.js';

/** Append validated contributions; only the known default table opts into occupied-slot copies. */
export function createBuiltinRegistry(base, useOccupiedSlots = false) {
  // Custom arrays retain their own slice/species/accessor/proxy behavior.
  const entries = useOccupiedSlots ? copyBuiltinArraySlots(base) : Array.isArray(base) ? base.slice() : [...base];
  const byName = useOccupiedSlots ? new Map() : new Map(entries.filter(Boolean).map(entry => [entry.name, entry]));
  if (useOccupiedSlots) {
    for (const entry of Object.values(entries)) if (entry) byName.set(entry.name, entry);
  }
  return {
    get entries() {
      return Object.freeze(useOccupiedSlots ? copyBuiltinArraySlots(entries) : entries.slice());
    },
    get(name) {
      return byName.get(name) ?? null;
    },
    register(contribution, {signal} = {}) {
      signal?.throwIfAborted();
      if (!contribution || typeof contribution.name !== 'string' || !Array.isArray(contribution.definitions)) {
        throw new TypeError('Malformed builtin contribution');
      }
      const staged = [];
      const names = new Set();
      for (const row of contribution.definitions) {
        if (!Array.isArray(row) || row.length !== 5) {
          throw new TypeError(`[${contribution.name}] Malformed builtin`);
        }
        const [name, min, max, result, params] = row;
        if (typeof name !== 'string' || !name || name.startsWith('$framework:') || byName.has(name) || names.has(name)) {
          throw new Error(`[${contribution.name}] Duplicate or reserved builtin ${name}`);
        }
        if (!Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(max) || max < min ||
            typeof result !== 'string' || !Array.isArray(params) || max !== params.length ||
            params.some(parameter => typeof parameter !== 'string')) {
          throw new TypeError(`[${contribution.name}] Invalid builtin signature`);
        }
        names.add(name);
        staged.push(Object.freeze({
          id: entries.length + staged.length, name, min, max, result, params: Object.freeze([...params])
        }));
      }
      signal?.throwIfAborted();
      for (const entry of staged) {
        entries.push(entry);
        byName.set(entry.name, entry);
      }
      return Object.freeze(staged);
    }
  };
}
