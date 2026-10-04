import {whitespaceMarkers} from './whitespace.js';
import {LineContent} from './line-content.js';

/** Recycled DOM rows; only visible visual lines plus overscan own elements. */
export class VirtualLines {
  constructor(view) {
    this.view = view;
    this.pool = [];
    this.visible = new Map();
    this.content = new LineContent(view);
    this.layer = view.document.createElement('div');
    this.layer.className = 'sf-highlight sf-line-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    view.surface.append(this.layer);
  }

  render(rows) {
    const {editor} = this.view;
    const active = new Set();
    let characters = 0;
    let tokenCount = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const key = `${row.line}:${row.continuation}`;
      active.add(key);
      let element = this.visible.get(key);
      if (!element) {
        element = this.pool.pop() ?? this.view.document.createElement('div');
        element.className = 'sf-view-line';
        element.dir = 'auto';
        this.visible.set(key, element);
        this.layer.append(element);
      }
      const {record, segment} = row;
      const start = record.start + record.sliceStart + segment.start;
      const end = record.start + record.sliceStart + segment.end;
      const revision = `${editor.model.version}:${editor.decorationRevision}:${editor.optionsRevision}:${start}:${end}`;
      element.dataset.line = String(row.line);
      element.dataset.start = String(start);
      element.style.top = `${this.view.y(row.top)}px`;
      element.style.left = `${editor.padding + segment.indent + record.sliceStart * this.view.metrics.charWidth}px`;
      element.style.height = `${this.view.metrics.lineHeight}px`;
      element.classList.toggle('sf-current-line', row.line === editor.model.positionAt(editor.offset).line);
      element.classList.toggle('sf-execution-line', row.line + 1 === editor.executionLine);
      element.classList.toggle('sf-selected-frame-line', row.line + 1 === editor.selectedFrameLine);
      if (element.dataset.revision !== revision) {
        const ranges = editor.highlightIndex.ranges(start, end, 1000);
        if (this.content.render(element, ranges.runs, row)) renderMarkers(element, row, editor, this.view);
        element.dataset.revision = revision;
      }
      characters += end - start;
      tokenCount += element.childElementCount;
    }
    for (const [key, element] of this.visible) {
      if (active.has(key)) continue;
      element.remove();
      this.visible.delete(key);
      if (this.pool.length < 160) this.pool.push(element);
    }
    editor.highlightMetrics = {
      firstLine: rows[0]?.line ?? 0, lastLine: (rows.at(-1)?.line ?? 0) + 1,
      paintedCharacters: characters, paintedRuns: tokenCount,
      totalTokens: editor.highlightIndex.tokens?.length ?? 0, syntax: !!editor.highlightIndex.lexed,
      domLines: this.visible.size, ...editor.highlightIndex.metrics
    };
  }

  elementFor(line, continuation = 0) { return this.visible.get(`${line}:${continuation}`); }
  dispose() { this.content.dispose(); this.visible.clear(); this.pool.length = 0; this.layer.remove(); }
}

function renderMarkers(element, row, editor, view) {
  const {record, segment} = row;
  const last = row.continuation === record.segments.length - 1;
  const markers = whitespaceMarkers(record.text, record.layout, {enabled: editor.options.renderWhitespace, eol: last ? record.eol : ''});
  for (const marker of markers) {
    if (marker.offset < segment.start || marker.offset > segment.end) continue;
    const node = view.document.createElement('i');
    node.className = `sf-whitespace sf-whitespace-${marker.kind}`;
    node.dataset.decorationOnly = 'true';
    node.style.left = `${marker.x - segment.x}px`;
    node.textContent = marker.glyph;
    element.append(node);
  }
  if (row.continuation) {
    const glyph = view.document.createElement('i');
    glyph.className = 'sf-wrap-glyph';
    glyph.dataset.decorationOnly = 'true';
    glyph.textContent = '↪';
    element.append(glyph);
  }
  const folded = editor.folding.at(row.line);
  if (folded?.collapsed && editor.folding.enabled && last) view.foldingMargin.appendHint(element, folded);
}
