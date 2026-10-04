import { wordRuns } from './vim-motions.js';

/** Text-object ranges are half-open UTF-16 spans; bracket objects reuse the editor's syntax-aware pair index. */
export function textObject(context, offset, key, around = false, count = 1) {
  const position = context.position(offset);
  const lineStart = context.lineStart(position.line);
  const line = context.line(position.line);
  const column = Math.min(position.character, Math.max(0, line.length - 1));
  if (key === 'w' || key === 'W') {
    const runs = wordRuns(context, position.line, key === 'W');
    let index = runs.findIndex(run => run.start <= column && column < run.end);
    if (index < 0) return { start: lineStart, end: lineStart, linewise: false };
    let start = runs[index].start;
    let end = runs[index].end;
    for (let step = 1; step < count; step++) {
      do { index++; } while (index < runs.length && !runs[index].kind);
      if (index >= runs.length) break;
      end = runs[index].end;
    }
    if (around) {
      const original = end;
      while (end < line.length && /\s/u.test(line[end])) end++;
      if (end === original) while (start > 0 && /\s/u.test(line[start - 1])) start--;
    }
    return { start: lineStart + start, end: lineStart + end, linewise: false };
  }
  if (['"', "'", '`'].includes(key)) {
    const positions = [];
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
      if (line[index] === key && !escaped) positions.push(index);
      escaped = line[index] === '\\' && !escaped;
    }
    for (let index = 0; index + 1 < positions.length; index += 2) {
      if (positions[index + 1] < column) continue;
      return { start: lineStart + positions[index] + (around ? 0 : 1),
        end: lineStart + positions[index + 1] + (around ? 1 : 0), linewise: false };
    }
    return null;
  }
  if (['(', ')', 'b', '[', ']', '{', '}', 'B', '<', '>'].includes(key)) {
    const open = { ')': '(', b: '(', ']': '[', '}': '{', B: '{', '>': '<' }[key] ?? key;
    const candidates = [];
    for (const [start, end] of context.editor.pairs ?? []) {
      if (start <= offset && end >= offset && start < end && context.slice(start, start + 1) === open) candidates.push({ start, end });
    }
    candidates.sort((left, right) => right.start - left.start);
    const pair = candidates[Math.min(count - 1, candidates.length - 1)];
    return pair ? { start: pair.start + (around ? 0 : 1), end: pair.end + (around ? 1 : 0), linewise: false } : null;
  }
  if (key === 'p') {
    let first = position.line;
    let last = first;
    while (first > 0 && context.line(first - 1).trim()) first--;
    for (let step = 0; step < count; step++) {
      while (last + 1 < context.lineCount && context.line(last + 1).trim()) last++;
      if (step + 1 < count || around) while (last + 1 < context.lineCount && !context.line(last + 1).trim()) last++;
      if (step + 1 < count && last + 1 < context.lineCount) last++;
    }
    return { start: context.lineStart(first), end: context.lineEnd(last, true), linewise: true };
  }
  if (key === 's') {
    let start = column;
    let end = column;
    while (start > 0 && !/[.!?]/.test(line[start - 1])) start--;
    while (end < line.length && !/[.!?]/.test(line[end])) end++;
    if (end < line.length) end++;
    if (around) while (end < line.length && /\s/u.test(line[end])) end++;
    else while (start < end && /\s/u.test(line[start])) start++;
    return { start: lineStart + start, end: lineStart + end, linewise: false };
  }
  return null;
}
