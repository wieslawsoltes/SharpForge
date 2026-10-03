const maximumSites = 100_000;

function normalizeSite(site) {
  if (!site || typeof site !== 'object') throw new TypeError('An allocation site must be an object');
  const point = site.sequencePoint ?? site;
  const methodToken = site.methodToken ?? null;
  const ilOffset = site.ilOffset ?? null;
  if (methodToken !== null && (!Number.isSafeInteger(methodToken) || methodToken < 0)) {
    throw new RangeError('Allocation method token must be a non-negative safe integer');
  }
  if (ilOffset !== null && (!Number.isSafeInteger(ilOffset) || ilOffset < 0)) {
    throw new RangeError('Allocation IL offset must be a non-negative safe integer');
  }
  const line = point.line ?? null;
  const column = point.column ?? null;
  for (const value of [line, column]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError('Allocation source coordinates must be non-negative safe integers');
    }
  }
  const uri = point.uri ?? point.document ?? null;
  const methodName = site.methodName ?? null;
  if (uri !== null && typeof uri !== 'string' || methodName !== null && typeof methodName !== 'string') {
    throw new TypeError('Allocation source and method names must be strings');
  }
  if ((uri?.length ?? 0) > 8192 || (methodName?.length ?? 0) > 1024) throw new RangeError('Allocation site text is too long');
  return Object.freeze({methodToken, ilOffset, uri, line, column, methodName});
}

/** Deterministic allocation sampling. A disabled heap never calls capture(). */
export class AllocationSites {
  constructor(options = {}) {
    const config = options.allocationSites ?? options;
    this.enabled = config.enabled ?? options.allocationSampling ?? false;
    this.sampleInterval = config.sampleInterval ?? 1;
    this.maxSites = config.maxSites ?? maximumSites;
    if (typeof this.enabled !== 'boolean') throw new TypeError('Allocation sampling enabled must be boolean');
    if (!Number.isSafeInteger(this.sampleInterval) || this.sampleInterval < 1) throw new RangeError('Invalid sampling interval');
    if (!Number.isSafeInteger(this.maxSites) || this.maxSites < 1 || this.maxSites > maximumSites) {
      throw new RangeError('Invalid allocation site limit');
    }
    this.provider = null;
    this.current = null;
    this.sequence = 0;
    this.sampled = 0;
    this.dropped = 0;
    this.sites = new Map();
  }

  /** Set the current execution position; null removes attribution. */
  setCurrent(site) {
    this.current = site === null ? null : normalizeSite(site);
  }

  /** Restore a previous attribution on dispose, including exceptional exits. */
  enter(site) {
    const previous = this.current;
    this.setCurrent(site);
    let disposed = false;
    return Object.freeze({dispose: () => {
      if (disposed) return;
      disposed = true;
      this.current = previous;
    }});
  }

  capture(record) {
    if (!this.enabled) return null;
    const sequence = this.sequence++;
    if (sequence % this.sampleInterval !== 0) return null;
    const supplied = this.provider ? this.provider() : this.current;
    if (supplied === null || supplied === undefined) return null;
    const site = normalizeSite(supplied);
    const key = JSON.stringify([site.methodToken, site.ilOffset, site.uri, site.line, site.column, site.methodName]);
    if (!this.sites.has(key)) {
      if (this.sites.size === this.maxSites) {
        this.dropped++;
        return null;
      }
      this.sites.set(key, site);
    }
    record.allocationSite = key;
    this.sampled++;
    return key;
  }

  describe(key) {
    return this.sites.get(key) ?? null;
  }

  snapshot() {
    return {version: 1, enabled: this.enabled, sampleInterval: this.sampleInterval, maxSites: this.maxSites,
      current: this.current, sequence: this.sequence, sampled: this.sampled, dropped: this.dropped, sites: [...this.sites]};
  }

  validateSnapshot(state) {
    if (state?.version !== 1 || !Array.isArray(state.sites) || state.sites.length > maximumSites) {
      throw new TypeError('Invalid allocation site snapshot');
    }
    for (const [key, site] of state.sites) {
      if (typeof key !== 'string') throw new TypeError('Invalid allocation site key');
      normalizeSite(site);
    }
    for (const name of ['sequence', 'sampled', 'dropped']) {
      if (!Number.isSafeInteger(state[name]) || state[name] < 0) throw new TypeError('Invalid sampling counter');
    }
    new AllocationSites({enabled: state.enabled, sampleInterval: state.sampleInterval, maxSites: state.maxSites});
  }

  restore(state) {
    this.validateSnapshot(state);
    this.enabled = state.enabled;
    this.sampleInterval = state.sampleInterval;
    this.maxSites = state.maxSites;
    this.current = state.current;
    this.sequence = state.sequence;
    this.sampled = state.sampled;
    this.dropped = state.dropped;
    this.sites = new Map(state.sites);
  }
}

/** Live histograms are exact for sampled records; unsampled objects remain explicit. */
export function allocationSiteHistogram(heap) {
  const grouped = new Map();
  for (const record of heap.records) {
    if (!record) continue;
    const key = record.allocationSite ?? null;
    let item = grouped.get(key);
    if (!item) {
      item = {site: key, location: heap.allocationSites?.describe(key) ?? null, objects: 0, bytes: 0};
      grouped.set(key, item);
    }
    item.objects++;
    item.bytes += record.size;
  }
  return [...grouped.values()].sort((left, right) => right.bytes - left.bytes || String(left.site).localeCompare(String(right.site)));
}
