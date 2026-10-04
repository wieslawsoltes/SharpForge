import { known, unknown, rejectTypeSystem } from './results.js';
import { coreTypeAuthority, inheritedCategory } from './core-types.js';

const reference = known('reference');

function fundamentalDefinitions(records, authority, budget) {
  const definitions = new Map();
  for (const record of records.values()) {
    budget.check();
    if (record.generic) continue;
    const bound = authority.resolve(record.type.token);
    if (bound.status !== 'known') continue;
    const role = authority.role(bound.value);
    if (!role) continue;
    if (definitions.has(role) || record.type.token === 0x02000001 || record.type.flags !== bound.value.flags)
      rejectTypeSystem('CILVT0001', 'fundamental definition alias or flags');
    definitions.set(role, record);
    record.category = reference;
  }
  for (const [role, record] of definitions) {
    budget.check();
    if (role === 'object') {
      if (record.baseToken) rejectTypeSystem('CILVT0001', 'fundamental object base');
      continue;
    }
    if (!record.baseToken || record.baseToken >>> 24 === 27)
      rejectTypeSystem('CILVT0001', 'fundamental definition base chain');
    const base = authority.resolve(record.baseToken);
    const expected = role === 'enum' ? 'valueType' : 'object';
    if (base.status !== 'known' || authority.role(base.value) !== expected)
      rejectTypeSystem('CILVT0001', 'fundamental definition base chain');
  }
  return definitions;
}

/** Own category facts on existing definition records; the optional authority never changes local token resolution. */
export function snapshotTypeCategories(records, input, budget) {
  for (const record of records.values()) {
    budget.check();
    if (record.type.isInterface) record.category = reference;
  }
  const authority = coreTypeAuthority(input, budget);
  const roots = fundamentalDefinitions(records, authority, budget);
  const roles = new Map([...roots].map(([role, record]) => [record.type, role]));
  for (const initial of records.values()) {
    budget.check();
    if (initial.generic || initial.category) continue;
    let current = initial;
    const path = [];
    while (!current.category) {
      budget.check();
      if (current.generic) { current.category = unknown('generic-definition', current.type.token); break; }
      if (path.length >= budget.maxDepth) rejectTypeSystem('CILVT0002', 'local category depth');
      path.push(current);
      const parent = records.get(current.baseToken);
      if (parent) { current = parent; continue; }
      if (!current.baseToken || current.baseToken >>> 24 !== 1) {
        current.category = unknown('unbound-category-base', current.baseToken);
        current.categoryDepth = current.baseToken ? 1 : 0;
        break;
      }
      const bound = authority.resolve(current.baseToken);
      current.category = bound.status === 'unknown' ? unknown(bound.reason, current.baseToken)
        : inheritedCategory(bound.value, authority.classify(bound.value), current.type.flags, authority.role(bound.value));
      current.categoryDepth = bound.status === 'known' ? authority.depth(bound.value) + 1 : 1;
      if (current.categoryDepth > budget.maxDepth) rejectTypeSystem('CILVT0002', 'local category depth');
    }
    while (path.length) {
      budget.check();
      current = path.pop();
      if (current.category) continue;
      const parent = records.get(current.baseToken);
      current.categoryDepth = parent.categoryDepth + 1;
      if (current.categoryDepth > budget.maxDepth) rejectTypeSystem('CILVT0002', 'local category depth');
      current.category = inheritedCategory(parent.type, parent.category, current.type.flags, roles.get(parent.type));
    }
  }
}
