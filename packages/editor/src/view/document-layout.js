import {VisualLineMap, wrapLine} from './wrap.js';

/** Logical/visual mapping shared by lines, margins, hit testing, folding and inline zones. */
export class DocumentLayout {
  constructor(editor, metrics) {
    this.editor = editor;
    this.metrics = metrics;
    this.map = new VisualLineMap(editor.model.lineCount);
    this.cache = new Map();
    this.width = 800;
    this.zoneRows = new Map();
    this.leadingRows = 0;
    this.hiddenRanges = [];
    this.generation = 0;
  }

  reset() {
    this.generation++;
    this.map.reset(this.editor.model.lineCount);
    this.zoneRows.clear();
    this.leadingRows = 0;
    this.hiddenRanges = [];
    this.cache.clear();
    this.applyFolding();
    this.applyZones();
    this.measureWrap();
  }

  invalidate(change) {
    if (this.map.lineCount !== this.editor.model.lineCount) {
      this.reset();
      return;
    }
    for (const edit of change.changes) {
      const start = edit.newRange?.start.line ?? change.after.positionAt(edit.start).line;
      const end = edit.newRange?.end.line ?? start;
      for (let line = start; line <= end; line++) this.cache.delete(line);
    }
  }

  configure(width) {
    width = Math.max(10, width);
    if (Math.abs(width - this.width) < 1) return;
    this.width = width;
    this.reset();
  }

  measureWrap() {
    if (!this.editor.options.wordWrap || this.editor.largeFile.active) return;
    const generation = this.generation;
    let line = 0;
    const work = () => {
      if (this.editor.disposed || generation !== this.generation) return;
      const end = Math.min(this.map.lineCount, line + 128);
      for (; line < end; line++) this.line(line);
      this.editor.view?.schedule();
      if (line < this.map.lineCount) this.wrapTimer = setTimeout(work, 0);
    };
    this.wrapTimer = setTimeout(work, 0);
  }

  applyFolding() {
    for (const region of this.hiddenRanges) {
      for (let line = region.startLine + 1; line <= Math.min(region.endLine, this.map.lineCount - 1); line++) {
        this.map.set(line, (this.cache.get(line)?.segments.length ?? 1) + (this.zoneRows.get(line) ?? 0));
      }
    }
    this.hiddenRanges = this.editor.folding.collapsedRanges().map(region => ({startLine: region.startLine, endLine: region.endLine}));
    for (const region of this.hiddenRanges) {
      for (let line = region.startLine + 1; line <= Math.min(region.endLine, this.map.lineCount - 1); line++) this.map.set(line, 0);
    }
  }

  applyZones() {
    for (const [line, count] of this.zoneRows) {
      if (line < this.map.lineCount && this.map.counts[line]) this.map.set(line, Math.max(1, this.map.counts[line] - count));
    }
    this.zoneRows.clear();
    this.leadingRows = 0;
    for (const zones of this.editor.viewZones.values()) {
      for (const zone of zones) {
        const line = Math.max(0, Math.min(this.map.lineCount - 1, zone.afterLine));
        const count = Math.ceil(Math.max(0, zone.height) / this.metrics.lineHeight);
        if (zone.afterLine < 0) { this.leadingRows += count; continue; }
        this.zoneRows.set(line, (this.zoneRows.get(line) ?? 0) + count);
        if (this.map.counts[line]) this.map.set(line, this.map.counts[line] + count);
      }
    }
  }

  line(line) {
    const {editor, metrics} = this;
    const model = editor.model;
    const info = lineInfo(model, line);
    const maximum = editor.options.maxRenderedLineCharacters;
    const horizontal = Math.floor(editor.view.viewport.scrollLeft / metrics.charWidth) - 100;
    const sliceStart = info.length > maximum ? Math.max(0, Math.min(info.length - maximum, horizontal)) : 0;
    const cached = this.cache.get(line);
    if (cached && cached.start === info.start && cached.length === info.length && cached.sliceStart === sliceStart) return cached;
    const text = model.getText(info.start + sliceStart, Math.min(info.end, info.start + sliceStart + maximum));
    const layout = metrics.line(text, model.version);
    const enabled = editor.options.wordWrap && !editor.largeFile.active && !sliceStart && info.length <= maximum;
    const indentText = text.match(/^\s*/)?.[0] ?? '';
    const indent = metrics.line(indentText).width + metrics.charWidth * 2;
    const segments = wrapLine(layout, this.width, {enabled, indent});
    const result = {...info, text, layout, segments, sliceStart};
    this.cache.set(line, result);
    if (this.cache.size > 2048) this.cache.delete(this.cache.keys().next().value);
    if (!editor.folding.hidden(line)) this.map.set(line, segments.length + (this.zoneRows.get(line) ?? 0));
    return result;
  }

  rows(scrollTop, height, {overscan = 4, limit = 160} = {}) {
    const lineHeight = this.metrics.lineHeight;
    const first = Math.max(0, Math.floor((scrollTop - this.editor.padding) / lineHeight) - this.leadingRows - overscan);
    const count = Math.min(limit, Math.ceil(height / lineHeight) + overscan * 2 + 2);
    const rows = [];
    for (let visual = first; visual < Math.min(this.map.rowCount, first + count); visual++) {
      const {line, continuation} = this.map.lineAt(visual);
      const record = this.line(line);
      const segment = record.segments[continuation];
      if (!segment) continue;
      rows.push({line, continuation, visual, top: this.editor.padding + (visual + this.leadingRows) * lineHeight, record, segment});
    }
    return rows;
  }

  position(offset) {
    const position = this.editor.model.positionAt(offset);
    const record = this.line(position.line);
    const local = Math.max(0, position.character - record.sliceStart);
    let continuation = record.segments.findIndex(segment => local < segment.end);
    if (continuation < 0) continuation = record.segments.length - 1;
    const segment = record.segments[continuation];
    const x = this.metrics.xAt(record.layout, local) - segment.x + segment.indent + record.sliceStart * this.metrics.charWidth;
    return {line: position.line, continuation, row: this.map.rowAt(position.line) + continuation + this.leadingRows, x, record, segment};
  }

  dispose() { this.generation++; clearTimeout(this.wrapTimer); this.cache.clear(); }
}

/** Read line extent without allocating a full line, including huge single-line documents. */
export function lineInfo(model, line) {
  const start = model.offsetAt({line, character: 0});
  const next = line + 1 < model.lineCount ? model.offsetAt({line: line + 1, character: 0}) : model.length;
  const tail = model.getText(Math.max(start, next - 2), next);
  const eol = tail.endsWith('\r\n') ? '\r\n' : tail.endsWith('\n') ? '\n' : tail.endsWith('\r') ? '\r' : '';
  const end = next - eol.length;
  return {line, start, end, eol, length: end - start};
}
