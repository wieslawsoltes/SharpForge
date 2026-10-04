import {LineLayout, canvasMeasure} from './layout.js';
import {DocumentLayout} from './document-layout.js';
import {VirtualLines} from './lines.js';
import {SelectionLayer} from './selection-layer.js';
import {BidiGeometry, hasBidi} from './bidi.js';
import {MarginLayer} from './margins.js';
import {FoldingMargin} from './folding-margin.js';
import {EditorScroll} from './scroll.js';
import {OverviewRuler} from './overview-ruler.js';
import {StructureGuides} from './structure-guides.js';
import {StickyScroll} from './sticky-scroll.js';

/** One view over one shared buffer. Selection and scroll belong to the view, not the document. */
export class VirtualEditorView {
  constructor(editor) {
    this.editor = editor;
    this.document = editor.element.ownerDocument;
    this.viewport = this.document.createElement('div');
    this.scroller = this.viewport;
    this.viewport.className = 'sf-viewport';
    this.surface = this.document.createElement('div');
    this.surface.className = 'sf-scroll-surface';
    this.viewport.append(this.surface);
    editor.element.append(this.viewport);
    this.metrics = new LineLayout({measure: canvasMeasure(this.document)});
    this.layout = new DocumentLayout(editor, this.metrics);
    this.bidi = new BidiGeometry(this.document);
    this.foldingMargin = new FoldingMargin(this);
    this.lines = new VirtualLines(this);
    this.selections = new SelectionLayer(this);
    this.margins = new MarginLayer(this);
    this.scroll = new EditorScroll(this);
    this.overview = new OverviewRuler(this);
    this.guides = new StructureGuides(this);
    this.sticky = new StickyScroll(this);
    this.zoneLayer = this.document.createElement('div');
    this.zoneLayer.className = 'sf-zone-layer';
    this.surface.append(this.zoneLayer);
    this.pointerDown = event => this.beginSelection(event);
    this.viewport.addEventListener('pointerdown', this.pointerDown);
    this.pointerMove = event => editor.hover?.(event);
    this.viewport.addEventListener('pointermove', this.pointerMove);
    this.resizeObserver = new this.document.defaultView.ResizeObserver(() => { this.configure(); this.schedule(); });
    this.resizeObserver.observe(editor.element);
    this.configure();
  }

  get scrollTop() { return this.viewport.scrollTop * (this.scroll?.scale ?? 1); }
  y(logicalY) { return logicalY - this.scrollTop + this.viewport.scrollTop; }
  scrollTo({top = this.scrollTop, left = this.viewport.scrollLeft, behavior = 'auto'} = {}) {
    const reduced = this.document.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const options = {top: Math.max(0, top / (this.scroll?.scale ?? 1)), left: Math.max(0, left), behavior: reduced ? 'auto' : behavior};
    if (this.viewport.scrollTo) this.viewport.scrollTo(options);
    else { this.viewport.scrollTop = options.top; this.viewport.scrollLeft = options.left; }
    this.schedule();
  }

  configure() {
    const {options} = this.editor;
    const zoom = options.zoom / 100;
    const fontSize = options.fontSize * zoom;
    const lineHeight = options.lineHeight * zoom;
    const font = `${fontSize}px ${options.fontFamily}`;
    const measured = this.metrics.measure?.('M', font) ?? fontSize * 0.6;
    this.metrics.configure({font, tabSize: options.tabSize, lineHeight, charWidth: measured});
    this.editor.lineHeight = lineHeight;
    this.editor.element.style.setProperty('--sf-editor-font', font);
    this.editor.element.style.setProperty('--sf-line-height', `${lineHeight}px`);
    this.editor.element.style.setProperty('--sf-tab-size', String(options.tabSize));
    this.layout.configure(this.viewport.clientWidth - this.editor.padding * 2 - 14);
  }

  schedule() {
    if (this.frame || this.editor.disposed) return;
    this.frame = this.document.defaultView.requestAnimationFrame(() => { this.frame = null; this.render(); });
  }

