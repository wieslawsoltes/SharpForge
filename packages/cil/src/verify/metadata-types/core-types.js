import { known, unknown, rejectTypeSystem } from './results.js';

const categories = Object.freeze({ reference: known('reference'), value: known('value'), enum: known('enum') });

function result(value) {
  if (!value || typeof value !== 'object' || !['known', 'unknown'].includes(value.status))
    rejectTypeSystem('CILVT0001', 'synchronous core type result required');
  if (value.status === 'unknown' && (typeof value.reason !== 'string' || value.reason.length > 256))
    rejectTypeSystem('CILVT0001', 'core type unknown reason');
  return value;
}

/** Categories describe representations, never replacement identities for the supplied canonical handles. */
export function inheritedCategory(parent, category, flags, role) {
  if (parent.isInterface || parent.flags & 0x100)
    rejectTypeSystem('CILVT0001', 'interface or sealed class base');
  if (category.status === 'unknown') return category;
  if (category.value !== 'reference') rejectTypeSystem('CILVT0001', 'value type inheritance');
  if (role === 'valueType' || role === 'enum') {
    if (!(flags & 0x100)) rejectTypeSystem('CILVT0001', 'unsealed value type');
    return categories[role === 'enum' ? 'enum' : 'value'];
  }
  return categories.reference;
}

function coreSnapshot(context, budget) {
  const records = new Map();
  function invoke(operation) {
    budget.check();
    const value = result(operation());
    budget.check();
    return value;
  }
  function record(type) {
    if (records.has(type)) return records.get(type);
    if (records.size >= budget.maxQueryNodes) rejectTypeSystem('CILVT0002', 'core category nodes');
    if (!type || !Object.isFrozen(type) || type.kind !== 'definition' ||
        !Number.isInteger(type.token) || type.token < 0x02000001 || type.token > 0x02ffffff ||
        !Number.isInteger(type.flags) || type.flags < 0 || type.flags > 0xffffffff ||
        type.isInterface !== !!(type.flags & 0x20)) rejectTypeSystem('CILVT0001', 'core canonical type shape');
    const resolved = invoke(() => context.resolveType(type.token));
    if (resolved.status !== 'known' || resolved.value !== type) rejectTypeSystem('CILVT0001', 'foreign core type identity');
    const value = { type, base: null, category: null, depth: 0 };
    records.set(type, value);
    return value;
  }
  function base(current) {
    if (current.base) return current.base;
    const value = invoke(() => context.baseType(current.type));
    if (value.status === 'known' && value.value !== null) record(value.value);
    current.base = value.status === 'known' ? known(value.value) : unknown(value.reason, current.type.token);
    return current.base;
  }
  return { record, base, invoke };
}

/** Snapshot a trusted, synchronously prepared binding authority; all caches are construction-only. */
export function coreTypeAuthority(input, budget) {
  const context = input?.context;
  if (!input || typeof input !== 'object' || typeof input.resolveType !== 'function' ||
      typeof context?.resolveType !== 'function' || typeof context.baseType !== 'function')
    rejectTypeSystem('CILVT0001', 'core type authority');
  const { record, base, invoke } = coreSnapshot(context, budget);
  const bindings = new Map();
  const roles = new Map();
  for (const role of ['object', 'valueType', 'enum']) {
    const current = record(input[role]);
    if (roles.has(current.type) || (current.type.token & 0xffffff) === 1 || current.type.isInterface || current.type.flags & 0x100)
      rejectTypeSystem('CILVT0001', 'fundamental root identity or flags');
    roles.set(current.type, role);
    current.category = categories.reference;
  }
  for (const [role, parent] of [['object', null], ['valueType', input.object], ['enum', input.valueType]]) {
    const actual = base(record(input[role]));
    if (actual.status !== 'known' || actual.value !== parent)
      rejectTypeSystem('CILVT0001', 'fundamental root base chain');
  }
  function classify(type) {
    let current = record(type);
    const path = [];
    const active = new Set();
    while (!current.category) {
      budget.check();
      if (current.type.isInterface) { current.category = categories.reference; break; }
      if (active.has(current)) rejectTypeSystem('CILVT0001', 'cyclic core category chain');
      if (path.length >= budget.maxDepth) rejectTypeSystem('CILVT0002', 'core category depth');
      active.add(current);
      path.push(current);
      const parent = base(current);
      if (parent.status === 'unknown' || parent.value === null) {
        current.category = unknown(parent.reason ?? 'unbound-core-root', current.type.token);
        current.depth = parent.status === 'unknown' ? 1 : 0;
        break;
      }
      current = record(parent.value);
    }
    while (path.length) {
      budget.check();
      current = path.pop();
      if (current.category) continue;
      const parent = record(current.base.value);
      current.depth = parent.depth + 1;
      if (current.depth > budget.maxDepth) rejectTypeSystem('CILVT0002', 'core category depth');
      current.category = inheritedCategory(parent.type, parent.category, current.type.flags, roles.get(parent.type));
    }
    return record(type).category;
  }
  return {
    role: type => roles.get(type),
    depth: type => record(type).depth,
    classify,
    resolve(token) {
      budget.check();
      if (bindings.has(token)) return bindings.get(token);
      const value = invoke(() => input.resolveType(token));
      if (value.status === 'known') record(value.value);
      const owned = value.status === 'known' ? known(value.value) : unknown(value.reason, token);
      bindings.set(token, owned);
      return owned;
    },
  };
}
