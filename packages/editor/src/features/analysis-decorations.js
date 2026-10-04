import {serviceItems} from '../services/providers.js';
import {diagnosticDecorations, semanticDecorations} from '../services/decorations.js';
import {node, button, contentsText, EditorPopup} from '../widgets/dom.js';

export class AnalysisDecorations {
  constructor(context) {
    this.context = context;
    this.hints = [];
    this.lenses = [];
    this.references = [];
    this.hintsVisible = context.options.inlayHints !== false;
    this.lensNodes = new Map();
    this.lensZones = new Map();
    this.lensLayout = '';
    this.lensMenu = new EditorPopup(context, 'code-lens-menu');
    this.unsubscribe = context.services.subscribe?.(({method, uri}) => {
      if (uri && uri !== context.editor.uri) return;
      if (method === 'codeLens') context.safe(() => this.refresh(['codeLens']));
      if (method === 'inlayHints') context.safe(() => this.refresh(['inlayHints']));
    });
    context.lifetime.listen(context.editor.element, 'pointermove', event => this.pointer(event));
    context.lifetime.listen(context.editor.element, 'click', event => {
      if (!(event.ctrlKey || event.metaKey) || !Number.isInteger(this.linkOffset)) return;
      event.preventDefault();
      context.safe(() => this.definition(this.linkOffset));
    });
    context.lifetime.listen(context.document, 'keyup', event => {
      if (!this.hintsHeld || !['Alt', 'F1'].includes(event.key)) return;
      this.hintsHeld = false;
      this.renderHints();
    });
  }

  async refresh(methods = ['diagnostics', 'semanticTokens', 'inlayHints', 'codeLens']) {
    await Promise.all(methods.filter(method => this.context.services.supports(method)).map(async method => {
      const result = await this.context.request(method, {});
      if (!result) return;
      const items = serviceItems(result.value);
      if (method === 'diagnostics') this.setDiagnostics(items, result.revision.version);
      if (method === 'semanticTokens') this.context.editor.setDecorations?.('semantic',
        semanticDecorations(items, this.context.editor.sourceSnapshot(), result.revision.version));
      if (method === 'inlayHints') { this.hints = items; this.renderHints(); }
      if (method === 'codeLens') { this.lenses = items.slice(0, 5000).map(lens => ({...lens})); this.renderLenses(); }
    }));
  }

  setDiagnostics(items, version = this.context.editor.sourceSnapshot().version) {
    const source = this.context.editor.sourceSnapshot();
    if (version !== source.version) return false;
    this.diagnostics = diagnosticDecorations(items, source, {inlineMessages: this.context.options.inlineDiagnosticMessages});
    this.context.editor.diagnostics = this.diagnostics.map(item => ({...item.diagnostic, start: item.start, end: item.end}));
    this.context.editor.setDecorations?.('diagnostics', this.diagnostics);
    return true;
  }

  async highlights() {
    const editor = this.context.editor;
    const method = this.context.services.supports('documentHighlights') ? 'documentHighlights' :
      this.context.services.supports('references') ? 'references' : null;
    if (!method) return;
    const offset = editor.offset;
    const result = await this.context.request(method, {offset}, {key: 'document-highlights'});
    if (!result || offset !== editor.offset) return;
    const source = editor.sourceSnapshot();
    this.references = serviceItems(result.value).filter(item => !item.uri || item.uri === editor.uri).map(item => ({...item,
      start: item.start ?? source.offsetAt(item.range.start), end: item.end ?? source.offsetAt(item.range.end)
    })).sort((left, right) => left.start - right.start);
    editor.setDecorations?.('references', this.references.map(item => ({...item,
      className: item.kind === 3 || item.kind === 'write' ? 'sf-reference-write' : 'sf-reference-read'})));
  }