  render() {
    if (this.editor.disposed) return;
    this.configure();
    const rows = this.layout.rows(this.scrollTop, this.viewport.clientHeight || this.editor.element.clientHeight || 400);
    this.scroll.update(rows);
    this.lines.render(rows);
    this.selections.render(rows);
    this.margins.render(rows);
    this.guides.render(rows);
    this.sticky.render(rows);
    this.overview.render();
    this.editor.bracketColors?.render();
    this.renderZones();
    this.editor.inputController?.synchronize();
    this.editor.notifyContributions('render', {rows});
  }

  coordsAt(offset) {
    const position = this.layout.position(Math.max(0, Math.min(this.editor.model.length, offset)));
    const viewport = this.viewport.getBoundingClientRect();
    const outer = this.editor.element.getBoundingClientRect();
    const element = this.lines.elementFor(position.line, position.continuation);
    let left = viewport.left - outer.left + this.editor.padding + position.x - this.viewport.scrollLeft;
    let top = viewport.top - outer.top + this.editor.padding + position.row * this.metrics.lineHeight - this.scrollTop;
    if (element && hasBidi(position.record.text)) {
      const localOffset = offset - position.record.start - position.record.sliceStart - position.segment.start;
      const rect = this.bidi.caret(element, localOffset);
      if (rect) { left = rect.left - outer.left; top = rect.top - outer.top; }
    }
    return {left, top, height: this.metrics.lineHeight, local: true};
  }

  positionAt(clientX, clientY) {
    const rectangle = this.viewport.getBoundingClientRect();
    const y = Math.max(0, clientY - rectangle.top + this.scrollTop - this.editor.padding);
    const x = clientX - rectangle.left + this.viewport.scrollLeft - this.editor.padding;
    const {line, continuation} = this.layout.map.lineAt(Math.floor(y / this.metrics.lineHeight) - this.layout.leadingRows);
    const record = this.layout.line(line);
    const segment = record.segments[Math.min(record.segments.length - 1, continuation)];
    const row = this.lines.elementFor(line, continuation);
    if (row && hasBidi(record.text)) {
      const position = this.document.caretPositionFromPoint?.(clientX, clientY);
      const range = !position ? this.document.caretRangeFromPoint?.(clientX, clientY) : null;
      const node = position?.offsetNode ?? range?.startContainer;
      if (node && row.contains(node)) {
        const span = node.parentElement.closest('[data-offset]');
        if (span) return Number(span.dataset.offset) + (position?.offset ?? range.startOffset);
      }
    }
    const adjusted = x - segment.indent + segment.x - record.sliceStart * this.metrics.charWidth;
    const offset = this.metrics.offsetAt(record.layout, adjusted);
    return record.start + record.sliceStart + Math.max(segment.start, Math.min(segment.end, offset));
  }

  reveal(offset, {center = false} = {}) {
    const position = this.editor.model.positionAt(offset);
    this.editor.folding.reveal(position.line);
    const item = this.layout.position(offset);
    const top = this.editor.padding + item.row * this.metrics.lineHeight;
    const height = this.viewport.clientHeight || 400;
    let scroll = this.scrollTop;
    if (center) scroll = Math.max(0, top - height * 0.35);
    else if (top < scroll + this.metrics.lineHeight) scroll = Math.max(0, top - this.metrics.lineHeight);
    else if (top + this.metrics.lineHeight > scroll + height) scroll = top + this.metrics.lineHeight - height;
    let left = this.viewport.scrollLeft;
    if (item.x < left) left = item.x;
    if (item.x + this.metrics.charWidth > left + this.viewport.clientWidth - 40) left = item.x - this.viewport.clientWidth + 40;
    this.scrollTo({top: scroll, left: Math.max(0, left)});
  }

