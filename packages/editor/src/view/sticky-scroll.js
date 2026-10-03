export function stickyHeaders(regions, firstLine, {maximum = 3, caretLine = -1} = {}) {
  if (maximum <= 0) return [];
  return regions.filter(region => region.startLine < firstLine && region.endLine >= firstLine && region.startLine !== caretLine)
    .sort((left, right) => left.startLine - right.startLine).slice(-maximum);
}

export class StickyScroll {
  constructor(view) {
    this.view = view;
    this.layer = view.document.createElement('div');
    this.layer.className = 'sf-sticky-scroll';
    this.layer.setAttribute('aria-label', 'Enclosing source scopes');
    view.editor.element.append(this.layer);
  }
  render(rows) {
    const {editor} = this.view;
    if (!editor.options.stickyScroll || editor.largeFile.active) { this.layer.replaceChildren(); return; }
    const first = rows.find(row => row.top >= this.view.scrollTop)?.line ?? rows[0]?.line ?? 0;
    const caret = editor.model.positionAt(editor.offset).line;
    const caretY = editor.view.coordsAt(editor.offset).top;
    const available = Math.max(0, Math.floor(caretY / this.view.metrics.lineHeight));
    const maximum = caretY >= 0 && caretY < this.view.viewport.clientHeight
      ? Math.min(editor.options.stickyScrollMaxLines, available) : editor.options.stickyScrollMaxLines;
    const headers = stickyHeaders(editor.folding.regions, first, {maximum, caretLine: caret});
    const fragment = this.view.document.createDocumentFragment();
    for (const header of headers) {
      const button = this.view.document.createElement('button');
      button.type = 'button';
      button.textContent = editor.model.getLine(header.startLine).trim();
      button.title = `Go to line ${header.startLine + 1}`;
      button.onclick = () => editor.gotoLine(header.startLine + 1);
      fragment.append(button);
    }
    this.layer.replaceChildren(fragment);
  }
  dispose() { this.layer.remove(); }
}