  nextReference(direction) {
    const offset = this.context.editor.offset;
    const candidates = this.references.filter(item => direction > 0 ? item.start > offset : item.start < offset);
    const target = (direction > 0 ? candidates[0] : candidates.at(-1)) ??
      (direction > 0 ? this.references[0] : this.references.at(-1));
    if (target) this.context.editor.goto(target.start, target.end);
  }

  nextDiagnostic(direction = 1) {
    const items = this.diagnostics ?? [];
    const offset = this.context.editor.offset;
    const sorted = [...items].sort((left, right) => left.start - right.start);
    const next = direction > 0 ? sorted.find(item => item.start > offset) ?? sorted[0] :
      sorted.filter(item => item.start < offset).at(-1) ?? sorted.at(-1);
    if (next) {
      this.context.editor.goto(next.start, next.end);
      this.context.status(next.hover);
    }
  }

  renderHints() {
    const editor = this.context.editor;
    if (!(this.hintsHeld ? !this.hintsVisible : this.hintsVisible)) return editor.setInlineWidgets?.('inlay-hints', []);
    const source = editor.sourceSnapshot();
    const widgets = this.hints.slice(0, 5000).map(hint => {
      const offset = hint.offset ?? hint.start ?? source.offsetAt(hint.position);
      const label = Array.isArray(hint.label) ? hint.label.map(part => part.value).join('') : String(hint.label ?? '');
      const element = node(this.context.document, 'span', {className: 'sf-inlay-hint', contenteditable: false,
        title: contentsText(hint.tooltip), 'aria-label': label}, label);
      if (hint.paddingLeft) element.style.marginLeft = '0.35em';
      if (hint.paddingRight) element.style.marginRight = '0.35em';
      return {offset, node: element, placement: 'inline'};
    });
    editor.setInlineWidgets?.('inlay-hints', widgets);
  }

  renderLenses() {
    const editor = this.context.editor;
    const source = editor.sourceSnapshot();
    const groups = new Map();
    for (const [index, lens] of this.lenses.entries()) {
      const offset = lens.start ?? source.offsetAt(lens.range.start);
      const line = source.positionAt(offset).line;
      if (!groups.has(line)) groups.set(line, []);
      groups.get(line).push({lens, index, offset});
    }
    const zones = [];
    const nextZones = new Map();
    this.lensNodes.clear();
    for (const [line, entries] of groups) {
      const element = this.lensZones.get(line) ?? node(this.context.document, 'div', {className: 'sf-code-lenses'});
      element.replaceChildren();
      nextZones.set(line, element);
      for (const {lens, index, offset} of entries) {
        const label = lens.command?.title ?? lens.title ?? (lens.count !== undefined ? `${lens.count} references` : '…');
        const control = button(this.context.document, label, () => this.context.safe(() => this.activateLens(lens, offset)));
        control.disabled = !lens.command && lens.count === undefined;
        element.append(control);
        this.lensNodes.set(index, {control, offset, lens});
      }
      zones.push({afterLine: line - 1, height: 19, node: element});
    }
    const layout = zones.map(zone => zone.afterLine).join(',');
    if (layout !== this.lensLayout || !this.lensZones.size) editor.setViewZones?.('code-lens', zones);
    this.lensLayout = layout;
    this.lensZones = nextZones;
    this.resolveVisibleLenses();
  }

  resolveVisibleLenses() {
    if (!this.context.services.supports('resolveCodeLens')) return;
    const height = this.context.editor.element.clientHeight || 600;
    for (const [index, entry] of this.lensNodes) {
      const coordinates = this.context.editor.view?.coordsAt?.(entry.offset);
      if (coordinates && (coordinates.top < -40 || coordinates.top > height + 40)) continue;
      if (entry.lens.command || entry.lens.count !== undefined || entry.lens.resolving) continue;
      entry.lens.resolving = true;
      this.context.safe(async () => {
        const result = await this.context.request('resolveCodeLens', {lens: entry.lens}, {key: `code-lens-${index}`});
        if (!result || this.lensNodes.get(index) !== entry) return;
        Object.assign(entry.lens, result.value);
        entry.control.textContent = entry.lens.command?.title ?? entry.lens.title ?? 'No action available';
        entry.control.disabled = !entry.lens.command;
      });
    }
  }

