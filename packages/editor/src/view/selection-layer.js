import {hasBidi} from './bidi.js';

/** Visible selection rectangles and independently blinking carets use the same line geometry as hit testing. */
export class SelectionLayer {
  constructor(view) {
    this.view = view;
    this.layer = view.document.createElement('div');
    this.layer.className = 'sf-selection-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    view.surface.append(this.layer);
  }

  render(rows) {
    const {editor, metrics, layout} = this.view;
    const fragment = this.view.document.createDocumentFragment();
    const selections = editor.getSelections();
    for (const selection of selections) {
      const start = Math.min(selection.anchor, selection.active);
      const end = Math.max(selection.anchor, selection.active);
      for (const row of rows) {
        const base = row.record.start + row.record.sliceStart;
        const from = Math.max(start, base + row.segment.start);
        const to = Math.min(end, base + row.segment.end);
        if (to <= from) continue;
        const element = this.view.lines.elementFor(row.line, row.continuation);
        if (hasBidi(row.record.text) && element) {
          this.bidiSelection(fragment, element, from - base - row.segment.start, to - base - row.segment.start);
        } else {
          const x = metrics.xAt(row.record.layout, from - base) - row.segment.x + row.segment.indent;
          const right = metrics.xAt(row.record.layout, to - base) - row.segment.x + row.segment.indent;
          const prefix = row.record.sliceStart * metrics.charWidth;
          this.rectangle(fragment, 'sf-selection', x + prefix + editor.padding, row.top, Math.max(1, right - x), metrics.lineHeight);
        }
      }
      if (!editor.folding.hidden(editor.model.positionAt(selection.active).line)) {
        const position = layout.position(selection.active);
        const top = editor.padding + position.row * metrics.lineHeight;
        const visible = top + metrics.lineHeight >= this.view.scrollTop;
        if (visible && top <= this.view.scrollTop + this.view.viewport.clientHeight) {
          const width = editor.overtype ? metrics.charWidth : 1.5;
          const virtual = (selection.activeVirtualSpace ?? 0) * metrics.charWidth;
          let x = position.x + editor.padding + virtual;
          let y = top;
          const row = this.view.lines.elementFor(position.line, position.continuation);
          if (row && hasBidi(position.record.text)) {
            const local = selection.active - position.record.start - position.record.sliceStart - position.segment.start;
            const rect = this.view.bidi.caret(row, local);
            if (rect) {
              const surface = this.view.surface.getBoundingClientRect();
              x = rect.left - surface.left + virtual;
              y = rect.top - surface.top + this.view.scrollTop - this.view.viewport.scrollTop;
            }
          }
          this.rectangle(fragment, `sf-caret${editor.overtype ? ' sf-block-caret' : ''}`, x, y, width, metrics.lineHeight);
        }
      }
    }
    this.layer.replaceChildren(fragment);
  }

  bidiSelection(fragment, element, start, end) {
    const surface = this.view.surface.getBoundingClientRect();
    for (const rect of this.view.bidi.rectangles(element, start, end)) {
      const logicalTop = rect.top - surface.top + this.view.scrollTop - this.view.viewport.scrollTop;
      this.rectangle(fragment, 'sf-selection', rect.left - surface.left, logicalTop, rect.width, rect.height);
    }
  }

  rectangle(fragment, className, left, top, width, height) {
    const node = this.view.document.createElement('div');
    node.className = className;
    Object.assign(node.style, {left: `${left}px`, top: `${this.view.y(top)}px`, width: `${width}px`, height: `${height}px`});
    fragment.append(node);
  }

  dispose() { this.layer.remove(); }
}
