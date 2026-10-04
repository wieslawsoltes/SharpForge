import {lowerBound} from './text-items.js';

/** Group HarfBuzz output clusters without inventing glyph or cluster identifiers. */
export function shapedClusters(item) {
  if (item.tab) return [{start: item.start, end: item.end, glyphs: [], advanceStart: 0,
    width: item.width, style: item.style, font: item.font, rtl: item.rtl}];
  const groups = [];
  for (const glyph of item.glyphs) {
    let group = groups.at(-1);
    if (!group || group.start !== glyph.cluster) {
      const source = item.clusters[lowerBound(item.clusters, glyph.cluster)];
      group = {start: glyph.cluster, end: item.end, glyphs: [], advanceStart: glyph.advanceStart,
        width: 0, style: source?.style ?? item.style, font: item.font, rtl: item.rtl};
      groups.push(group);
    }
    group.glyphs.push(glyph);
  }
  const logical = groups.slice().sort((a, b) => a.start - b.start);
  for (let index = 0; index < logical.length; index++) logical[index].end = logical[index + 1]?.start ?? item.end;
  for (let index = 0; index < groups.length; index++) {
    groups[index].width = Math.max(0, (groups[index + 1]?.advanceStart ?? item.width) - groups[index].advanceStart);
  }
  return groups;
}

/** Prefix widths choose candidate breaks only; every resulting line is shaped again and fitted against actual width. */
export function estimateClusterWidths(clusters, shaped) {
  const widths = new Float64Array(clusters.length);
  for (const item of shaped.items) for (const group of shapedClusters(item)) {
    const first = lowerBound(clusters, group.start);
    const last = lowerBound(clusters, group.end - 1);
    const count = last - first + 1;
    for (let index = first; index <= last && index < clusters.length; index++) widths[index] += group.width / count;
  }
  const prefix = new Float64Array(widths.length + 1);
  widths.forEach((width, index) => { prefix[index + 1] = prefix[index] + width; });
  return prefix;
}