  activateLens(lens, offset) {
    if (lens.command) return this.context.command(lens.command);
    if (lens.count === undefined) return false;
    return this.context.editor.request('references', {uri: this.context.editor.uri, offset});
  }

  showCodeLensMenu() {
    this.lensMenu.element.replaceChildren(node(this.context.document, 'strong', {}, 'CodeLens actions'));
    for (const entry of this.lensNodes.values()) {
      if (entry.control.disabled) continue;
      this.lensMenu.element.append(button(this.context.document, entry.control.textContent, () => {
        this.lensMenu.close();
        this.context.safe(() => this.activateLens(entry.lens, entry.offset));
      }));
    }
    if (!this.lensMenu.element.querySelector('button')) {
      this.lensMenu.element.append(node(this.context.document, 'p', {}, 'No resolved CodeLens actions are available.'));
    }
    this.lensMenu.show();
    this.lensMenu.element.querySelector('button')?.focus();
  }

  pointer(event) {
    if (!(event.ctrlKey || event.metaKey)) {
      this.linkOffset = null;
      this.context.editor.setDecorations?.('definition-link', []);
      return;
    }
    const editor = this.context.editor;
    const offset = editor.view?.positionAt?.(event.clientX, event.clientY);
    if (!Number.isInteger(offset)) return;
    const tokens = editor.lexed?.tokens;
    let low = 0;
    let high = tokens?.length ?? 0;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const candidate = tokens.get?.(middle) ?? tokens[middle];
      if (candidate.end < offset) low = middle + 1;
      else high = middle;
    }
    const candidate = low < (tokens?.length ?? 0) ? tokens.get?.(low) ?? tokens[low] : null;
    const token = candidate?.kind === 'identifier' && candidate.start <= offset && candidate.end >= offset ? candidate : null;
    this.linkOffset = token ? offset : null;
    editor.setDecorations?.('definition-link', token ? [{start: token.start, end: token.end, className: 'sf-definition-link'}] : []);
  }

  async definition(offset) {
    if (!this.context.services.supports('definition')) return this.context.editor.request('definition', {uri: this.context.editor.uri, offset});
    const result = await this.context.request('definition', {offset});
    const location = Array.isArray(result?.value) ? result.value[0] : result?.value;
    if (location) this.context.navigate(location);
  }

  keydown(event) {
    if (event.altKey && event.key === 'F1') {
      this.hintsHeld = true;
      this.renderHints();
      return true;
    }
    if (event.altKey && /^[1-9]$/.test(event.key)) {
      const visible = [...this.lensNodes.values()].filter(entry => {
        if (entry.control.disabled) return false;
        const top = this.context.editor.view?.coordsAt?.(entry.offset)?.top ?? 0;
        return top >= 0 && top < (this.context.editor.element.clientHeight || 600);
      });
      const entry = visible[Number(event.key) - 1];
      if (entry) this.context.safe(() => this.activateLens(entry.lens, entry.offset));
      return Boolean(entry);
    }
    return false;
  }

  changed() {
    this.lensMenu.close();
    this.references = [];
    this.hints = [];
    this.lenses = [];
    this.context.editor.diagnostics = [];
    this.lensNodes.clear();
    this.lensZones.clear();
    this.lensLayout = '';
    for (const owner of ['references', 'semantic', 'diagnostics', 'definition-link']) this.context.editor.setDecorations?.(owner, []);
    this.context.editor.setInlineWidgets?.('inlay-hints', []);
    this.context.editor.setViewZones?.('code-lens', []);
  }

  dispose() { this.unsubscribe?.(); this.changed(); this.lensMenu.dispose(); }
}
