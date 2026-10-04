// Deliberately slow, literal transcription of ECMA-335 I.12.4.2.8.2.8 for differential tests.
// This checks every enclosing source and target region, independently of the product's ancestor summaries.
const inside = (region, offset) => region.start <= offset && offset < region.end;
const encloses = (outer, inner) => outer !== inner && outer.start <= inner.start && inner.end <= outer.end;
const disjoint = (left, right) => left.end <= right.start || right.end <= left.start;
const caught = region => region.kind === 'catch' || region.kind === 'filter-handler';

export function ecmaLeaveAllowed(tree, source, target) {
  const sources = tree.regions.filter(region => inside(region, source));
  const targets = tree.regions.filter(region => inside(region, target));
  const targetTries = targets.filter(region => region.kind === 'try');
  for (const region of sources) {
    if (region.kind === 'filter' || region.kind === 'finally' || region.kind === 'fault') {
      if (!inside(region, target)) return false;
    } else {
      const enclosingTry = tree.regions.some(outer => outer.kind === 'try' && encloses(outer, region) && inside(outer, target));
      const firstDisjointTry = targetTries.some(other => other.start === target && disjoint(region, other));
      const common = inside(region, target) || enclosingTry || firstDisjointTry || targetTries.length === 0;
      if (region.kind === 'try' && !common) return false;
      if (caught(region)) {
        const associated = tree.regions[tree.clauses[region.clauses[0]].tryRegion];
        if (!common && !inside(associated, target)) return false;
      }
    }
  }
  for (const region of targets) {
    if (region.kind !== 'try') {
      if (!inside(region, source)) return false;
    } else if (region.start !== target && !inside(region, source)) {
      const associatedCatch = region.clauses.some(index => {
        const handler = tree.regions[tree.clauses[index].handlerRegion];
        return caught(handler) && inside(handler, source);
      });
      if (!associatedCatch) return false;
    }
  }
  return true;
}
