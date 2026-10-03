import { offsetAtVisualColumn, visualColumnAt } from '@sharpforge/text';
import { adjacentCharacter } from '../commands/movement.js';

const word = /[\p{L}\p{N}\p{M}_]/u;
const category = (character, big) => /\s/u.test(character) ? 0 : big || word.test(character) ? 1 : 2;

export function visualPointColumn(context, offset) {
  const position = context.position(offset);
  return visualColumnAt(context.line(position.line), position.character, {
    tabSize: context.editor.options?.tabSize ?? 4, segmenter: context.graphemes
  });
}

export function wordRuns(context, line, big) {
  const runs = [];
  for (const cluster of context.graphemes.segments(context.line(line))) {
    const kind = category(cluster.segment, big);
    const previous = runs.at(-1);
    if (previous?.kind === kind) { previous.end = cluster.end; previous.last = cluster.index; }
    else runs.push({ start: cluster.index, end: cluster.end, last: cluster.index, kind });
  }
  return runs;
}

/** Vim word classes retain punctuation runs, while every boundary is a complete grapheme. */
export function vimWord(context, offset, { direction = 1, end = false, big = false } = {}) {
  const position = context.position(offset);
  let line = position.line;
  let column = position.character;
  for (;;) {
    const runs = wordRuns(context, line, big);
    let run;
    if (direction < 0) {
      run = runs.findLast(value => value.kind && (end ? value.last < column : value.start < column));
    } else if (end) {
      run = runs.find(value => value.kind && value.last > column);
    } else {
      const current = runs.find(value => value.start <= column && value.end > column);
      run = runs.find(value => value.kind && value.start >= (current?.end ?? column));
    }
    if (run) return context.lineStart(line) + (end ? run.last : run.start);
    if (line + direction < 0) return 0;
    if (line + direction >= context.lineCount) return context.length;
    line += direction;
    column = direction < 0 ? Infinity : -1;
  }
}

/** Normal-mode carets occupy a grapheme, including the final emoji on a line, never a surrogate half or an EOL. */
export function normalPoint(context, offset, line = context.position(offset).line) {
  const start = context.lineStart(line);
  const text = context.line(line);
  if (!text.length) return start;
  const local = Math.max(0, Math.min(text.length - 1, offset - start));
  return start + context.graphemes.previous(text, local + 1);
}

export function vimMotion(context, key, offset, { count = 1, explicitCount = false, goalColumn, lastFind } = {}) {
  const position = context.position(offset);
  let target = offset;
  let inclusive = false;
  let linewise = false;
  let visualColumn;
  if (['w', 'W', 'b', 'B', 'e', 'E'].includes(key)) {
    for (let step = 0; step < count; step++) target = vimWord(context, target, {
      direction: ['b', 'B'].includes(key) ? -1 : 1, end: ['e', 'E'].includes(key), big: key === key.toUpperCase()
    });
    inclusive = ['e', 'E'].includes(key);
  } else if (['h', 'l', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Space'].includes(key)) {
    const direction = ['h', 'ArrowLeft', 'Backspace'].includes(key) ? -1 : 1;
    for (let step = 0; step < count; step++) target = adjacentCharacter(context, target, direction);
    target = normalPoint(context, target, position.line);
  } else if (['j', 'k', 'ArrowDown', 'ArrowUp', '+', '-', 'Enter'].includes(key)) {
    const direction = ['k', 'ArrowUp', '-'].includes(key) ? -1 : 1;
    const line = Math.max(0, Math.min(context.lineCount - 1, position.line + count * direction));
    if (['+', '-', 'Enter'].includes(key)) target = context.lineStart(line) + context.line(line).match(/^\s*/u)[0].length;
    else {
      visualColumn = goalColumn ?? visualPointColumn(context, offset);
      const point = offsetAtVisualColumn(context.line(line), visualColumn, {
        tabSize: context.editor.options?.tabSize ?? 4, segmenter: context.graphemes
      });
      target = context.lineStart(line) + point.offset;
    }
    target = normalPoint(context, target, line);
    linewise = true;
  } else if (key === '0' || key === 'Home') target = context.lineStart(position.line);
  else if (key === '^' || key === '_') {
    const line = key === '_' ? Math.min(context.lineCount - 1, position.line + count - 1) : position.line;
    target = context.lineStart(line) + context.line(line).match(/^\s*/u)[0].length;
    linewise = key === '_';
  } else if (key === '$' || key === 'End') {
    const line = Math.min(context.lineCount - 1, position.line + count - 1);
    target = Math.max(context.lineStart(line), adjacentCharacter(context, context.lineEnd(line), -1));
    inclusive = true;
  } else if (key === '|' || key === 'gg' || key === 'G') {
    const line = key === '|' ? position.line : explicitCount ? count - 1 : key === 'G' ? context.lineCount - 1 : 0;
    if (key === '|') {
      visualColumn = count - 1;
      target = context.lineStart(line) + offsetAtVisualColumn(context.line(line), visualColumn, {
        tabSize: context.editor.options?.tabSize ?? 4, segmenter: context.graphemes
      }).offset;
    } else target = context.offset({ line: Math.max(0, Math.min(context.lineCount - 1, line)), character: 0 });
    linewise = key !== '|';
  } else if (key === '{' || key === '}') {
    let line = position.line;
    const direction = key === '{' ? -1 : 1;
    for (let step = 0; step < count; step++) {
      do { line += direction; } while (line > 0 && line < context.lineCount - 1 && context.line(line).trim());
      line = Math.max(0, Math.min(context.lineCount - 1, line));
    }
    target = context.lineStart(line);
  } else if (key === '%') {
    const pairs = context.editor.pairs;
    let start = offset;
    if (!pairs?.has(start)) {
      const text = context.line(position.line);
      while (start < context.lineEnd(position.line) && !/[()[\]{}]/.test(text[start - context.lineStart(position.line)])) start++;
    }
    target = pairs?.get(start);
    if (target === undefined) return null;
    inclusive = true;
  } else if ((key === ';' || key === ',') && lastFind) {
    return findCharacter(context, offset, lastFind.character, {
      ...lastFind, direction: key === ',' ? -lastFind.direction : lastFind.direction, count
    });
  } else return null;
  return { target, inclusive, linewise, visualColumn };
}

export function findCharacter(context, offset, character, { direction = 1, till = false, count = 1 } = {}) {
  const position = context.position(offset);
  const text = context.line(position.line);
  let index = position.character;
  for (let step = 0; step < count; step++) {
    index = direction > 0 ? text.indexOf(character, index + 1) : text.lastIndexOf(character, index - 1);
    if (index < 0) return null;
  }
  const found = context.lineStart(position.line) + index;
  return { target: till ? adjacentCharacter(context, found, -direction) : found, inclusive: direction > 0, linewise: false };
}

export function motionRange(context, start, motion) {
  if (motion.linewise) {
    const first = Math.min(context.position(start).line, context.position(motion.target).line);
    const last = Math.max(context.position(start).line, context.position(motion.target).line);
    return { start: context.lineStart(first), end: context.lineEnd(last, true), linewise: true };
  }
  let from = Math.min(start, motion.target);
  let to = Math.max(start, motion.target);
  if (motion.inclusive) to = adjacentCharacter(context, to, 1);
  return { start: from, end: to, linewise: false };
}
