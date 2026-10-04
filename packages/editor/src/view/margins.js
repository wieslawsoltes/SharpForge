/** Pluggable virtual margins. Providers render only logical lines visible in the current frame. */
export class MarginLayer {
  constructor(view) {
    this.view = view;
    this.providers = new Map();
    this.layer = view.document.createElement('div');
    this.layer.className = 'sf-gutter';
    this.layer.setAttribute('aria-label', 'Editor margins');
    view.editor.element.append(this.layer);
    this.register('line', (row, cell) => this.lineNumber(row, cell));
    this.register('folding', (row, cell) => view.foldingMargin.render(row, cell));
    this.register('change', (row, cell) => this.change(row, cell));
  }

  register(id, render) { this.providers.set(id, render); return () => this.providers.delete(id); }

  render(rows) {
    const fragment = this.view.document.createDocumentFragment();
    const editor = this.view.editor;
    for (const row of rows) {
      if (row.continuation) continue;
      const element = this.view.document.createElement('div');
      element.className = 'sf-margin-row';
      element.dataset.line = String(row.line + 1);
      element.style.top = `${row.top - this.view.scrollTop}px`;
      element.style.height = `${this.view.metrics.lineHeight}px`;
      for (const [id, provider] of this.providers) {
        const cell = this.view.document.createElement('div');
        cell.className = `sf-margin-cell sf-margin-${id}`;
        provider(row, cell);
        element.append(cell);
      }
      fragment.append(element);
    }
    this.layer.replaceChildren(fragment);
    editor.gutter = this.layer;
  }

  lineNumber(row, cell) {
    const editor = this.view.editor;
    const line = row.line + 1;
    const breakpoint = editor.breakpoints.find(item => item.line === line);
    const button = this.view.document.createElement('button');
    button.type = 'button';
    button.className = 'sf-line';
    button.dataset.line = String(line);
    button.textContent = String(line);
    button.setAttribute('aria-label', `${breakpoint ? 'Remove' : 'Set'} breakpoint at line ${line}`);
    button.classList.toggle('breakpoint', !!breakpoint);
    button.classList.toggle('pending', breakpoint?.verified === false);
    button.classList.toggle('disabled-breakpoint', breakpoint?.enabled === false || !!breakpoint?.muted);
    button.classList.toggle('execution', editor.executionLine === line);
    button.classList.toggle('selected-frame', editor.selectedFrameLine === line);
    button.classList.toggle('current', editor.model.positionAt(editor.offset).line + 1 === line);
    const bookmark = editor.bookmarks.has(row.line);
    button.classList.toggle('bookmark', bookmark);
    button.title = `${bookmark ? 'Bookmark. ' : ''}${breakpoint?.message ?? button.getAttribute('aria-label')}`;
    const glyph = this.view.document.createElement('i');
    button.prepend(glyph);
    button.addEventListener('click', event => {
      if (event.altKey) editor.toggleBookmark(row.line);
      else editor.onBreakpoint(line);
    });
    button.addEventListener('contextmenu', event => { event.preventDefault(); editor.onBreakpointEdit(line, event); });
    cell.append(button);
  }

  change(row, cell) {
    const change = this.view.editor.changeTracking.stateAt(row.line);
    if (!change) return;
    const button = this.view.document.createElement('button');
    button.className = `sf-change-mark sf-change-${change}`;
    button.type = 'button';
    button.setAttribute('aria-label', `${change} change on line ${row.line + 1}; revert change`);
    button.title = button.getAttribute('aria-label');
    button.onclick = () => this.view.editor.revertHunk(row.line);
    cell.append(button);
  }

  dispose() { this.providers.clear(); this.layer.remove(); }
}
