/** Guides consume validated outlining ranges and use the shared font/tab measurement. */
export class StructureGuides {
  constructor(view) {
    this.view = view;
    this.layer = view.document.createElement('div');
    this.layer.className = 'sf-structure-guides';
    this.layer.setAttribute('aria-hidden', 'true');
    view.surface.append(this.layer);
  }
  render(rows) {
    const {editor, metrics} = this.view;
    const fragment = this.view.document.createDocumentFragment();
    const first = rows[0]?.line ?? 0;
    const last = rows.at(-1)?.line ?? first;
    if (editor.options.structureGuides) {
      for (const region of editor.folding.regions) {
        if (region.endLine < first || region.startLine > last || editor.folding.hidden(region.startLine)) continue;
        const text = editor.model.getLine(region.startLine);
        const indent = text.match(/^\s*/)?.[0] ?? '';
        const x = metrics.line(indent).width + editor.padding;
        const topLine = Math.max(first, region.startLine);
        const bottomLine = Math.min(last, region.endLine);
        const leading = this.view.layout.leadingRows;
        const top = editor.padding + (leading + this.view.layout.map.rowAt(topLine)) * metrics.lineHeight;
        const bottom = editor.padding + (leading + this.view.layout.map.rowAt(bottomLine + 1)) * metrics.lineHeight;
        const node = this.view.document.createElement('div');
        node.className = 'sf-structure-guide';
        node.style.left = `${x}px`;
        node.style.top = `${this.view.y(top)}px`;
        node.style.height = `${bottom - top}px`;
        node.title = editor.folding.containing(region.startLine).map(item => editor.model.getLine(item.startLine).trim()).join('\n');
        fragment.append(node);
      }
    }
    for (const column of editor.options.columnGuides) {
      const node = this.view.document.createElement('div');
      node.className = 'sf-column-guide';
      node.style.left = `${editor.padding + column * metrics.charWidth}px`;
      node.style.top = `${this.view.viewport.scrollTop}px`;
      node.style.height = `${this.view.viewport.clientHeight}px`;
      fragment.append(node);
    }
    this.layer.replaceChildren(fragment);
  }
  dispose() { this.layer.remove(); }
}
