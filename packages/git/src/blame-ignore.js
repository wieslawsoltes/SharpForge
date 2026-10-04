import { spendBlameWork } from './blame-match.js';

function fingerprints(lines, budget) {
  const encoder = new TextEncoder();
  return lines.map(line => {
    const bytes = encoder.encode(line);
    spendBlameWork(budget, bytes.length + 1);
    const pairs = new Map();
    let previous = 0;
    for (let index = 0; index <= bytes.length; index++) {
      let byte = bytes[index] ?? 0;
      if (byte === 32 || byte >= 9 && byte <= 13) byte = 0;
      else if (byte >= 65 && byte <= 90) byte += 32;
      const pair = previous | byte << 8;
      if (pair) pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
      previous = byte;
    }
    return pairs;
  });
}

function similarity(left, right, budget) {
  spendBlameWork(budget, left.size);
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
  return shared;
}

function subtractFingerprint(parent, target) {
  for (const [pair, count] of target) {
    const remaining = (parent.get(pair) ?? 0) - count;
    if (remaining > 0) parent.set(pair, remaining);
    else parent.delete(pair);
  }
}

function bestLocalMatch(targetLine, range, hunk, context) {
  const center = hunk.oldStart + Math.floor((2 * (targetLine - hunk.newStart) + 1) * hunk.oldCount / (2 * hunk.newCount));
  const first = Math.max(range.oldStart, center - 10);
  const end = Math.min(range.oldEnd, center + 11);
  let best = 0;
  let second = 0;
  let sourceLine = -1;
  for (let line = first; line < end; line++) {
    const score = similarity(context.target[targetLine], context.parent[line], context.budget) * (1000 - Math.abs(line - center));
    if (score > best) { second = best; best = score; sourceLine = line; }
    else if (score > second) second = score;
  }
  return sourceLine < 0 ? undefined : { targetLine, sourceLine, certainty: best * 2 - second };
}

function matchChangedRange(hunk, context) {
  const mapping = new Map();
  if (!hunk.oldCount || !hunk.newCount) return mapping;
  const pending = [{
    oldStart: hunk.oldStart, oldEnd: hunk.oldStart + hunk.oldCount,
    newStart: hunk.newStart, newEnd: hunk.newStart + hunk.newCount
  }];
  while (pending.length) {
    const range = pending.pop();
    let strongest;
    for (let line = range.newStart; line < range.newEnd; line++) {
      const candidate = bestLocalMatch(line, range, hunk, context);
      if (candidate && (!strongest || candidate.certainty > strongest.certainty)) strongest = candidate;
    }
    if (!strongest) continue;
    const { sourceLine, targetLine } = strongest;
    mapping.set(targetLine, sourceLine);
    subtractFingerprint(context.parent[sourceLine], context.target[targetLine]);
    if (targetLine + 1 < range.newEnd) {
      pending.push({ ...range, oldStart: sourceLine, newStart: targetLine + 1 });
    }
    if (targetLine > range.newStart) {
      pending.push({ ...range, oldEnd: sourceLine + 1, newEnd: targetLine });
    }
  }
  return mapping;
}

function indexFingerprints(parent, budget) {
  const index = new Map();
  for (let line = 0; line < parent.length; line++) {
    spendBlameWork(budget, parent[line].size);
    for (const pair of parent[line].keys()) {
      let positions = index.get(pair);
      if (!positions) index.set(pair, positions = []);
      positions.push(line);
    }
  }
  return index;
}

function matchWholeFile(targetLine, context) {
  context.index ??= indexFingerprints(context.parent, context.budget);
  const scores = new Map();
  for (const [pair, count] of context.target[targetLine]) {
    for (const line of context.index.get(pair) ?? []) {
      spendBlameWork(context.budget);
      const amount = Math.min(count, context.parent[line].get(pair) ?? 0);
      if (amount) scores.set(line, (scores.get(line) ?? 0) + amount);
    }
  }
  let bestScore = 10;
  let bestLine = -1;
  for (const [line, score] of scores) {
    const distance = Math.abs(line - targetLine);
    const bestDistance = Math.abs(bestLine - targetLine);
    if (score < bestScore || score === bestScore && bestLine >= 0 && (distance > bestDistance
      || distance === bestDistance && line < bestLine)) continue;
    bestScore = score;
    bestLine = line;
  }
  return bestLine;
}

/** Attribute ignored changes by ordered byte-pair similarity, then indexed whole-file similarity. */
export function mapIgnoredBlame(parentLines, targetLines, hunks, budget) {
  const context = { parent: fingerprints(parentLines, budget), target: fingerprints(targetLines, budget), budget, index: undefined };
  const mapping = new Map();
  for (const hunk of hunks) {
    const local = matchChangedRange(hunk, context);
    for (let line = hunk.newStart; line < hunk.newStart + hunk.newCount; line++) {
      const parent = local.get(line) ?? matchWholeFile(line, context);
      if (parent >= 0) mapping.set(line, parent);
    }
  }
  return mapping;
}
