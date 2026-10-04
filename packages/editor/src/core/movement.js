import {nextGraphemeOffset, previousGraphemeOffset, nextWordOffset, previousWordOffset, graphemeSegments} from '@sharpforge/text';
import {hasBidi} from '../view/bidi.js';

/** Visual movement uses rendered wraps/bidi while offsets and edits remain logical UTF-16. */
export class EditorMovement {
  constructor(editor) { this.editor = editor; this.preferredColumns = new Map(); }

  move(direction, options = {}) {
    const {editor} = this;
    const selections = editor.getSelections().map((selection, index) => {
      const start = Math.min(selection.anchor, selection.active);
      const end = Math.max(selection.anchor, selection.active);
      const virtual = selection.activeVirtualSpace ?? 0;
      const position = editor.model.positionAt(selection.active);
      const lineEnd = editor.model.getLine(position.line).length === position.character;
      if (editor.options.virtualSpace && !options.word && !options.document && start === end && lineEnd) {
        if (direction === 'right' || direction === 'left' && virtual > 0) {
          const activeVirtualSpace = Math.max(0, virtual + (direction === 'right' ? 1 : -1));
          return {...selection, activeVirtualSpace, anchorVirtualSpace: options.extend ? selection.anchorVirtualSpace : activeVirtualSpace};
        }
      }
      if (!options.extend && start !== end && ['left', 'right'].includes(direction)) {
        const active = direction === 'left' ? start : end;
        return {anchor: active, active};
      }
      const active = this.destination(selection.active, direction, options, index);
      return {anchor: options.extend ? selection.anchor : active, active, activeVirtualSpace: 0, anchorVirtualSpace: 0};
    });
    editor.setSelections(selections);
    editor.view.reveal(selections[editor.primaryIndex ?? 0].active);
  }

  destination(offset, direction, options, index) {
    const {editor} = this;
    const position = editor.model.positionAt(offset);
    const line = editor.model.getLine(position.line);
    const base = offset - position.character;
    if (options.document) return ['home', 'up', 'left'].includes(direction) ? 0 : editor.model.length;
    if (['left', 'right'].includes(direction)) {
      this.preferredColumns.delete(index);
      return this.horizontal({offset, position, line, base}, direction, options);
    }
    const current = editor.view.layout.position(offset);
    if (direction === 'home') {
      const start = base + current.record.sliceStart + current.segment.start;
      const text = line.slice(current.segment.start, current.segment.end);
      const firstText = start + text.match(/^[\t ]*/)[0].length;
      return offset === firstText ? start : firstText;
    }
    if (direction === 'end') return base + current.record.sliceStart + current.segment.end;
    const count = options.page ? Math.max(1, Math.floor(editor.view.viewport.clientHeight / editor.lineHeight) - 1) : 1;
    const row = current.row - editor.view.layout.leadingRows + (direction === 'up' ? -count : count);
    let next = editor.view.layout.map.lineAt(row);
    let target = editor.view.layout.line(next.line);
    if (next.continuation >= target.segments.length) {
      const nextRow = direction === 'up' ? editor.view.layout.map.rowAt(next.line) + target.segments.length - 1
        : editor.view.layout.map.rowAt(next.line + 1);
      next = editor.view.layout.map.lineAt(nextRow);
      target = editor.view.layout.line(next.line);
    }
    const segment = target.segments[Math.min(next.continuation, target.segments.length - 1)];
    const x = this.preferredColumns.get(index) ?? current.x;
    this.preferredColumns.set(index, x);
    const local = editor.view.metrics.offsetAt(target.layout, x - segment.indent + segment.x - target.sliceStart * editor.view.metrics.charWidth);
    return target.start + target.sliceStart + Math.min(segment.end, Math.max(segment.start, local));
  }

  horizontal(context, direction, options) {
    const {editor} = this;
    const {offset, position, line, base} = context;
    const forward = direction === 'right';
    if (options.word || options.subword) {
      const operation = forward ? nextWordOffset : previousWordOffset;
      const next = operation(line, position.character, {subword: !!options.subword});
      if (next !== position.character) return base + next;
    } else if (hasBidi(line)) {
      const current = editor.view.layout.position(offset);
      const row = editor.view.lines.elementFor(position.line, current.continuation);
      if (row) {
        const sliceStart = current.record.sliceStart + current.segment.start;
        const source = current.record.text.slice(current.segment.start, current.segment.end);
        const boundaries = [0, ...graphemeSegments(source).map(segment => segment.end)];
        const local = position.character - sliceStart;
        const next = editor.view.bidi.visualMove(row, local, forward ? 1 : -1, boundaries);
        if (next !== local) return base + sliceStart + next;
      }
    } else {
      const operation = forward ? nextGraphemeOffset : previousGraphemeOffset;
      const next = operation(line, position.character);
      if (next !== position.character) return base + next;
    }
    if (forward && position.line + 1 < editor.model.lineCount) return editor.model.offsetAt({line: position.line + 1, character: 0});
    if (!forward && position.line > 0) {
      const previous = editor.model.getLine(position.line - 1);
      return editor.model.offsetAt({line: position.line - 1, character: previous.length});
    }
    return offset;
  }
}
