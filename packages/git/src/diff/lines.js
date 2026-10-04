import { GitError, checkCancelled, checkLimit } from '../errors.js';

/** Split text into lines retaining the final newline, so patches can represent missing newlines. */
export function splitLines(text) {
  return String(text).match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}

function spend(budget, count = 1) {
  budget.work += count;
  if (budget.work > budget.maximum) throw new GitError('Limit', 'Line diff exceeded its work budget', { maximum: budget.maximum });
  if ((budget.work & 1023) === 0) checkCancelled(budget.signal);
}

function backtrack(trace, before, after, depth) {
  const result = [];
  let oldPosition = before.length;
  let newPosition = after.length;
  for (let distance = depth; distance >= 0; distance--) {
    const previous = trace[distance];
    const offset = distance + 1;
    const diagonal = oldPosition - newPosition;
    const priorDiagonal = diagonal === -distance || (diagonal !== distance
      && previous[diagonal - 1 + offset] < previous[diagonal + 1 + offset]) ? diagonal + 1 : diagonal - 1;
    const priorOld = previous[priorDiagonal + offset];
    const priorNew = priorOld - priorDiagonal;
    while (oldPosition > priorOld && newPosition > priorNew) {
      result.push({ type: 'equal', line: before[--oldPosition] });
      newPosition--;
    }
    if (!distance) break;
    if (oldPosition === priorOld) result.push({ type: 'insert', line: after[--newPosition] });
    else result.push({ type: 'delete', line: before[--oldPosition] });
  }
  return result.reverse();
}

function myers(before, after, budget) {
  if (!before.length || !after.length) spend(budget, before.length + after.length);
  if (!before.length) return after.map(line => ({ type: 'insert', line }));
  if (!after.length) return before.map(line => ({ type: 'delete', line }));
  const maximum = before.length + after.length;
  const vector = new Int32Array(maximum * 2 + 3);
  const offset = maximum + 1;
  const trace = [];
  for (let distance = 0; distance <= maximum; distance++) {
    spend(budget, distance * 2 + 3);
    trace.push(vector.slice(offset - distance - 1, offset + distance + 2));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const key = offset + diagonal;
      let oldPosition = diagonal === -distance || (diagonal !== distance && vector[key - 1] < vector[key + 1])
        ? vector[key + 1] : vector[key - 1] + 1;
      let newPosition = oldPosition - diagonal;
      while (oldPosition < before.length && newPosition < after.length && before[oldPosition] === after[newPosition]) {
        oldPosition++;
        newPosition++;
        spend(budget);
      }
      vector[key] = oldPosition;
      if (oldPosition >= before.length && newPosition >= after.length) return backtrack(trace, before, after, distance);
    }
  }
  throw new GitError('Corrupt', 'Line diff failed to find a path');
}

function histogramAnchor(before, after, budget) {
  spend(budget, before.length);
  const positions = new Map();
  for (let index = 0; index < before.length; index++) {
    let chain = positions.get(before[index]);
    if (!chain) positions.set(before[index], chain = []);
    chain.push(index);
  }
  let best = null;
  for (let afterIndex = 0; afterIndex < after.length; afterIndex++) {
    const chain = positions.get(after[afterIndex]);
    if (!chain || chain.length > 64) continue;
    let advance = afterIndex + 1;
    for (const beforeIndex of chain) {
      spend(budget);
      let oldStart = beforeIndex;
      let newStart = afterIndex;
      let oldEnd = beforeIndex + 1;
      let newEnd = afterIndex + 1;
      let rarity = chain.length;
      while (oldStart && newStart && before[oldStart - 1] === after[newStart - 1]) {
        oldStart--;
        newStart--;
        rarity = Math.min(rarity, positions.get(before[oldStart]).length);
        spend(budget);
      }
      while (oldEnd < before.length && newEnd < after.length && before[oldEnd] === after[newEnd]) {
        rarity = Math.min(rarity, positions.get(before[oldEnd]).length);
        oldEnd++;
        newEnd++;
        spend(budget);
      }
      const length = oldEnd - oldStart;
      if (!best || length > best.length || rarity < best.rarity) best = { oldStart, newStart, oldEnd, newEnd, rarity, length };
      advance = Math.max(advance, newEnd);
    }
    afterIndex = advance - 1;
  }
  return best;
}

function histogram(before, after, budget) {
  const result = [];
  const pending = [{ before, after, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (current.equal) {
      for (const line of current.equal) result.push({ type: 'equal', line });
      continue;
    }
    checkLimit(current.depth, 256, 'Histogram diff depth');
    const anchor = histogramAnchor(current.before, current.after, budget);
    if (!anchor) {
      for (const operation of myers(current.before, current.after, budget)) result.push(operation);
      continue;
    }
    const { oldStart, newStart, oldEnd, newEnd } = anchor;
    pending.push({ before: current.before.slice(oldEnd), after: current.after.slice(newEnd), depth: current.depth + 1 });
    pending.push({ equal: current.before.slice(oldStart, oldEnd) });
    pending.push({ before: current.before.slice(0, oldStart), after: current.after.slice(0, newStart), depth: current.depth + 1 });
  }
  return result;
}

/** Bounded O((N+M)D) Myers or histogram line diff with explicit cancellation and budget failure. */
export function diffLines(before, after, { algorithm = 'myers', maxWork = 20000000, maxLines = 2000000, signal, workBudget } = {}) {
  checkCancelled(signal);
  const oldLines = Array.isArray(before) ? before : splitLines(before);
  const newLines = Array.isArray(after) ? after : splitLines(after);
  checkLimit(oldLines.length + newLines.length, maxLines, 'Line diff lines');
  if (!['myers', 'minimal', 'histogram'].includes(algorithm)) throw new GitError('Unsupported', 'Unknown diff algorithm', { algorithm });
  const budget = workBudget ?? { work: 0, maximum: maxWork, signal };
  checkLimit(budget.maximum, Number.MAX_SAFE_INTEGER, 'Line diff work budget');
  checkLimit(budget.work, budget.maximum, 'Line diff accumulated work');
  checkCancelled(budget.signal);
  let prefix = 0;
  while (prefix < Math.min(oldLines.length, newLines.length) && oldLines[prefix] === newLines[prefix]) {
    prefix++;
    spend(budget);
  }
  let suffix = 0;
  while (suffix < Math.min(oldLines.length, newLines.length) - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) {
    suffix++;
    spend(budget);
  }
  const compute = algorithm === 'histogram' ? histogram : myers;
  const middle = compute(oldLines.slice(prefix, oldLines.length - suffix), newLines.slice(prefix, newLines.length - suffix), budget);
  const changes = [
    ...oldLines.slice(0, prefix).map(line => ({ type: 'equal', line })),
    ...middle,
    ...oldLines.slice(oldLines.length - suffix).map(line => ({ type: 'equal', line }))
  ];
  let oldLine = 1;
  let newLine = 1;
  for (const change of changes) {
    change.oldLine = oldLine;
    change.newLine = newLine;
    if (change.type !== 'insert') oldLine++;
    if (change.type !== 'delete') newLine++;
  }
  return changes;
}