  beginSelection(event) {
    if (event.button !== 0 || event.target.closest('button,input,textarea,[role="dialog"]')) return;
    const offset = this.positionAt(event.clientX, event.clientY);
    const editor = this.editor;
    const original = editor.getSelections();
    const selected = original.some(selection => offset >= Math.min(selection.anchor, selection.active)
      && offset < Math.max(selection.anchor, selection.active));
    if (selected && !event.shiftKey && !event.altKey && event.detail === 1) {
      this.viewport.addEventListener('pointerup', end => {
        if (!this.dragInProgress && Math.hypot(end.clientX - event.clientX, end.clientY - event.clientY) < 3) {
          editor.setSelections([{anchor: offset, active: offset}]);
          editor.focus();
        }
      }, {once: true});
      return;
    }
    event.preventDefault();
    const anchor = event.shiftKey ? original[editor.primaryIndex ?? 0].anchor : offset;
    if (event.altKey && !event.shiftKey) editor.setSelections([...original, {anchor: offset, active: offset}]);
    else editor.setSelections([{anchor, active: offset}]);
    editor.focus();
    this.viewport.setPointerCapture?.(event.pointerId);
    const move = current => {
      const next = this.positionAt(current.clientX, current.clientY);
      if (current.altKey && current.shiftKey && editor.setBoxSelection) editor.setBoxSelection(anchor, next);
      else editor.setSelections([{anchor, active: next}]);
      const rect = this.viewport.getBoundingClientRect();
      if (current.clientY < rect.top) this.scrollTo({top: this.scrollTop - this.metrics.lineHeight});
      if (current.clientY > rect.bottom) this.scrollTo({top: this.scrollTop + this.metrics.lineHeight});
    };
    const stop = () => {
      this.viewport.removeEventListener('pointermove', move);
      this.viewport.removeEventListener('pointerup', stop);
      this.viewport.removeEventListener('pointercancel', stop);
    };
    this.viewport.addEventListener('pointermove', move);
    this.viewport.addEventListener('pointerup', stop);
    this.viewport.addEventListener('pointercancel', stop);
    if (event.detail === 2) editor.runCommand('edit.selectWord');
    if (event.detail >= 3) {
      const line = editor.model.positionAt(offset).line;
      editor.setSelections([{anchor: editor.model.offsetAt({line, character: 0}),
        active: line + 1 < editor.model.lineCount ? editor.model.offsetAt({line: line + 1, character: 0}) : editor.model.length}]);
    }
  }

  renderZones() {
    const active = new Set();
    for (const zones of this.editor.viewZones.values()) {
      for (const zone of zones) {
        if (!zone.node || zone.afterLine >= 0 && this.editor.folding.hidden(zone.afterLine)) continue;
        active.add(zone.node);
        this.zoneLayer.append(zone.node);
        const row = zone.afterLine < 0 ? 0
          : this.layout.leadingRows + this.layout.map.rowAt(zone.afterLine) + this.layout.line(zone.afterLine).segments.length;
        Object.assign(zone.node.style, {position: 'absolute', left: '0px', right: '0px',
          top: `${this.y(this.editor.padding + row * this.metrics.lineHeight)}px`, height: `${zone.height}px`});
      }
    }
    for (const widgets of this.editor.inlineWidgets.values()) {
      for (const widget of widgets) {
        if (!widget.node) continue;
        active.add(widget.node);
        this.editor.element.append(widget.node);
        const point = this.coordsAt(widget.offset ?? 0);
        Object.assign(widget.node.style, {position: 'absolute', left: `${point.left}px`,
          top: `${point.top + (widget.placement === 'above' ? -point.height : point.height)}px`});
      }
    }
    for (const node of this.zoneLayer.children) if (!active.has(node)) node.remove();
  }

  dispose() {
    if (this.frame) this.document.defaultView.cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.viewport.removeEventListener('pointerdown', this.pointerDown);
    this.viewport.removeEventListener('pointermove', this.pointerMove);
    for (const service of [this.lines, this.selections, this.margins, this.scroll, this.overview, this.guides, this.sticky, this.layout, this.metrics]) {
      service.dispose();
    }
    this.viewport.remove();
  }
}
