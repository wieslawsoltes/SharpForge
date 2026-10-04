import { nextGraphemeOffset, previousGraphemeOffset, nextWordOffset, previousWordOffset } from '@sharpforge/text';

/** Grapheme boundaries are line-local; CRLF is one movement between lines. */
export function adjacentCharacter(context, offset, direction) {
  const position = context.position(offset);
  const start = context.lineStart(position.line);
  const text = context.line(position.line);
  if (direction < 0 && offset === start) return position.line ? context.lineEnd(position.line - 1) : 0;
  if (direction > 0 && offset >= start + text.length) {
    return position.line + 1 < context.lineCount ? context.lineStart(position.line + 1) : context.length;
  }
  const operation = direction > 0 ? nextGraphemeOffset : previousGraphemeOffset;
  return start + operation(text, offset - start, { segmenter: context.graphemes });
}

export function adjacentWord(context, offset, direction, subword = false) {
  const position = context.position(offset);
  const start = context.lineStart(position.line);
  const text = context.line(position.line);
  const at = Math.min(text.length, offset - start);
  if (direction < 0 && at === 0 || direction > 0 && at === text.length) return adjacentCharacter(context, offset, direction);
  const operation = direction > 0 ? nextWordOffset : previousWordOffset;
  return start + operation(text, at, { subword, segmenter: context.words });
}

export function moveSelections(context, movement, { extend = false, count = 1 } = {}) {
  if (typeof context.editor.moveCursor === 'function') {
    const options = { extend, count };
    let direction = movement;
    if (movement.startsWith('word')) { options.word = true; direction = movement.slice(4).toLowerCase(); }
    if (movement.startsWith('subword')) { options.subword = true; direction = movement.slice(7).toLowerCase(); }
    if (movement.startsWith('page')) { options.page = true; direction = movement.slice(4).toLowerCase(); }
    if (movement.startsWith('document')) { options.document = true; direction = movement.endsWith('Start') ? 'home' : 'end'; }
    return context.editor.moveCursor(direction, options);
  }
  const selections = context.selections.map(selection => {
    let head = selection.head;
    if (!extend && selection.head !== selection.anchor && ['left', 'right'].includes(movement)) {
      head = movement === 'left' ? Math.min(selection.head, selection.anchor) : Math.max(selection.head, selection.anchor);
    } else {
      for (let step = 0; step < count; step++) head = movePosition(context, head, movement);
    }
    return { anchor: extend ? selection.anchor : head, head };
  });
  context.select(selections);
}

export function movePosition(context, offset, movement) {
  const position = context.position(offset);
  const actions = {
    left: () => adjacentCharacter(context, offset, -1), right: () => adjacentCharacter(context, offset, 1),
    wordLeft: () => adjacentWord(context, offset, -1), wordRight: () => adjacentWord(context, offset, 1),
    subwordLeft: () => adjacentWord(context, offset, -1, true), subwordRight: () => adjacentWord(context, offset, 1, true),
    up: () => context.offset({ line: Math.max(0, position.line - 1), character: position.character }),
    down: () => context.offset({ line: Math.min(context.lineCount - 1, position.line + 1), character: position.character }),
    pageUp: () => context.offset({ line: Math.max(0, position.line - pageLines(context)), character: position.character }),
    pageDown: () => context.offset({ line: Math.min(context.lineCount - 1, position.line + pageLines(context)), character: position.character }),
    home: () => {
      const start = context.lineStart(position.line);
      const indent = context.line(position.line).match(/^\s*/u)[0].length;
      return offset === start + indent ? start : start + indent;
    },
    end: () => context.lineEnd(position.line), documentStart: () => 0, documentEnd: () => context.length
  };
  const action = actions[movement];
  if (!action) throw new Error(`Unknown movement '${movement}'`);
  return action();
}

function pageLines(context) {
  return Math.max(1, Math.floor((context.editor.element?.clientHeight ?? 440) / (context.editor.lineHeight ?? 22)) - 2);
}
