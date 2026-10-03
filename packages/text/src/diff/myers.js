import { DiffLimit } from './budget.js';

function backtrack(trace, distance, oldLength, newLength, prefix, budget) {
  let oldIndex = oldLength;
  let newIndex = newLength;
  const reversed = [];
  for (let depth = distance; depth > 0; depth--) {
    budget.tick();
    const previous = trace[depth - 1];
    const diagonal = oldIndex - newIndex;
    const get = key => previous[key + depth];
    const previousDiagonal = diagonal === -depth || diagonal !== depth && get(diagonal - 1) < get(diagonal + 1)
      ? diagonal + 1 : diagonal - 1;
    const previousOld = get(previousDiagonal);
    const previousNew = previousOld - previousDiagonal;
    const equal = Math.min(oldIndex - previousOld, newIndex - previousNew);
    if (equal > 0) {
      reversed.push({ type: 'equal', oldStart: oldIndex - equal, oldEnd: oldIndex, newStart: newIndex - equal, newEnd: newIndex });
      oldIndex -= equal;
      newIndex -= equal;
    }
    if (oldIndex === previousOld) {
      reversed.push({ type: 'insert', oldStart: oldIndex, oldEnd: oldIndex, newStart: newIndex - 1, newEnd: newIndex });
      newIndex--;
    } else {
      reversed.push({ type: 'delete', oldStart: oldIndex - 1, oldEnd: oldIndex, newStart: newIndex, newEnd: newIndex });
      oldIndex--;
    }
  }
  reversed.reverse();
  const changes = [];
  let active = null;
  for (const run of reversed) {
    if (run.type === 'equal') { active = null; continue; }
    if (active) { active.oldEnd = run.oldEnd + prefix; active.newEnd = run.newEnd + prefix; }
    else {
      active = { oldStart: run.oldStart + prefix, oldEnd: run.oldEnd + prefix, newStart: run.newStart + prefix, newEnd: run.newEnd + prefix };
      changes.push(active);
    }
  }
  return changes;
}

/** Myers shortest edit script with bounded trace storage and explicit cancellation at every diagonal/snake. */
export function myers(first, second, options, budget) {
  let prefix = 0;
  while (prefix < first.length && prefix < second.length && first[prefix] === second[prefix]) { budget.tick(); prefix++; }
  let oldLength = first.length - prefix;
  let newLength = second.length - prefix;
  while (oldLength > 0 && newLength > 0 && first[prefix + oldLength - 1] === second[prefix + newLength - 1]) {
    budget.tick(); oldLength--; newLength--;
  }
  if (oldLength === 0 && newLength === 0) return [];
  if (oldLength === 0 || newLength === 0) {
    return [{ oldStart: prefix, oldEnd: prefix + oldLength, newStart: prefix, newEnd: prefix + newLength }];
  }
  const maximum = Math.min(oldLength + newLength, options.maxEditDistance ?? 2048);
  const origin = maximum + 1;
  const frontier = new Int32Array(maximum * 2 + 3).fill(-1);
  frontier[origin + 1] = 0;
  const trace = [];
  let traceCells = 0;
  for (let depth = 0; depth <= maximum; depth++) {
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      budget.tick();
      const slot = origin + diagonal;
      let oldIndex = diagonal === -depth || diagonal !== depth && frontier[slot - 1] < frontier[slot + 1]
        ? frontier[slot + 1] : frontier[slot - 1] + 1;
      let newIndex = oldIndex - diagonal;
      while (oldIndex < oldLength && newIndex < newLength && first[prefix + oldIndex] === second[prefix + newIndex]) {
        budget.tick(); oldIndex++; newIndex++;
      }
      frontier[slot] = oldIndex;
      if (oldIndex >= oldLength && newIndex >= newLength) return backtrack(trace, depth, oldLength, newLength, prefix, budget);
    }
    traceCells += depth * 2 + 3;
    if (traceCells > budget.traceMaximum) throw new DiffLimit('trace memory');
    trace.push(frontier.slice(origin - depth - 1, origin + depth + 2));
  }
  throw new DiffLimit('edit distance');
}
