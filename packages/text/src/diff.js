import { DiffBudget, DiffLimit } from './diff/budget.js';
import { tokenize } from './diff/tokenize.js';
import { myers } from './diff/myers.js';

function execute(first, second, kind, options, budget) {
  const before = tokenize(first, kind, options, budget);
  const after = tokenize(second, kind, options, budget);
  const tokenChanges = myers(before.values, after.values, options, budget);
  return {
    changes: tokenChanges.map(change => ({
      oldStart: before.offsets[change.oldStart], oldEnd: before.offsets[change.oldEnd],
      newStart: after.offsets[change.newStart], newEnd: after.offsets[change.newEnd]
    })), tokenChanges
  };
}

function diff(first, second, kind, options) {
  if (typeof first !== 'string' || typeof second !== 'string') throw new TypeError('Diff inputs must be strings');
  const fallback = reason => ({
    changes: first === second ? [] : [{ oldStart: 0, oldEnd: first.length, newStart: 0, newEnd: second.length }],
    hunks: [], minimal: false, timedOut: reason === 'time', truncated: true, reason
  });
  try {
    const budget = options.budget ?? new DiffBudget(options);
    if (first.length + second.length > (options.maxInputCharacters ?? 32000000)) return fallback('input size');
    if (first === second) return { changes: [], hunks: [], minimal: true, timedOut: false, truncated: false };
    const result = execute(first, second, kind, options, budget);
    const hunks = kind === 'line' ? result.changes.map((change, index) => {
      const tokens = result.tokenChanges[index];
      const hunk = {
        ...change, oldStartLine: tokens.oldStart, oldEndLine: tokens.oldEnd,
        newStartLine: tokens.newStart, newEndLine: tokens.newEnd, innerChanges: []
      };
      if (options.refine !== false && change.oldEnd - change.oldStart + change.newEnd - change.newStart <= (options.maxRefinementCharacters ?? 16000)) {
        const refined = execute(first.slice(change.oldStart, change.oldEnd), second.slice(change.newStart, change.newEnd),
          options.refine === 'word' ? 'word' : 'character', options, budget);
        hunk.innerChanges = refined.changes.map(inner => ({
          oldStart: inner.oldStart + change.oldStart, oldEnd: inner.oldEnd + change.oldStart,
          newStart: inner.newStart + change.newStart, newEnd: inner.newEnd + change.newStart
        }));
      }
      return hunk;
    }) : [];
    return { changes: result.changes, hunks, minimal: true, timedOut: false, truncated: false };
  } catch (error) {
    if (error instanceof DiffLimit) return fallback(error.reason);
    throw error;
  }
}

/** Bounded shortest line edit script with optional word/character refinement. Changes use UTF-16 offsets. */
export function diffLines(first, second, options = {}) { return diff(first, second, 'line', options); }
export function diffWords(first, second, options = {}) { return diff(first, second, 'word', options); }
export function diffCharacters(first, second, options = {}) { return diff(first, second, 'character', options); }
