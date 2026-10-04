// Lexical ownership is independent of inheritance and shares one bounded validator.
export const maxNestingDepth = 64;

/** Copy a validated NestedClass forest. Zero means top-level; values are raw TypeDef RIDs. */
export function snapshotMetadataNesting(rows, visibility, context) {
  if (rows.length > visibility.length) context.limit('nested type rows');
  if (!rows.length) {
    if (visibility.some(value => value >= 2)) context.invalid('missing nested type owner');
    return null;
  }
  const parents = new Uint32Array(visibility.length + 1);
  const colors = new Uint8Array(parents.length);
  const depths = new Uint8Array(parents.length);
  for (const row of rows) {
    context.check();
    if (!Array.isArray(row) || row.length !== 2) context.invalid('nested type row shape');
    for (const rid of row) {
      if (!Number.isInteger(rid) || rid < 1 || rid > visibility.length || rid > 0xffffff)
        context.invalid('nested type RID');
    }
    if (parents[row[0]]) context.invalid('duplicate nested type owner');
    parents[row[0]] = row[1];
  }
  const path = [];
  for (let rid = 1; rid < parents.length; rid++) {
    context.check();
    if ((visibility[rid - 1] >= 2) !== !!parents[rid]) context.invalid('nested type visibility');
    let current = rid;
    while (current && colors[current] !== 2) {
      context.check();
      if (colors[current] === 1) context.invalid('cyclic nested types');
      if (path.length > maxNestingDepth) context.limit('nested type depth');
      colors[current] = 1;
      path.push(current);
      current = parents[current];
    }
    let depth = current ? depths[current] : -1;
    while (path.length) {
      current = path.pop();
      if (++depth > maxNestingDepth) context.limit('nested type depth');
      depths[current] = depth;
      colors[current] = 2;
    }
  }
  return parents;
}
