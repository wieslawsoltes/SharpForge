import { unknown } from '../metadata-types/results.js';
import { rejectMember } from './budget.js';

/** Search one canonical local base chain; the type snapshot already rejects cycles. */
export function memberLookup(snapshot, types, budget) {
  return (reference, token, owner, kind) => {
    let current = owner;
    let depth = 0;
    let visited = 1;
    while (true) {
      budget.check();
      const record = snapshot.index.get(current.token)?.get(reference.name)?.get(reference.signature.key);
      if (record === null) return unknown('ambiguous-member', token);
      if (record) return record;
      // CoreCLR field resolution is declaration-only; methods may search class bases.
      const initializer = kind === 'method' && (reference.name === '.ctor' || reference.name === '.cctor');
      if (kind === 'field' || current.isInterface || initializer) {
        return unknown('unresolved-member-declaration', token);
      }
      if (depth >= budget.maxDepth || visited >= budget.maxQueryNodes) rejectMember('CILVM0002', 'member base lookup');
      const base = types.baseType(current);
      if (base.status === 'unknown') return base;
      if (!base.value) return unknown('unresolved-member-declaration', token);
      current = base.value;
      depth++;
      visited++;
    }
  };
}
