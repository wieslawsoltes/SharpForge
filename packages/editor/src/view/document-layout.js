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
    this.wrapRanges = [];
  }

  reset() {
    this.generation++;
    clearTimeout(this.wrapTimer);
    this.wrapTimer = null;
    this.wrapRanges = [];
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
    const ranges = [];
    for (const edit of change.changes) {
      const start = edit.newRange?.start.line ?? change.after.positionAt(edit.start).line;
      const end = edit.newRange?.end.line ?? start;
      ranges.push({start, end});
    }
    for (const line of this.cache.keys()) if (ranges.some(range => range.start <= line && line <= range.end)) this.cache.delete(line);
    this.measureWrap(ranges);
  }

  configure(width) {
    width = Math.max(10, width);
    if (Math.abs(width - this.width) < 1) return;
    this.width = width;
    this.reset();
  }

  measureWrap(ranges = [{start: 0, end: this.map.lineCount - 1}]) {
    if (!this.editor.options.wordWrap || this.editor.largeFile.active) return;
    const sorted = [...this.wrapRanges, ...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
    this.wrapRanges = [];
    for (const range of sorted) {
      const previous = this.wrapRanges.at(-1);
      if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
      else this.wrapRanges.push({...range});
    }
    this.scheduleWrap();
  }

  scheduleWrap() {
    if (this.wrapTimer || !this.wrapRanges.length) return;
    const generation = this.generation;
    this.wrapTimer = setTimeout(() => {
      this.wrapTimer = null;
      if (this.editor.disposed || generation !== this.generation) return;
      this.flushWrap();
    }, 0);
  }

  /** Reconcile at most 128 lines / 32 KiB of fragments; offscreen edits do not require scrolling to become measurable. */
  flushWrap() {
    clearTimeout(this.wrapTimer);
    this.wrapTimer = null;
    if (this.editor.disposed || !this.editor.options.wordWrap || this.editor.largeFile.active) return;
    let lines = 0;
    let characters = 0;
    while (this.wrapRanges.length && lines < 128 && characters < 32768) {
      const range = this.wrapRanges[0];
      const record = this.line(range.start++);
      characters += record.text.length;
      lines++;
      if (range.start > range.end) this.wrapRanges.shift();
    }
    this.editor.view?.schedule?.();
    this.scheduleWrap();
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

  dispose() { this.generation++; clearTimeout(this.wrapTimer); this.wrapTimer = null; this.wrapRanges = []; this.cache.clear(); }
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
