import { rejectMember } from './budget.js';

// Independent of inheritance: bounded lexical ownership never grants reverse private access.
export const maxNestingDepth = 64;
export const maxAccessChecks = 4096;

/** Copy a validated NestedClass forest. Zero means top-level; values are raw TypeDef RIDs. */
export function snapshotNesting(rows, visibility, budget) {
  if (rows.length > visibility.length) rejectMember('CILVM0002', 'nested type rows');
  if (!rows.length) {
    if (visibility.some(value => value >= 2)) rejectMember('CILVM0001', 'missing nested type owner');
    return null;
  }
  const parents = new Uint32Array(visibility.length + 1);
  const colors = new Uint8Array(parents.length);
  const depths = new Uint8Array(parents.length);
  for (const row of rows) {
    budget.check();
    if (!Array.isArray(row) || row.length !== 2) rejectMember('CILVM0001', 'nested type row shape');
    for (const rid of row) {
      if (!Number.isInteger(rid) || rid < 1 || rid > visibility.length || rid > 0xffffff)
        rejectMember('CILVM0001', 'nested type RID');
    }
    if (parents[row[0]]) rejectMember('CILVM0001', 'duplicate nested type owner');
    parents[row[0]] = row[1];
  }
  const path = [];
  for (let rid = 1; rid < parents.length; rid++) {
    budget.check();
    if ((visibility[rid - 1] >= 2) !== !!parents[rid]) rejectMember('CILVM0001', 'nested type visibility');
    let current = rid;
    while (current && colors[current] !== 2) {
      budget.check();
      if (colors[current] === 1) rejectMember('CILVM0001', 'cyclic nested types');
      if (path.length > maxNestingDepth) rejectMember('CILVM0002', 'nested type depth');
      colors[current] = 1;
      path.push(current);
      current = parents[current];
    }
    let depth = current ? depths[current] : -1;
    while (path.length) {
      current = path.pop();
      if (++depth > maxNestingDepth) rejectMember('CILVM0002', 'nested type depth');
      depths[current] = depth;
      colors[current] = 2;
    }
  }
  return parents;
}
