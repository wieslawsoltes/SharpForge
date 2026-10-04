import { ExceptionTransferIndex, containsExceptionRegion as contains } from './transfer-index.js';
import { checkRegionCancellation } from './contracts.js';

/** Cache nearest relevant ancestors once; every leave requires two binary point lookups and constant-time checks. */
export class ExceptionLeaveIndex extends ExceptionTransferIndex {
  #tree;
  #tries;
  #outerTries;
  #catches;
  #barriers;
  #handlers;
  #nonFirstTry;
  #catchRegions;
  #catchStarts;
  #catchCounts;

  constructor(tree, signal) {
    super(tree, signal);
    this.#tree = tree;
    this.#tries = new Int32Array(tree.regions.length);
    this.#outerTries = new Int32Array(tree.regions.length);
    this.#catches = new Int32Array(tree.regions.length);
    this.#barriers = new Int32Array(tree.regions.length);
    this.#handlers = new Int32Array(tree.regions.length);
    this.#nonFirstTry = new Int32Array(tree.regions.length);
    const pending = [...tree.roots].reverse();
    while (pending.length) {
      checkRegionCancellation(signal);
      const region = tree.regions[pending.pop()];
      const parent = region.parent === null ? null : tree.regions[region.parent];
      const { id, kind } = region;
      this.#tries[id] = kind === 'try' ? id : parent ? this.#tries[parent.id] : -1;
      const outerTry = parent ? this.#outerTries[parent.id] : -1;
      this.#outerTries[id] = outerTry >= 0 ? outerTry : kind === 'try' ? id : -1;
      this.#catches[id] = kind === 'catch' || kind === 'filter-handler' ? id : parent ? this.#catches[parent.id] : -1;
      this.#barriers[id] = kind === 'filter' || kind === 'finally' || kind === 'fault' ? id : parent ? this.#barriers[parent.id] : -1;
      this.#handlers[id] = kind !== 'try' ? id : parent ? this.#handlers[parent.id] : -1;
      // The region itself begins here. Exclude every enclosing try with the same start, not just this region.
      this.#nonFirstTry[id] = !parent ? -1 : parent.start === region.start
        ? this.#nonFirstTry[parent.id] : this.#tries[parent.id];
      for (let index = region.children.length - 1; index >= 0; index--) pending.push(region.children[index]);
    }
    this.#indexCatchFamilies(signal);
  }

  #indexCatchFamilies(signal) {
    const regions = this.#tree.regions.filter(region => region.kind === 'catch' || region.kind === 'filter-handler');
    regions.sort((left, right) => this.#associatedTry(left).id - this.#associatedTry(right).id || left.start - right.start);
    this.#catchRegions = new Int32Array(regions.length);
    this.#catchStarts = new Int32Array(this.#tree.regions.length).fill(-1);
    this.#catchCounts = new Uint32Array(this.#tree.regions.length);
    for (let index = 0; index < regions.length; index++) {
      checkRegionCancellation(signal);
      const region = regions[index];
      const owner = this.#associatedTry(region).id;
      this.#catchRegions[index] = region.id;
      if (this.#catchStarts[owner] < 0) this.#catchStarts[owner] = index;
      this.#catchCounts[owner]++;
    }
  }

  #region(ids, region) {
    return region ? this.#tree.regions[ids[region.id]] ?? null : null;
  }

  #associatedTry(region) {
    return region ? this.#tree.regions[this.#tree.clauses[region.clauses[0]].tryRegion] : null;
  }

  #inAssociatedCatch(region, offset) {
    const start = this.#catchStarts[region.id];
    if (start < 0) return false;
    let low = start;
    let high = start + this.#catchCounts[region.id];
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.#tree.regions[this.#catchRegions[middle]].start <= offset) low = middle + 1;
      else high = middle;
    }
    return low > start && contains(this.#tree.regions[this.#catchRegions[low - 1]], offset);
  }

  /** Return a stable diagnostic code or null. Inputs are already checked instruction-group boundaries. */
  failure(source, target) {
    const sourceRegion = this.regionAt(source);
    const targetRegion = this.regionAt(target);
    const barrier = this.#region(this.#barriers, sourceRegion);
    if (!contains(barrier, target)) return 'CILCF0015';
    const targetTry = this.#region(this.#tries, targetRegion);
    const requiredTry = this.#region(target === targetRegion?.start ? this.#nonFirstTry : this.#tries, targetRegion);
    const outerTry = this.#region(this.#outerTries, sourceRegion);
    const sourceCatch = this.#region(this.#catches, sourceRegion);
    const associated = this.#associatedTry(sourceCatch);
    // Every source region permits a first-try target: nesting makes it same/enclosing or disjoint.
    const interiorTryTarget = targetTry && targetTry.start !== target;
    if (interiorTryTarget && outerTry && !contains(outerTry, target)) {
      return 'CILCF0016';
    }
    if (interiorTryTarget && sourceCatch && !contains(sourceCatch, target) && !contains(associated, target) &&
        !(outerTry && contains(outerTry, target))) return 'CILCF0017';
    if (!contains(this.#region(this.#handlers, targetRegion), source)) return 'CILCF0018';
    if (requiredTry && !contains(requiredTry, source) && !this.#inAssociatedCatch(requiredTry, source)) return 'CILCF0019';
    return null;
  }
}
