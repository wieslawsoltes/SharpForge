import { checkRegionCancellation, regionFailure } from './contracts.js';

/** Sort once, then visit each interval once; shared tries have already been coalesced. */
export function nestRegions(regions, options) {
  const sorted = [...regions].sort((left, right) => left.start - right.start || right.end - left.end || left.id - right.id);
  const stack = [];
  const roots = [];
  for (const region of sorted) {
    checkRegionCancellation(options.signal);
    while (stack.length && region.start >= stack.at(-1).end) stack.pop();
    const parent = stack.at(-1);
    if (parent) {
      if (region.end > parent.end) regionFailure('CILR0022');
      if (region.start === parent.start && region.end === parent.end) regionFailure('CILR0023');
      if (parent.kind === 'filter') regionFailure('CILR0025');
      region.parent = parent.id;
      parent.children.push(region.id);
    } else roots.push(region.id);
    if (stack.length >= options.maxDepth) regionFailure('CILR0028');
    stack.push(region);
  }
  return roots;
}

/** Equal immediate parents enforce ECMA's whole-entry nesting rule without pairwise comparisons. */
export function validateFamilies(clauses, regions, signal) {
  for (const clause of clauses) {
    checkRegionCancellation(signal);
    const parent = regions[clause.tryRegion].parent;
    if (parent !== regions[clause.handlerRegion].parent ||
        (clause.filterRegion !== null && parent !== regions[clause.filterRegion].parent)) regionFailure('CILR0026');
    if (parent !== null && clause.index >= regions[parent].clauses[0]) regionFailure('CILR0027');
  }
}
