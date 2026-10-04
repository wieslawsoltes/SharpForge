import { known, unknown, yes, no, rejectTypeSystem } from './results.js';

export function metadataHierarchy(snapshot, budget) {
  function requireType(type) {
    budget.check();
    const record = snapshot.identities.get(type);
    if (!record || record.generic) rejectTypeSystem('CILVT0004');
    return record;
  }
  function walk(type, includeInterfaces) {
    if (!budget.maxQueryNodes) rejectTypeSystem('CILVT0002', 'hierarchy query');
    const initial = requireType(type);
    const pending = [[initial, 0]];
    const scheduled = new Set([initial]);
    const types = [];
    let missing = null;
    for (let index = 0; index < pending.length; index++) {
      budget.check();
      const [record, depth] = pending[index];
      types.push(record.type);
      const edges = includeInterfaces ? record.edges : record.baseToken ? [record.baseToken] : [];
      for (const token of edges) {
        const result = snapshot.resolve(token);
        if (result.status === 'unknown') {
          // A complete core class chain in a proven different module cannot contain a local class identity.
          if (includeInterfaces || !record.closedExternalBase) missing ??= result;
        }
        else {
          const next = snapshot.identities.get(result.value);
          if (scheduled.has(next)) continue;
          if (depth >= budget.maxDepth || scheduled.size >= budget.maxQueryNodes) rejectTypeSystem('CILVT0002', 'hierarchy query');
          scheduled.add(next);
          pending.push([next, depth + 1]);
        }
      }
    }
    return { types, missing };
  }
  function isAssignable(source, target) {
    requireType(source);
    requireType(target);
    if (source === target) return yes;
    // Mapping an interface to System.Object needs a resolved core-library identity.
    if (source.isInterface && !target.isInterface) return unknown('interface-object-root');
    const ancestors = walk(source, target.isInterface);
    if (ancestors.types.includes(target)) return yes;
    return ancestors.missing ?? no;
  }
  function commonBaseType(left, right) {
    requireType(left);
    requireType(right);
    if (left === right) return known(left);
    if (left.isInterface || right.isInterface) return unknown('interface-common-type');
    const leftBases = walk(left, false);
    const rightBases = walk(right, false);
    const candidates = new Set(rightBases.types);
    const common = leftBases.types.find(type => candidates.has(type));
    return common ? known(common) : leftBases.missing ?? rightBases.missing ?? unknown('no-common-type');
  }
  return { requireType, isAssignable, commonBaseType,
    baseType(type) {
      const token = requireType(type).baseToken;
      return token ? snapshot.resolve(token) : known(null);
    },
    interfaces(type) {
      return known(Object.freeze(requireType(type).interfaces.map(token => snapshot.resolve(token))));
    },
  };
}
