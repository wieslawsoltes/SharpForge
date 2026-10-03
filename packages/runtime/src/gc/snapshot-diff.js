import {validateHeapDump} from './heap-dump.js';

function aggregate(dump, mode) {
  const types = new Map(dump.types.map(type => [type.id, type]));
  const sites = new Map(dump.sites.map(site => [site.id, site.location]));
  const groups = new Map();
  for (const node of dump.nodes) {
    const type = types.get(node.typeId);
    const key = mode === 'site' ? node.allocationSite : JSON.stringify([type.kind, type.name]);
    let item = groups.get(key);
    if (!item) {
      item = mode === 'site' ? {site: key, location: sites.get(key) ?? null, objects: 0, bytes: 0}
        : {kind: type.kind, type: type.name, objects: 0, bytes: 0};
      groups.set(key, item);
    }
    item.objects++;
    item.bytes += node.size;
  }
  return groups;
}

function differences(before, after, mode) {
  const old = aggregate(before, mode);
  const next = aggregate(after, mode);
  const groups = [];
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const previous = old.get(key);
    const current = next.get(key);
    const {objects, bytes, ...identity} = current ?? previous;
    const countDelta = (current?.objects ?? 0) - (previous?.objects ?? 0);
    const byteDelta = (current?.bytes ?? 0) - (previous?.bytes ?? 0);
    if (countDelta || byteDelta) {
      groups.push({...identity, beforeObjects: previous?.objects ?? 0, afterObjects: current?.objects ?? 0,
        beforeBytes: previous?.bytes ?? 0, afterBytes: current?.bytes ?? 0, countDelta, byteDelta});
    }
  }
  return groups.sort((left, right) => right.byteDelta - left.byteDelta || right.countDelta - left.countDelta);
}

/** Compare logical identities, types and sampled sites. Slot reuse counts as remove plus add. */
export function diffHeapDumps(before, after) {
  validateHeapDump(before);
  validateHeapDump(after);
  const old = new Set(before.nodes.map(node => node.id));
  const next = new Set(after.nodes.map(node => node.id));
  const added = after.nodes.filter(node => !old.has(node.id)).map(node => node.id);
  const removed = before.nodes.filter(node => !next.has(node.id)).map(node => node.id);
  return {schemaVersion: 1, beforeStamp: before.stamp, afterStamp: after.stamp,
    complete: !before.truncated && !after.truncated, added, removed,
    countDelta: after.nodes.length - before.nodes.length,
    byteDelta: after.nodes.reduce((bytes, node) => bytes + node.size, 0) - before.nodes.reduce((bytes, node) => bytes + node.size, 0),
    byType: differences(before, after, 'type'), bySite: differences(before, after, 'site')};
}
