import { GitError, checkCancelled } from './errors.js';
import { diffLines } from './diff/lines.js';

export function spendBlameWork(budget, count = 1) {
  checkCancelled(budget.signal);
  budget.work += count;
  if (!Number.isSafeInteger(budget.work) || budget.work > budget.maximum) {
    throw new GitError('Limit', 'Blame exceeded its work budget', { maximum: budget.maximum });
  }
}

export function normalizeBlameLines(lines, options) {
  return options.ignoreWhitespace ? lines.map(line => line.replace(/[\t\r\v\f ]+/g, '')) : lines;
}

export function blameDiff(before, after, options, budget) {
  return diffLines(before, after, {
    algorithm: options.diffAlgorithm ?? 'myers', maxWork: budget.maximum - budget.work,
    maxLines: options.maxLines * 2, signal: options.signal, workBudget: budget
  });
}

/** Separate exact line transfers from differing ranges, retaining zero-based source coordinates. */
export function mapBlameDiff(edits) {
  const mapping = new Map();
  const hunks = [];
  let hunk;
  for (const edit of edits) {
    if (edit.type === 'equal') {
      mapping.set(edit.newLine - 1, edit.oldLine - 1);
      hunk = undefined;
    } else {
      if (!hunk) {
        hunk = { oldStart: edit.oldLine - 1, oldCount: 0, newStart: edit.newLine - 1, newCount: 0 };
        hunks.push(hunk);
      }
      if (edit.type === 'delete') hunk.oldCount++;
      else hunk.newCount++;
    }
  }
  return { mapping, hunks };
}

export function partitionBlame(positions, mapping, flags = {}) {
  const transferred = [];
  const remaining = [];
  for (const position of positions) {
    const line = mapping.get(position.line);
    if (line === undefined) remaining.push(position);
    else transferred.push({ ...position, ...flags, line });
  }
  return { transferred, remaining };
}

/** Git's move score is one plus the count of ASCII alphanumeric bytes in the final text. */
export function blameScores(lines, budget) {
  const prefix = new Float64Array(lines.length + 1);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    spendBlameWork(budget, line.length);
    let score = prefix[index];
    for (let offset = 0; offset < line.length; offset++) {
      const code = line.charCodeAt(offset);
      if (code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122) score++;
    }
    prefix[index + 1] = score;
  }
  return prefix;
}

function spans(positions) {
  const sorted = [...positions].sort((left, right) => left.line - right.line || left.original - right.original);
  const result = [];
  let span;
  for (const position of sorted) {
    const last = span?.at(-1);
    if (!last || position.line !== last.line + 1 || position.original !== last.original + 1
      || position.ignored !== last.ignored || position.unblamable !== last.unblamable) {
      span = [];
      result.push(span);
    }
    span.push(position);
  }
  return result;
}

function scoreSpan(scores, span, start = 0, count = span.length) {
  const first = span[start].original;
  return 1 + scores[first + count] - scores[first];
}

function bestMatch(source, span, context) {
  const wanted = span.map(position => context.normalized[position.original]);
  const edits = blameDiff(source.normalized, wanted, context.options, context.budget);
  let best;
  let block;
  const consider = () => {
    if (!block) return;
    block.score = scoreSpan(context.scores, span, block.at, block.count);
    if (!best || block.score >= best.score) best = block;
    block = undefined;
  };
  for (const edit of edits) {
    if (edit.type !== 'equal') { consider(); continue; }
    if (!block) {
      block = { source: { oid: source.oid, path: source.path }, at: edit.newLine - 1, line: edit.oldLine - 1, count: 0, score: 0 };
    }
    block.count++;
  }
  consider();
  return best;
}

/** Repeatedly split the strongest surviving block; sources stream to keep copy search memory bounded. */
export async function findBlameCopies(positions, sourceFactory, context) {
  let pending = spans(positions);
  const remaining = [];
  const transfers = [];
  while (pending.length) {
    const eligible = [];
    for (const span of pending) {
      if (scoreSpan(context.scores, span) > context.threshold) eligible.push(span);
      else for (const position of span) remaining.push(position);
    }
    if (!eligible.length) break;
    const best = new Array(eligible.length);
    for await (const source of sourceFactory()) {
      for (let index = 0; index < eligible.length; index++) {
        const match = bestMatch(source, eligible[index], context);
        if (match && (!best[index] || match.score >= best[index].score)) best[index] = match;
      }
    }
    pending = [];
    for (let index = 0; index < eligible.length; index++) {
      const span = eligible[index];
      const match = best[index];
      if (!match || match.score <= context.threshold) {
        for (const position of span) remaining.push(position);
        continue;
      }
      const moved = span.slice(match.at, match.at + match.count).map((position, offset) => ({ ...position, line: match.line + offset }));
      transfers.push({ oid: match.source.oid, path: match.source.path, positions: moved });
      if (match.at) pending.push(span.slice(0, match.at));
      if (match.at + match.count < span.length) pending.push(span.slice(match.at + match.count));
    }
  }
  return { remaining, transfers };
}
