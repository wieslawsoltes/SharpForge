function lineStarts(text) {
  const result = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') result.push(index + 1);
  return result;
}

function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
}

/** Preserve source breakpoint anchors through one UTF-16 buffer revision. Empty requests do not inspect source contents. */
export function remapSourceBreakpoints(before, after, breakpoints) {
  if (typeof before !== 'string' || typeof after !== 'string' || !Array.isArray(breakpoints)) {
    throw new TypeError('Expected source text and breakpoint array');
  }
  if (!breakpoints.length) return [];
  if (before === after) return breakpoints.map(breakpoint => ({...breakpoint}));
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const oldLines = lineStarts(before);
  const newLines = lineStarts(after);
  const used = new Set();
  return breakpoints.map(breakpoint => {
    const oldOffset = oldLines[Math.min(oldLines.length - 1, Math.max(0, (breakpoint.line ?? 1) - 1))];
    const end = oldLines[breakpoint.line] ?? before.length;
    let next = oldOffset < prefix ? oldOffset : oldOffset >= oldEnd ? oldOffset + newEnd - oldEnd : prefix;
    if (oldOffset < oldEnd && end > prefix) {
      const anchor = before.slice(oldOffset, end).trim();
      if (anchor) {
        const candidates = [];
        for (let index = Math.max(0, lineAt(newLines, prefix) - 2); index < newLines.length && newLines[index] <= newEnd; index++) {
          if (after.slice(newLines[index], newLines[index + 1] ?? after.length).trim() === anchor) candidates.push(index);
        }
        if (candidates.length === 1) next = newLines[candidates[0]];
      }
    }
    const line = lineAt(newLines, Math.max(0, Math.min(after.length, next)));
    return {...breakpoint, line, column: breakpoint.column, verified: undefined, requestedLine: undefined};
  }).filter(breakpoint => {
    const key = [breakpoint.line, breakpoint.column ?? '', breakpoint.condition ?? '',
      breakpoint.hitCondition ?? '', breakpoint.logMessage ?? ''].join(':');
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
}
