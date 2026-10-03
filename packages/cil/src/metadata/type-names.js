import { CilError } from '../binary.js';
import { token, decodeCoded } from './indices.js';
import { readTypeSignature } from './signature-members.js';

/** Per-reader lazy NestedClass index. Construction is O(rows); each enclosing-type lookup is O(1). */
export class MetadataTypeNames {
  constructor() {
    this.parents = null;
  }

  parent(metadata, id) {
    if (this.parents === null) {
      const rows = metadata.rows[41] ?? [], count = metadata.rows[2]?.length ?? 0;
      if (rows.length > 1_000_000) throw new CilError('NestedClass row limit exceeded');
      const parents = new Map();
      for (const [child, parent] of rows) {
        if (!Number.isInteger(child) || child < 1 || child > count || !Number.isInteger(parent) || parent < 1 || parent > count) {
          throw new CilError('Invalid NestedClass type index');
        }
        if (parents.has(child)) throw new CilError('Duplicate NestedClass type index');
        parents.set(child, parent);
      }
      this.parents = parents;
    }
    return this.parents.get(id);
  }

  /** Preserve TypeSpec decoder depth and the historical 64-level TypeDef/TypeRef nesting limit. */
  read(metadata, value, depth = 0) {
    if (depth > 64) throw new CilError('Recursive TypeSpec or nesting limit exceeded');
    const row = metadata.row(value), table = value >>> 24;
    if (table === 27) return readTypeSignature(metadata.blob(row[0]), metadata, depth + 1);
    if (table !== 1 && table !== 2) throw new CilError('Unsupported CLI type token');
    const name = metadata.string(row[1]), namespace = metadata.string(row[2]);
    const parent = table === 2 ? this.parent(metadata, value & 0xffffff) : null;
    if (parent) return this.read(metadata, token(2, parent), depth + 1) + '+' + name;
    const scope = table === 1 ? decodeCoded('ResolutionScope', row[0]) : 0;
    if (scope >>> 24 === 1) return this.read(metadata, scope, depth + 1) + '+' + name;
    return namespace ? namespace + '.' + name : name;
  }
}
