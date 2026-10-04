import {defaultEditorOptions, editorOptions} from '../options.js';
import {transformOffset} from '../selections.js';
import {resolveEditorConfig, saveTextEdits} from '../editorconfig.js';

/** View options and decorations are independently replaceable contributions, never model text. */
export class EditorPresentation {
  constructor(editor) { this.editor = editor; this.index = []; this.maximumEnds = []; this.indexRevision = -1; }

  updateOptions(overrides) {
    const {editor} = this;
    const anchor = editor.caretOffset;
    editor.options = editorOptions(overrides, editor.options);
    if (Object.hasOwn(overrides, 'endOfLine')) editor.endOfLineExplicit = true;
    editor.optionsRevision++;
    editor.largeFile.update();
    editor.view.layout.reset();
    editor.view.configure();
    editor.zoomControl.update();
    editor.bracketColors.update();
    editor.view.reveal(anchor);
    editor.sync();
  }
  setReadOnly(value) {
    this.editor.model.setReadOnly(value);
    this.syncReadOnly();
  }
  syncReadOnly() {
    const {editor} = this;
    const readOnly = !!editor.model.readOnly;
    if (readOnly) editor.inputController?.composition.cancel();
    editor.input.readOnly = readOnly;
    editor.input.setAttribute('aria-readonly', String(readOnly));
    editor.element.classList.toggle('sf-readonly', readOnly);
    editor.keymapAdapter?.setReadOnly(readOnly);
    editor.cursor();
  }
  refreshPreview() {
    const {editor} = this;
    if (editor.disposed) return;
    editor.highlightIndex.update(editor.model.snapshot());
    editor.view.layout.reset();
    editor.view.scroll.reset();
    editor.decorationRevision++;
    editor.view.render();
    editor.accessibility.update();
  }
  setDiagnostics(diagnostics) {
    const {editor} = this;
    editor.diagnostics = diagnostics.map(diagnostic => {
      const start = Math.max(0, Math.min(editor.model.length, diagnostic.start ?? editor.model.offsetAt(diagnostic.range.start)));
      const end = diagnostic.range ? editor.model.offsetAt(diagnostic.range.end) : start + (diagnostic.length ?? 0);
      const severity = typeof diagnostic.severity === 'number' ? ['error', 'warning', 'information', 'hint'][diagnostic.severity - 1]
        : diagnostic.severity ?? 'error';
      return {...diagnostic, start, length: Math.max(0, end - start), severity};
    });
    this.setDecorations('diagnostics', editor.diagnostics.map(diagnostic => ({
      start: diagnostic.start, end: diagnostic.start + Math.max(1, diagnostic.length ?? 1), kind: 'diagnostic',
      className: (diagnostic.severity ?? 'error') === 'error' ? 'sf-squiggle' : 'sf-squiggle sf-squiggle-warning',
      hover: `${diagnostic.code ?? ''} ${diagnostic.message ?? ''}`.trim()
    })));
    editor.insights?.setDiagnostics(editor.diagnostics, editor.model.version);
  }
  setDecorations(owner, decorations) {
    if (!Array.isArray(decorations)) throw new TypeError('Decorations must be an array');
    const normalized = decorations.map(decoration => ({...decoration,
      start: Math.max(0, decoration.start ?? 0), end: Math.min(this.editor.model.length, decoration.end ?? decoration.start ?? 0)}));
    this.editor.decorationOwners.set(owner, normalized.filter(decoration => decoration.end >= decoration.start));
    this.editor.decorationRevision++;
    this.editor.sync();
  }
  decorationsInRange(start, end) {
    const {editor} = this;
    if (this.indexRevision !== editor.decorationRevision) {
      this.index = [...editor.decorationOwners.values()].flat().sort((left, right) => left.start - right.start);
      let maximum = 0;
      this.maximumEnds = this.index.map(decoration => maximum = Math.max(maximum, decoration.end));
      this.indexRevision = editor.decorationRevision;
    }
    let low = 0;
    let high = this.index.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.maximumEnds[middle] <= start) low = middle + 1;
      else high = middle;
    }
    const result = [];
    for (let index = low; index < this.index.length && this.index[index].start < end; index++) {
      if (this.index[index].end > start) result.push(this.index[index]);
    }
    return result;
  }
  transformDecorations(change) {
    for (const [owner, decorations] of this.editor.decorationOwners) {
      this.editor.decorationOwners.set(owner, decorations.map(decoration => ({...decoration,
        start: transformOffset(decoration.start, change.changes, 'left'),
        end: transformOffset(decoration.end, change.changes, 'right')})));
    }
  }
  setViewZones(owner, zones) {
    for (const previous of this.editor.viewZones.get(owner) ?? []) if (!zones.some(zone => zone.node === previous.node)) previous.node?.remove();
    for (const zone of zones) {
      if (!Number.isInteger(zone.afterLine) || !Number.isFinite(zone.height) || zone.height < 0) throw new RangeError('Invalid view zone');
    }
    this.editor.viewZones.set(owner, zones);
    this.editor.view.layout.applyZones();
    this.editor.sync();
  }
  setInlineWidgets(owner, widgets) {
    for (const previous of this.editor.inlineWidgets.get(owner) ?? []) {
      if (!widgets.some(widget => widget.node === previous.node)) previous.node?.remove();
    }
    this.editor.inlineWidgets.set(owner, widgets);
    this.editor.sync();
  }
  setExecutionLocation(point, details = {}) {
    const {editor} = this;
    editor.executionPoint = point;
    editor.executionLine = point?.line ?? null;
    editor.executionDetails = details;
    if (point?.line) editor.folding.reveal(point.line - 1);
    this.setDecorations('execution', Number.isInteger(point?.start) ? [{start: point.start, end: point.end, className: 'sf-current-statement'}] : []);
    editor.sync();
  }
  applyEditorConfig(files, languageOptions = {}) {
    const {editor} = this;
    const configured = resolveEditorConfig(editor.uri, files, languageOptions);
    const baseline = {...defaultEditorOptions, endOfLine: editor.model.metadata.dominantEol, ...editor.optionDefaults};
    const reset = {};
    for (const name of ['insertSpaces', 'indentSize', 'tabSize', 'endOfLine', 'trimTrailingWhitespace', 'insertFinalNewline']) {
      reset[name] = baseline[name];
    }
    this.updateOptions({...reset, ...configured});
    editor.endOfLineExplicit = Object.hasOwn(configured, 'endOfLine') || Object.hasOwn(editor.optionDefaults ?? {}, 'endOfLine');
    return editor.options;
  }
  prepareSave() {
    const {editor} = this;
    const edits = saveTextEdits(editor.model, {...editor.options, normalizeLineEndings: editor.endOfLineExplicit});
    if (edits.length) editor.applyEdits(edits, {source: 'save-normalize', undoStop: true});
    return editor.model.snapshot();
  }
  markSaved() { this.editor.model.markSaved(); this.editor.changeTracking.markSaved(); this.editor.sync(); }
}
