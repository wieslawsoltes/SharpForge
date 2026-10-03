import { CilError } from '../binary.js';

export const moduleLimits = Object.freeze({ files: 128, bytes: 64 * 1024 * 1024, types: 65536, exports: 16384 });

export function moduleFileName(name) {
  if (typeof name !== 'string' || !name || name.length > 512 || /[\0/\\]/.test(name) || name === '.' || name === '..') {
    throw new CilError('Invalid linked module file name');
  }
  return name;
}

/** Project public TypeDefs in parent-first order; inaccessible nested types are not exported. */
export function moduleTypeExports(metadata, budget) {
  const rows = metadata.rows[2] ?? [], nested = metadata.rows[41] ?? [];
  if (rows.length > moduleLimits.types || nested.length > rows.length) throw new CilError('Linked module type limit exceeded');
  const parents = new Map(), states = new Map(), result = [];
  for (const [child, parent] of nested) {
    if (!rows[child - 1] || !rows[parent - 1] || parents.has(child)) throw new CilError('Invalid linked module nesting');
    parents.set(child, parent);
  }
  function visit(id, depth = 0) {
    if (depth > 64 || states.get(id) === false) throw new CilError('Cyclic or excessive linked module nesting');
    if (states.has(id)) return states.get(id);
    states.set(id, false);
    const row = rows[id - 1], parentId = parents.get(id), visibility = row[0] & 7;
    const parent = parentId ? visit(parentId, depth + 1) : null;
    if (parentId ? visibility !== 2 || !parent : visibility !== 1) {
      states.set(id, null);
      return null;
    }
    if (++budget.count > moduleLimits.exports) throw new CilError('Linked module exported type limit exceeded');
    const name = metadata.string(row[1]), namespace = metadata.string(row[2]);
    if (!name || name.length > 512 || namespace.length > 512 || parent && namespace) {
      throw new CilError('Invalid linked module exported type name');
    }
    const fullName = parent ? `${parent.fullName}+${name}` : namespace ? `${namespace}.${name}` : name;
    if (fullName.length > 4096) throw new CilError('Linked module exported type name limit exceeded');
    const value = { id, flags: visibility, name, namespace, fullName, parent };
    states.set(id, value);
    result.push(value);
    return value;
  }
  for (let id = 1; id <= rows.length; id++) visit(id);
  return result;
}
