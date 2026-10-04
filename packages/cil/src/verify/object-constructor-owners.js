import { coreTypeAuthority } from './metadata-types/core-types.js';
import { typeSystemBudget, rejectTypeSystem } from './metadata-types/results.js';

/** Ordinary local class construction requires a closed path to the canonical external Object root. */
export function objectConstructorOwners(types, options, fail) {
  const budget = typeSystemBudget(options);
  const ordinary = new Set();
  let authority;
  return owner => {
    const path = [];
    let current = owner;
    while (!ordinary.has(current)) {
      budget.check();
      if (path.length >= budget.maxDepth || ordinary.size + path.length >= budget.maxQueryNodes)
        rejectTypeSystem('CILVT0002', 'constructor base nodes');
      path.push(current);
      const base = types.baseType(current);
      if (base.status === 'known' && base.value !== null) {
        current = base.value;
        continue;
      }
      authority ??= coreTypeAuthority(options.coreTypes, budget);
      const bound = authority.resolve(base.status === 'known' ? current.token : base.token);
      if (authority.sameModule !== false || bound.status !== 'known' || authority.role(bound.value) !== 'object')
        fail('ConstructorBaseUnavailable', 'Ordinary class construction requires a local path to an external Object root', true);
      break;
    }
    for (const type of path) ordinary.add(type);
  };
}
