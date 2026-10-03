import { adjacentCharacter } from '../commands/movement.js';

const word = /[\p{L}\p{N}\p{M}_]/u;
const whitespace = /\s/u;
const category = (character, big) => character === undefined || whitespace.test(character) ? 0 : big || word.test(character) ? 1 : 2;

export function vimWord(context, offset, { direction = 1, end = false, big = false } = {}) {
  let position = context.position(offset);
  let line = position.line;
  let text = context.line(line);
  let character = position.character;
  if (direction < 0) {
    character--;
    while (character < 0 && line > 0) { line--; text = context.line(line); character = text.length - 1; }
    while (character >= 0 && category(text[character], big) === 0) {
      character--;
      if (character < 0 && line > 0) { line--; text = context.line(line); character = text.length - 1; }
    }
    const kind = category(text[character], big);
    while (character > 0 && category(text[character - 1], big) === kind) character--;
    return context.lineStart(line) + Math.max(0, character);
  }
  if (end) character++;
  else {
    const kind = category(text[character], big);
    while (character < text.length && category(text[character], big) === kind) character++;
  }
  while (true) {
    while (character < text.length && category(text[character], big) === 0) character++;
    if (character < text.length || line + 1 === context.lineCount) break;
    line++;
    text = context.line(line);
    character = 0;
  }
  if (end) {
    const kind = category(text[character], big);
    while (character + 1 < text.length && category(text[character + 1], big) === kind) character++;
  }
  return context.lineStart(line) + Math.min(text.length, character);
}

export function vimMotion(context, key, offset, { count = 1, explicitCount = false, goalColumn, lastFind } = {}) {
  const position = context.position(offset);
  let target = offset;
  let inclusive = false;
  let linewise = false;
  if (['w', 'W', 'b', 'B', 'e', 'E'].includes(key)) {
    for (let step = 0; step < count; step++) target = vimWord(context, target, {
      direction: ['b', 'B'].includes(key) ? -1 : 1, end: ['e', 'E'].includes(key), big: key === key.toUpperCase()
    });
    inclusive = ['e', 'E'].includes(key);
  } else if (['h', 'l', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Space'].includes(key)) {
    const direction = ['h', 'ArrowLeft', 'Backspace'].includes(key) ? -1 : 1;
    for (let step = 0; step < count; step++) target = adjacentCharacter(context, target, direction);
    target = Math.max(context.lineStart(position.line), Math.min(target,
      Math.max(context.lineStart(position.line), context.lineEnd(position.line) - 1)));
  } else if (['j', 'k', 'ArrowDown', 'ArrowUp', '+', '-', 'Enter'].includes(key)) {
    const direction = ['k', 'ArrowUp', '-'].includes(key) ? -1 : 1;
    const line = Math.max(0, Math.min(context.lineCount - 1, position.line + count * direction));
    const column = ['+', '-', 'Enter'].includes(key) ? context.line(line).match(/^\s*/u)[0].length : goalColumn ?? position.character;
    target = context.offset({ line, character: Math.min(column, Math.max(0, context.line(line).length - 1)) });
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
    target = context.offset({ line: Math.max(0, Math.min(context.lineCount - 1, line)), character: key === '|' ? count - 1 : 0 });
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
  return { target, inclusive, linewise };
}

export function findCharacter(context, offset, character, { direction = 1, till = false, count = 1 } = {}) {
  const position = context.position(offset);
  const text = context.line(position.line);
  let index = position.character;
  for (let step = 0; step < count; step++) {
    index = direction > 0 ? text.indexOf(character, index + 1) : text.lastIndexOf(character, index - 1);
    if (index < 0) return null;
  }
  return { target: context.lineStart(position.line) + index - (till ? direction : 0), inclusive: direction > 0, linewise: false };
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
