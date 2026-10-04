import { hierarchyIndex, checkedToken } from './tokens.js';
import { rejectTypeSystem } from './results.js';
import { localDefinitionNames } from './definition-names.js';
import { maxNestingDepth } from '../metadata-nesting.js';

function resolveNested(references, aliases, context) {
  const { metadata, records, budget, names } = context;
  const colors = new Uint8Array((metadata.rows[1]?.length ?? 0) + 1);
  const depths = new Uint8Array(colors.length);
  const maximum = Math.min(budget.maxDepth, maxNestingDepth);
  const path = [];
  for (const token of references.keys()) {
    budget.check();
    let current = token;
    while (references.has(current) && colors[current & 0xffffff] !== 2) {
      budget.check();
      const rid = current & 0xffffff;
      if (colors[rid] === 1) rejectTypeSystem('CILVT0001', 'cyclic TypeRef scopes');
      if (path.length >= maximum) rejectTypeSystem('CILVT0002', 'TypeRef scope depth');
      colors[rid] = 1;
      path.push(current);
      current = references.get(current);
    }
    let target = aliases.get(current) ?? 0;
    let depth = depths[current & 0xffffff];
    while (path.length) {
      budget.check();
      const reference = path.pop();
      const rid = reference & 0xffffff;
      if (++depth > maximum) rejectTypeSystem('CILVT0002', 'TypeRef scope depth');
      // An open enclosing definition cannot establish a closed nested identity.
      target = target && !records.get(target).generic ? names.nested(target, metadata.rows[1][rid - 1]) : 0;
      if (target) aliases.set(reference, target);
      depths[rid] = depth;
      colors[rid] = 2;
    }
  }
}

/** Own numeric aliases to existing definitions; unresolved scopes never bind by spelling. */
export function localTypeReferences(metadata, records, budget) {
  const rows = metadata.rows[1] ?? [];
  if (rows.length > budget.maxTypeReferences) rejectTypeSystem('CILVT0002', 'TypeRef rows');
  const counts = Object.fromEntries([0, 1, 26, 35].map(table => [table, metadata.rows[table]?.length ?? 0]));
  let aliases = null;
  let names = null;
  let nested = null;
  for (let index = 0; index < rows.length; index++) {
    budget.check();
    const row = rows[index];
    const scope = hierarchyIndex('ResolutionScope', row[0]);
    if (scope) checkedToken(scope, counts, [0, 1, 26, 35]);
    const token = 0x01000001 + index;
    if (scope >>> 24 === 1) {
      nested ??= new Map();
      nested.set(token, scope);
      continue;
    }
    // Nil scope can require assembly-wide ExportedType resolution, not a current-module lookup.
    if (!scope || scope >>> 24 !== 0) continue;
    if (scope !== 1 || metadata.rows[0]?.length !== 1) rejectTypeSystem('CILVT0001', 'local Module scope');
    aliases ??= new Map();
    names ??= localDefinitionNames(metadata, records, budget);
    const target = names.top(row);
    if (target) aliases.set(token, target);
  }
  if (nested) {
    aliases ??= new Map();
    resolveNested(nested, aliases, { metadata, records, budget, names });
  }
  return { aliases, lexical: names?.lexical ?? null };
}
