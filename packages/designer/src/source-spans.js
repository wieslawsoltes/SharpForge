/** Indexes source intervals once; each containment query is O(log spans) within its source document. */
export function sourceSpanLookup(spans, defaultUri) {
  const files = new Map();
  for (const span of spans) {
    const uri = span.uri ?? defaultUri;
    if (!files.has(uri)) files.set(uri, []);
    files.get(uri).push(span);
  }
  for (const [uri, input] of files) {
    const merged = [];
    for (const span of input.sort((left, right) => left.start - right.start)) {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
      else merged.push({start: span.start, end: span.end});
    }
    files.set(uri, merged);
  }
  return location => {
    const candidates = files.get(location.uri ?? defaultUri) ?? [];
    let left = 0;
    let right = candidates.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (candidates[middle].start <= location.start) left = middle + 1;
      else right = middle;
    }
    return left > 0 && candidates[left - 1].end >= location.end;
  };
}
