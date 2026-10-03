/** Count executed source/target pairs; warm hits allocate no objects or string keys. */
export function countWasmBackedge(state, record, from, to) {
  record.backedges++;
  let targets = record.backedgeSites.get(from);
  let site = targets?.get(to);
  if (!site) {
    if (record.backedgeSiteCount >= state.options.maxBackedgesPerMethod) {
      record.backedgeOverflow++;
      return;
    }
    if (!targets) {
      targets = new Map();
      record.backedgeSites.set(from, targets);
    }
    site = {from, to, count: 0};
    targets.set(to, site);
    record.backedgeSiteCount++;
  }
  site.count++;
  record.hottestBackedge = Math.max(record.hottestBackedge, site.count);
}

/** Detached, immutable diagnostic rows; ordering is by source then target IL offset. */
export function wasmBackedgeStatistics(record) {
  const sites = [];
  for (const targets of record.backedgeSites.values()) {
    for (const site of targets.values()) {
      sites.push(Object.freeze({fromOffset: record.method.instructions[site.from].offset,
        toOffset: record.method.instructions[site.to].offset, count: site.count}));
    }
  }
  sites.sort((left, right) => left.fromOffset - right.fromOffset || left.toOffset - right.toOffset);
  return Object.freeze(sites);
}
