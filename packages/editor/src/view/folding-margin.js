export class FoldingMargin {
  constructor(view) { this.view = view; }

  render(row, cell) {
    const {editor, document} = this.view;
    const region = editor.folding.at(row.line);
    if (!region || !editor.folding.enabled) return;
    const button = document.createElement('button');
    button.className = 'sf-fold-toggle';
    button.type = 'button';
    button.textContent = region.collapsed ? '▸' : '▾';
    button.setAttribute('aria-expanded', String(!region.collapsed));
    button.setAttribute('aria-label', `${region.collapsed ? 'Expand' : 'Collapse'} lines ${region.startLine + 1} to ${region.endLine + 1}`);
    button.title = button.getAttribute('aria-label');
    button.onclick = () => editor.folding.toggle(row.line);
    if (region.collapsed && editor.breakpoints.some(item => item.line > row.line + 1 && item.line <= region.endLine + 1)) {
      button.classList.add('sf-fold-breakpoint');
      button.title += '; contains breakpoints';
    }
    cell.append(button);
  }

  appendHint(element, region) {
    const {editor, document} = this.view;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sf-fold-hint';
    button.dataset.decorationOnly = 'true';
    button.textContent = ' … ';
    button.title = this.hintText(region);
    button.setAttribute('aria-label', `Expand ${region.endLine - region.startLine} hidden lines`);
    button.onclick = () => editor.folding.toggle(region.startLine);
    element.append(button);
  }

  hintText(region) {
    const end = Math.min(region.endLine, region.startLine + 12);
    const lines = [];
    for (let line = region.startLine + 1; line <= end; line++) lines.push(this.view.editor.model.getLine(line).slice(0, 200));
    return lines.join('\n') + (end < region.endLine ? '\n…' : '');
  }
}
