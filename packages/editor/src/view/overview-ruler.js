/** Resolution-bounded overview: marks aggregate by pixel row even for millions of logical lines. */
export function overviewMarks(lineCount, height, marks) {
  if (!Number.isInteger(lineCount) || lineCount < 1 || !Number.isFinite(height) || height < 0) throw new RangeError('Invalid ruler geometry');
  const buckets = new Map();
  for (const mark of marks) {
    if (!Number.isFinite(mark.line) || mark.line < 0 || mark.line >= lineCount) continue;
    const y = Math.max(0, Math.min(Math.max(0, Math.ceil(height) - 1), Math.round(mark.line / Math.max(1, lineCount - 1) * (height - 1))));
    const key = `${y}:${mark.kind}`;
    if (!buckets.has(key)) buckets.set(key, {...mark, y});
  }
  return [...buckets.values()];
}

export class OverviewRuler {
  constructor(view) {
    this.view = view;
    this.canvas = view.document.createElement('canvas');
    this.canvas.className = 'sf-overview-ruler';
    this.canvas.setAttribute('aria-label', 'Document overview; click to navigate');
    view.editor.element.append(this.canvas);
    this.canvas.addEventListener('pointerdown', event => this.navigate(event));
    this.canvas.addEventListener('pointermove', event => this.preview(event));
  }

  marks() {
    const {editor} = this.view;
    const marks = editor.diagnostics.map(item => ({line: item.range?.start.line ?? editor.model.positionAt(item.start).line, kind: item.severity ?? 'error'}));
    for (const breakpoint of editor.breakpoints) marks.push({line: breakpoint.line - 1, kind: 'breakpoint'});
    for (const line of editor.bookmarks.lines) marks.push({line, kind: 'bookmark'});
    for (const line of editor.changeTracking.touched) {
      const kind = editor.changeTracking.stateAt(line);
      if (kind) marks.push({line, kind});
    }
    for (const decorations of editor.decorationOwners.values()) {
      for (const decoration of decorations) {
        if (decoration.kind === 'find' || decoration.className?.includes('find')) {
          marks.push({line: editor.model.positionAt(decoration.start).line, kind: 'find'});
        }
      }
    }
    marks.push({line: editor.model.positionAt(editor.offset).line, kind: 'caret'});
    return marks;
  }

  render() {
    const {editor} = this.view;
    this.canvas.hidden = !editor.options.overviewRuler;
    if (this.canvas.hidden) return;
    const map = !editor.largeFile.active ? editor.options.mapMode : 'off';
    const width = {off: 12, narrow: 40, medium: 70, wide: 110}[map];
    editor.element.style.setProperty('--sf-map-width', `${width}px`);
    const height = Math.max(1, this.view.viewport.clientHeight);
    this.canvas.width = width;
    this.canvas.height = Math.min(4096, height);
    this.canvas.style.width = `${width}px`;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (map !== 'off') this.paintMap(context, width, height);
    const colors = {error: '#ef7184', warning: '#e8cc75', breakpoint: '#ef7184', bookmark: '#61b6ef',
      unsaved: '#e8cc75', saved: '#65ae71', find: '#dfae48', caret: '#dedede'};
    for (const mark of overviewMarks(editor.model.lineCount, height, this.marks())) {
      context.fillStyle = colors[mark.kind] ?? '#aaa';
      context.fillRect(mark.kind === 'caret' ? 0 : Math.max(0, width - 7), mark.y, mark.kind === 'caret' ? width : 6, 2);
    }
  }

  paintMap(context, width, height) {
    const {model} = this.view.editor;
    context.fillStyle = '#8992a380';
    const count = Math.min(1200, height);
    for (let row = 0; row < count; row++) {
      const line = Math.min(model.lineCount - 1, Math.floor(row / count * model.lineCount));
      const text = model.getLine(line).slice(0, 200);
      const indent = text.length - text.trimStart().length;
      context.fillRect(Math.min(width - 8, indent), row / count * height, Math.min(width - 8, text.trim().length), 1);
    }
  }

  line(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
    return Math.round(ratio * (this.view.editor.model.lineCount - 1));
  }
  navigate(event) { this.view.editor.gotoLine(this.line(event) + 1); }
  preview(event) {
    const line = this.line(event);
    this.canvas.title = `${line + 1}: ${this.view.editor.model.getLine(line).slice(0, 240)}`;
  }
  dispose() { this.canvas.remove(); }
}
