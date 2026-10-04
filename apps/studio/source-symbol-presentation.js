const emptySymbols = Object.freeze([]);

function sameLabel(left, right) {
  return left.name === right.name && left.owner === right.owner && left.kind === right.kind;
}

/** Docking marks inactive roots and parking ancestors hidden. Reading those flags does not force layout. */
export function sourcePanelVisible(element) {
  if (!element?.isConnected) return false;
  for (let current = element; current; current = current.parentElement) {
    if (current.hidden) return false;
  }
  return true;
}

/** Keeps all active-file symbols current while reusing unchanged labels and deferring hidden Outline DOM. */
export class SourceSymbolPresentation {
  constructor({state, docking, breadcrumb, navigation, openSource}) {
    this.state = state;
    this.breadcrumb = breadcrumb;
    this.navigation = navigation;
    this.openSource = openSource;
    this.inputSymbols = null;
    this.symbols = emptySymbols;
    this.uri = undefined;
    this.breadcrumbUri = undefined;
    this.labelVersion = 0;
    this.navigationVersion = -1;
    this.outlineVersion = -1;
    this.options = [];
    this.rows = [];
    this.disposed = false;
    this.onNavigation = () => this.navigateOption();
    this.onOutline = event => this.navigateOutline(event);
    navigation.addEventListener('change', this.onNavigation);
    this.attachOutline(docking.content.get('outline'));
    this.unsubscribe = docking.layout.subscribe(() => this.update());
  }

  refreshSymbols() {
    const input = this.state.result?.symbols ?? emptySymbols;
    const uri = this.state.active ?? null;
    if (input === this.inputSymbols && uri === this.uri) return;
    const symbols = [];
    for (const symbol of input) {
      if (symbol.uri === uri && symbol.kind !== 'local' && !symbol.name.startsWith('<')) symbols.push(symbol);
    }
    const changed = uri !== this.uri || symbols.length !== this.symbols.length
      || symbols.some((symbol, index) => !sameLabel(symbol, this.symbols[index]));
    this.inputSymbols = input;
    this.symbols = symbols;
    this.uri = uri;
    if (changed) this.labelVersion++;
  }

  update() {
    if (this.disposed) return;
    this.refreshSymbols();
    this.renderBreadcrumb();
    this.renderOptions();
    this.renderOutline();
  }

  renderBreadcrumb() {
    if (this.breadcrumbUri === this.uri) return;
    if (!this.fileName) {
      const document = this.breadcrumb.ownerDocument;
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = 'C#';
      this.fileName = document.createElement('span');
      this.breadcrumb.replaceChildren(icon, this.fileName);
    }
    this.fileName.textContent = this.uri ?? '';
    this.breadcrumbUri = this.uri;
  }

  renderOptions() {
    if (this.navigationVersion === this.labelVersion) return;
    const document = this.navigation.ownerDocument;
    if (!this.prompt) {
      this.prompt = document.createElement('option');
      this.prompt.value = '';
      this.prompt.textContent = 'Navigate to symbol';
      this.navigation.replaceChildren(this.prompt);
    }
    for (let index = 0; index < this.symbols.length; index++) {
      const symbol = this.symbols[index];
      const label = (symbol.owner ? symbol.owner + '.' : '') + symbol.name + (symbol.kind === 'method' ? '(…)' : '');
      let option = this.options[index];
      if (!option) {
        option = document.createElement('option');
        // Positions change on ordinary edits. The stable slot resolves against the latest accepted symbol array.
        option.value = String(index);
        this.options.push(option);
        this.navigation.append(option);
      }
      if (option.textContent !== label) option.textContent = label;
    }
    while (this.options.length > this.symbols.length) this.options.pop().remove();
    this.navigation.value = '';
    this.navigationVersion = this.labelVersion;
  }

  attachOutline(element) {
    this.outline?.removeEventListener('click', this.onOutline);
    this.observer?.disconnect();
    this.outline = element;
    this.header = null;
    this.rows = [];
    this.outlineVersion = -1;
    if (!element) return;
    element.addEventListener('click', this.onOutline);
    const Observer = element.ownerDocument.defaultView?.ResizeObserver;
    this.observer = Observer ? new Observer(() => this.update()) : null;
    this.observer?.observe(element);
  }

  renderOutline(element = this.outline) {
    if (this.disposed) return true;
    if (element !== this.outline) this.attachOutline(element);
    this.refreshSymbols();
    if (this.outlineVersion === this.labelVersion || !sourcePanelVisible(element)) return true;
    const document = element.ownerDocument;
    if (!this.header) {
      this.header = document.createElement('div');
      this.header.className = 'panel-tools';
      element.replaceChildren(this.header);
    }
    const heading = this.uri ?? 'No source document';
    if (this.header.textContent !== heading) this.header.textContent = heading;
    for (let index = 0; index < this.symbols.length; index++) {
      const symbol = this.symbols[index];
      const row = this.rows[index] ?? this.createRow(document, index);
      const name = (symbol.owner ? symbol.owner + '.' : '') + symbol.name;
      if (row.kind.textContent !== symbol.kind) row.kind.textContent = symbol.kind;
      if (row.name.textContent !== name) row.name.textContent = name;
    }
    while (this.rows.length > this.symbols.length) this.rows.pop().button.remove();
    this.outlineVersion = this.labelVersion;
    return true;
  }

  createRow(document, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-row';
    button.dataset.outline = String(index);
    const kind = document.createElement('span');
    kind.className = 'symbol-kind';
    const name = document.createElement('span');
    button.append(kind, name);
    this.outline.append(button);
    const row = {button, kind, name};
    this.rows.push(row);
    return row;
  }

  navigateOption() {
    if (this.disposed || this.navigation.value === '') return;
    const index = Number(this.navigation.value);
    this.refreshSymbols();
    if (this.navigationVersion !== this.labelVersion) {
      this.update();
      return;
    }
    const symbol = Number.isInteger(index) ? this.symbols[index] : null;
    if (symbol) this.openSource(symbol.uri, symbol.start);
  }

  navigateOutline(event) {
    if (this.disposed) return;
    const button = event.target.closest('[data-outline]');
    if (!button || !this.outline.contains(button)) return;
    const index = Number(button.dataset.outline);
    this.refreshSymbols();
    if (this.outlineVersion !== this.labelVersion) {
      this.update();
      return;
    }
    const symbol = Number.isInteger(index) ? this.symbols[index] : null;
    if (symbol) this.openSource(symbol.uri, symbol.start, symbol.end);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.observer?.disconnect();
    this.navigation.removeEventListener('change', this.onNavigation);
    this.outline?.removeEventListener('click', this.onOutline);
    this.inputSymbols = null;
    this.symbols = emptySymbols;
    this.options = [];
    this.rows = [];
  }
}
