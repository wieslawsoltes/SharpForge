import { hierarchyIndex, checkedToken } from './tokens.js';
import { known, unknown, rejectTypeSystem } from './results.js';
import { localTypeReferences } from './local-references.js';
import { snapshotTypeCategories } from './categories.js';

function checkCycles(records, budget) {
  const colors = new Map();
  for (const record of records.values()) {
    const pending = [[record, false]];
    while (pending.length) {
      budget.check();
      const [current, leave] = pending.pop();
      if (leave) { colors.set(current.type.token, 2); continue; }
      const color = colors.get(current.type.token);
      if (color === 1) rejectTypeSystem('CILVT0001', 'cyclic type hierarchy');
      if (color === 2) continue;
      colors.set(current.type.token, 1);
      pending.push([current, true]);
      for (const token of current.edges) {
        const next = records.get(token);
        if (next) pending.push([next, false]);
      }
    }
  }
}

/** Own only bounded hierarchy facts; never retain inspector descriptors, PE bytes or signature ASTs. */
export function snapshotTypes(inspector, budget, coreTypes) {
  budget.check();
  const rows = inspector?.metadata?.rows;
  if (!rows) rejectTypeSystem('CILVT0001', 'AssemblyInspector metadata is required');
  const counts = Object.fromEntries([1, 2, 27].map(table => [table, rows[table]?.length ?? 0]));
  const interfaces = rows[9] ?? [];
  const parameters = rows[42] ?? [];
  if (counts[2] > budget.maxTypes || counts[1] > budget.maxTypeReferences || interfaces.length + counts[2] > budget.maxEdges ||
      parameters.length > budget.maxEdges) rejectTypeSystem('CILVT0002', 'metadata rows');
  const records = new Map();
  const identities = new Map();
  for (let index = 0; index < counts[2]; index++) {
    budget.check();
    const row = rows[2][index];
    const token = 0x02000001 + index;
    const baseToken = hierarchyIndex('TypeDefOrRef', row[3]);
    if (baseToken) checkedToken(baseToken, counts);
    const flags = row[0];
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) rejectTypeSystem('CILVT0001', 'type flags');
    const type = Object.freeze({ kind: 'definition', token, isInterface: !!(flags & 0x20), flags });
    const record = { type, result: known(type), baseToken, interfaces: [], edges: baseToken ? [baseToken] : [],
      generic: false, category: null, categoryDepth: 0 };
    records.set(token, record);
    identities.set(type, record);
  }
  for (const row of interfaces) {
    budget.check();
    const owner = records.get(checkedToken(0x02000000 + row[0], counts, [2]));
    const token = checkedToken(hierarchyIndex('TypeDefOrRef', row[1]), counts);
    owner.interfaces.push(token);
    owner.edges.push(token);
  }
  for (const row of parameters) {
    budget.check();
    const owner = hierarchyIndex('TypeOrMethodDef', row[2]);
    if (owner >>> 24 === 2) records.get(checkedToken(owner, counts, [2])).generic = true;
  }
  const { aliases, lexical } = localTypeReferences(inspector.metadata, records, budget);
  for (const record of records.values()) {
    budget.check();
    record.baseToken = aliases?.get(record.baseToken) ?? record.baseToken;
    for (let index = 0; index < record.interfaces.length; index++) {
      budget.check();
      const token = aliases?.get(record.interfaces[index]) ?? record.interfaces[index];
      record.interfaces[index] = token;
      if (records.has(token) && !records.get(token).type.isInterface) rejectTypeSystem('CILVT0001', 'InterfaceImpl target');
    }
    for (let index = 0; index < record.edges.length; index++) {
      budget.check();
      record.edges[index] = aliases?.get(record.edges[index]) ?? record.edges[index];
    }
    const base = records.get(record.baseToken);
    if (base?.type.isInterface) rejectTypeSystem('CILVT0001', 'class base is an interface');
    Object.freeze(record.interfaces);
    Object.freeze(record.edges);
  }
  checkCycles(records, budget);
  snapshotTypeCategories(records, coreTypes, budget);
  for (const record of records.values()) { budget.check(); Object.freeze(record); }
  return { lexical, snapshot: { records, identities, resolve(token) {
    budget.check();
    checkedToken(token, counts);
    const record = records.get(aliases?.get(token) ?? token);
    if (record?.generic) return unknown('generic-definition', token);
    if (record) return record.result;
    return unknown(token >>> 24 === 1 ? 'unresolved-type-reference' : 'type-specification', token);
  } } };
}
