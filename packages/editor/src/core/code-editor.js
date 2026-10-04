import {EditorModel} from '../model.js';
import {normalizeSelections, transformSelections} from '../selections.js';
import {NativeKeymapAdapter} from '../keymaps/native.js';
import {EDITOR_KEYMAPS} from '../keymaps.js';
import {SyntaxHighlightIndex} from '../highlight.js';
import {FoldingModel} from '../folding.js';
import {FoldingProvider} from '../folding-provider.js';
import {FoldingStateStore} from '../folding-state.js';
import {editorOptions} from '../options.js';
import {LargeFilePolicy} from '../large-file.js';
import {BookmarkModel} from '../bookmarks.js';
import {ChangeTracking} from '../change-tracking.js';
import {ClipboardRing} from '../clipboard-ring.js';
import {VirtualEditorView} from '../view/virtual-view.js';
import {HiddenInputController} from '../view/input.js';
import {BracketColors} from '../view/bracket-colors.js';
import {EditorZoom} from '../view/zoom.js';
import {EditorSplit} from '../view/split.js';
import {EditorAccessibility} from '../a11y/aria.js';
import {EditorEditing} from './editing.js';
import {EditorMovement} from './movement.js';
import {EditorPresentation} from './presentation.js';
import {EditorSelectionCommands} from './selection-commands.js';
import {GoToLineWidget} from '../view/goto.js';
import {editorCommandMap} from './command-map.js';
import {createEditorInsights} from '../features/index.js';

/** Embeddable virtual source editor. The EditorModel is authoritative; views own scroll and selection. */
export class CodeEditor {
  constructor(element, options = {}) {
    if (!element?.ownerDocument) throw new TypeError('CodeEditor requires a DOM element');
    this.element = element;
    this.optionDefaults = {...options.options};
    this.endOfLineExplicit = Object.hasOwn(this.optionDefaults, 'endOfLine');
    this.optionsRevision = 0;
    this.callbacks = options;
    this.onChange = options.onChange ?? null;
    this.onEdits = options.onEdits ?? null;
    this.onCursor = options.onCursor ?? (() => {});
    this.onBreakpoint = options.onBreakpoint ?? (() => {});
    this.onBreakpointEdit = options.onBreakpointEdit ?? (() => {});
    this.onKeymapState = options.onKeymapState ?? (() => {});
    this.request = options.request ?? (async () => null);
    this.services = options.services;
    this.session = options.session ?? {models: new Map(), views: new Set(), foldingState: new FoldingStateStore()};
    this.session.views.add(this);
    this.models = this.session.models;
    this.model = options.model ?? new EditorModel('', {uri: ''});
    this.options = editorOptions({endOfLine: this.model.metadata.dominantEol, ...this.optionDefaults});
    this.uri = this.model.uri;
    this.pendingFoldingRestore = !!this.uri;
    if (this.uri) this.models.set(this.uri, this.model);
    this.selections = this.model.selections.map(selection => ({...selection}));
    this.primaryIndex = this.model.primaryIndex;
    this.viewStates = new Map();
    this.padding = 14;
    this.disposed = false;
    this.composing = false;
    this.overtype = false;
    this.diagnostics = [];
    this.breakpoints = [];
    this.executionLine = null;
    this.selectedFrameLine = null;
    this.executionPoint = null;
    this.contributions = new Set();
    this.decorationOwners = new Map();
    this.viewZones = new Map();
    this.inlineWidgets = new Map();
    this.decorationRevision = 0;
    this.presentation = new EditorPresentation(this);
    this.folding = new FoldingModel();
    this.largeFile = new LargeFilePolicy(this);
    this.largeFile.update();
    this.highlightIndex = new SyntaxHighlightIndex(this.model.snapshot());
    this.bookmarks = new BookmarkModel(this.model);
    this.changeTracking = new ChangeTracking(this.model);
    this.clipboardRing = new ClipboardRing();
    element.classList.add('sf-editor');
    this.view = new VirtualEditorView(this);
    this.highlight = this.view.lines.layer;
    this.inputController = new HiddenInputController(this);
    this.accessibility = new EditorAccessibility(this);
    this.editing = new EditorEditing(this);
    this.movement = new EditorMovement(this);
    this.selectionCommands = new EditorSelectionCommands(this);
    this.goToWidget = new GoToLineWidget(this);
    this.bracketColors = new BracketColors(this);
    this.zoomControl = new EditorZoom(this);
    this.splitController = new EditorSplit(this);
    this.commands = editorCommandMap(this);
    this.foldingProvider = new FoldingProvider(this);
    this.foldSubscription = this.folding.onDidChange(() => {
      this.view.layout.applyFolding();
      this.decorationRevision++;
      this.view.schedule();
    });
    this.insights = createEditorInsights(this, {...this.options, ...options, services: options.services});
    this.registerContribution(this.insights);
    this.keymapAdapter = new NativeKeymapAdapter(this, {mode: options.keymap ?? 'visual-studio',
      onState: state => { this.modalMode = state.mode; this.onKeymapState(state); }, clipboard: options.clipboard});
    this.modelSubscription = this.model.onDidChange(change => this.modelChanged(change));
    this.readOnlySubscription = this.model.onDidChangeReadOnly(() => this.presentation.syncReadOnly());
    this.presentation.syncReadOnly();
    this.zoomControl.update();
    this.bracketColors.update();
    this.cursor();
    this.view.render();
    this.foldingProvider.refresh();
  }

  get value() { return this.model.getText(); }
  get offset() { const selection = this.selections[this.primaryIndex] ?? this.selections[0]; return Math.min(selection.anchor, selection.active); }
  get caretOffset() { return this.selections[this.primaryIndex]?.active ?? 0; }
  get buffer() { return this.model.buffer; }
  get readOnly() { return !!this.model.readOnly || !!this.input?.readOnly; }
  get history() { return {length: this.model.undoStack.depth}; }
  get future() { return {length: this.model.undoStack.redoDepth}; }
  get lexed() { return this.highlightIndex.lexed; }
  get pairs() { return this.bracketColors?.pairs.size ? this.bracketColors.pairs : this.highlightIndex.pairs; }
  get items() { return this.insights?.completionItems ?? []; }
  get completionIndex() { return this.insights?.completionIndex ?? 0; }
  get lineCount() { return this.model.lineCount; }
  sourceSnapshot() { return this.model.snapshot(); }
  snapshot() { return this.model.snapshot(); }
  getSelections() { return this.selections.map(selection => ({...selection})); }

  setSelections(selections, options = {}) {
    const normalized = normalizeSelections(selections.map(selection => ({...selection,
      anchor: selection.anchor ?? selection.start, active: selection.active ?? selection.head ?? selection.end})), this.model.length,
    options.primaryIndex ?? Math.min(this.primaryIndex, selections.length - 1));
    this.selections = normalized.selections;
    this.primaryIndex = normalized.primaryIndex;
    this.model.setSelections(this.selections, {primaryIndex: this.primaryIndex, notify: false});
    this.cursor();
  }

  setModel(uri, text) {
    this.inputController.composition.cancel();
    this.keymapAdapter.beforeModelChange?.();
    this.saveViewState();
    this.modelSubscription?.();
    this.readOnlySubscription?.();
    let model;
    if (text instanceof EditorModel) model = text;
    else {
      const saved = this.models.get(uri);
      model = saved instanceof EditorModel ? saved : new EditorModel(String(text ?? ''), {uri});
      if (saved && model.getText() !== text) model.setValue(String(text ?? ''), {source: 'setModel', undoStop: true});
    }
    this.model = model;
    this.uri = uri;
    if (!this.endOfLineExplicit) this.options.endOfLine = model.metadata.dominantEol;
    this.models.set(uri, model);
    const state = this.viewStates.get(uri);
    this.pendingFoldingRestore = !state;
    this.selections = state?.selections ?? model.selections.map(selection => ({...selection}));
    this.primaryIndex = state?.primaryIndex ?? 0;
    this.bookmarks = state?.bookmarks ?? new BookmarkModel(model);
    this.changeTracking = state?.changeTracking ?? new ChangeTracking(model);
    this.diagnostics = [];
    this.decorationOwners.clear();
    this.folding.setRanges(state?.folds ?? [], model.lineCount);
    this.highlightIndex.dispose();
    this.largeFile.update();
    this.highlightIndex = new SyntaxHighlightIndex(model.snapshot());
    this.view.layout.reset();
    this.view.scroll.reset();
    this.view.scroll.update([]);
    this.modelSubscription = model.onDidChange(change => this.modelChanged(change));
    this.readOnlySubscription = model.onDidChangeReadOnly(() => this.presentation.syncReadOnly());
    this.presentation.syncReadOnly();
    this.view.scrollTo({top: state?.top ?? 0, left: state?.left ?? 0});
    this.keymapAdapter.setModel();
    this.bracketColors.update();
    this.notifyContributions('changed', {source: 'setModel', changes: []});
    this.foldingProvider.refresh();
    this.cursor();
  }

  saveViewState() {
    if (!this.uri) return;
    this.session.foldingState.save(this.uri, this.folding);
    this.viewStates.set(this.uri, {selections: this.getSelections(), primaryIndex: this.primaryIndex,
      top: this.view.scrollTop, left: this.view.viewport.scrollLeft, folds: this.folding.regions.map(region => ({...region})),
      bookmarks: this.bookmarks, changeTracking: this.changeTracking});
    // A retiring view must not restore a model removed or replaced by its document owner.
  }

  setValue(text) {
    if (this.readOnly) return false;
    this.applying = true;
    try {
      this.model.setSelections(this.selections, {primaryIndex: this.primaryIndex, notify: false});
      return this.model.setValue(text, {source: 'setValue', command: 'setValue', undoStop: true});
    } finally { this.applying = false; }
  }

  applyEdits(edits, options = {}) {
    if (this.readOnly || !edits.length || this.disposed) return false;
    const normalized = edits.map(edit => ({start: edit.start, end: edit.end ?? edit.start + (edit.deleteCount ?? 0),
      text: edit.text ?? edit.newText ?? edit.insertText ?? ''}));
    const selections = options.selections?.map(selection => ({...selection, active: selection.active ?? selection.head ?? selection.end}));
    const event = {edits: normalized, options};
    this.notifyContributions('beforeEdit', event);
    const wasApplying = this.applying;
    this.applying = true;
    try {
      this.model.setSelections(this.selections, {primaryIndex: this.primaryIndex, notify: false});
      return this.model.applyEdits(normalized, {...options, command: options.command ?? options.source ?? 'edit', selections});
    } finally {
      this.applying = wasApplying;
      this.notifyContributions('afterEdit', event);
    }
  }

  modelChanged(change) {
    if (this.disposed) return;
    this.selections = this.applying ? this.model.selections.map(selection => ({...selection}))
      : transformSelections(this.selections, change.changes, change.after.length, this.primaryIndex).selections;
    this.primaryIndex = Math.min(this.primaryIndex, this.selections.length - 1);
    this.largeFile.update();
    this.highlightIndex.update(change.after, change);
    this.folding.applyChange(change);
    this.bookmarks.applyChange(change);
    this.changeTracking.applyChange(change);
    this.view.layout.invalidate(change);
    this.view.scroll.invalidate(change);
    this.presentation.transformDecorations(change);
    this.bracketColors.update();
    this.decorationRevision++;
    if (!this.callbacks.splitChild) this.onEdits?.(change);
    this.publishChange();
    this.notifyContributions('changed', change);
    this.foldingProvider.schedule();
    this.cursor();
  }

  publishChange() {
    if (!this.onChange || this.callbacks.splitChild) return;
    if (!this.largeFile.active) this.onChange(this.value);
    else {
      clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => { if (!this.disposed) this.onChange(this.value); }, 150);
    }
  }

  changed() { this.inputController.input({isComposing: false}); }
  record() { this.model.pushUndoStop(); }
  undo(redo = false) {
    if (this.readOnly) return false;
    this.applying = true;
    try {
      const result = this.model[redo ? 'redo' : 'undo']();
      this.setSelections(this.model.selections, {primaryIndex: this.model.primaryIndex});
      return result;
    } finally { this.applying = false; }
  }

  insert(text, start = this.input.selectionStart, end = this.input.selectionEnd, caret = null) {
    const active = caret ?? start + text.length;
    return this.applyEdits([{start, end, text}], {selections: [{anchor: active, active}], source: 'insert', undoStop: true});
  }
  insertText(text, options) { return this.editing.insertText(text, options); }
  insertNewline() { return this.editing.insertNewline(); }
  deleteText(direction, options) { return this.editing.deleteText(direction === 'backward' ? -1 : direction === 'forward' ? 1 : direction, options); }
  indent(unindent = false) { return this.editing.tab(unindent); }
  outdent() { return this.editing.tab(true); }
  toggleLineComment(force = null) { return this.editing.toggleLineComment(force); }
  moveLines(direction) { return this.editing.moveLines(direction); }
  moveCursor(direction, options) { return this.movement.move(direction, options); }
  updateOptions(options) { return this.presentation.updateOptions(options); }
  setOptions(options) { return this.updateOptions(options); }
  refreshPreview() { return this.presentation.refreshPreview(); }
  setReadOnly(value) { return this.presentation.setReadOnly(value); }
  setDiagnostics(items) { return this.presentation.setDiagnostics(items); }
  setDecorations(owner, items) { return this.presentation.setDecorations(owner, items); }
  decorationsInRange(start, end) { return this.presentation.decorationsInRange(start, end); }
  setViewZones(owner, items) { return this.presentation.setViewZones(owner, items); }
  setInlineWidgets(owner, items) { return this.presentation.setInlineWidgets(owner, items); }
  setExecutionLocation(point, details) { return this.presentation.setExecutionLocation(point, details); }
  setExecutionLine(line) { this.setExecutionLocation(line ? {line} : null); }
  setSelectedFrameLine(line) { this.selectedFrameLine = line; if (line) this.folding.reveal(line - 1); this.sync(); }
  setBreakpoints(items) { this.breakpoints = items; this.sync(); }
  applyEditorConfig(files, languages) { return this.presentation.applyEditorConfig(files, languages); }
  prepareSave() { return this.presentation.prepareSave(); }
  markSaved() { this.presentation.markSaved(); }
  loadFile(blob, options) { return this.largeFile.load(blob, options); }
  setZoom(zoom) {
    zoom = Math.max(20, Math.min(400, Math.round(zoom)));
    if (this.options.zoomScope === 'global') {
      for (const view of this.session.views) view.updateOptions({zoom});
    } else this.updateOptions({zoom});
  }
  toggleBookmark(line = this.model.positionAt(this.offset).line) { this.bookmarks.toggle(line); this.sync(); }
  nextBookmark(direction = 1) {
    const line = this.bookmarks.next(this.model.positionAt(this.offset).line, direction);
    if (line !== null) this.gotoLine(line + 1);
  }
  revertHunk(line) { const edit = this.changeTracking.hunk(line); if (edit) this.applyEdits([edit], {source: 'revert', undoStop: true}); }
  toggleSplit() { return this.splitController.toggle(); }
  setBoxSelection(anchor, active) { this.selectionCommands.setBox(anchor, active); }
  extendBox(options) { this.selectionCommands.extendBox(options); }
  addVerticalCaret(direction) { this.selectionCommands.addVerticalCaret(direction); }
  splitSelectionIntoLines() { this.selectionCommands.splitLines(); }
  goToMatchingBrace(extend = false) { this.selectionCommands.matchingBrace(extend); }
  selectCurrentLine() { this.selectionCommands.currentLine(); }
  openGoTo() { this.goToWidget.open(); }
  findSelected(direction = 1) { return this.insights.findSelected(direction); }
  lexicalContext(offset) {
    const kind = this.highlightIndex.kindAt(Math.max(0, offset - 1));
    return kind === 'comment' ? 'comment' : kind === 'string' ? 'literal' : this.highlightIndex.lexed ? 'code' : 'unknown';
  }
  async expandSelection() {
    const model = this.model;
    const version = this.model.version;
    const start = this.offset;
    const end = this.input.selectionEnd;
    const parameters = {uri: this.uri, version, offsets: [start]};
    const ranges = this.services?.supports('selectionRanges') ? await this.services.invoke('selectionRanges', parameters)
      : await this.request('selectionRanges', parameters);
    let range = ranges?.[0];
    if (model !== this.model || version !== model.version || this.disposed || start !== this.offset || end !== this.input.selectionEnd) return;
    while (range) {
      const from = this.model.offsetAt(range.range.start);
      const to = this.model.offsetAt(range.range.end);
      if (from <= start && to >= end && (from < start || to > end)) {
        (this.selectionHistory ??= []).push({start, end});
        this.goto(from, to);
        return;
      }
      range = range.parent;
    }
  }
  shrinkSelection() { const item = this.selectionHistory?.pop(); if (item) this.goto(item.start, item.end); }

  keydown(event) {
    if (event.isComposing || this.composing || event.keyCode === 229 || this.disposed) return;
    if (this.notifyContributions('keydown', event)) { event.preventDefault(); return; }
    this.keymapAdapter.handle(event);
  }
  setKeymap(mode) {
    if (!EDITOR_KEYMAPS.some(item => item.id === mode)) throw new Error('Unknown editor keymap');
    this.keymapAdapter.setMode(mode);
  }
  focus() { this.input.focus({preventScroll: true}); }
  goto(offset, end = offset) { this.setSelections([{anchor: offset, active: end}]); this.view.reveal(offset, {center: true}); this.focus(); }
  gotoLine(line, column = 1) { this.goto(this.model.offsetAt({line: line - 1, character: column - 1})); }
  sync() { this.view.schedule(); }
  paint() { this.decorationRevision++; this.view.schedule(); }
  paintViewport() { this.view.render(); }
  markBrackets() { this.bracketColors.render(); }
  cursor() {
    if (this.disposed) return;
    const position = this.model.positionAt(this.caretOffset);
    this.onCursor({...position, offset: this.offset, selected: this.input ? this.input.selectionEnd - this.offset : 0,
      carets: this.selections.length, overtype: this.overtype});
    this.accessibility?.update();
    this.inputController?.synchronize();
    this.notifyContributions('cursor');
    this.view?.schedule();
  }

  registerContribution(contribution) { this.contributions.add(contribution); return () => this.contributions.delete(contribution); }
  notifyContributions(event, argument) {
    for (const contribution of this.contributions) if (contribution[event]?.(argument) === true) return true;
    return false;
  }
  runCommand(id, args) {
    const command = this.commands.get(id);
    if (command) return command(args);
    throw new Error(`Editor view does not implement '${id}'`);
  }
  reportError(code, error) { this.accessibility?.announce(`${code}: ${error.message}`); this.callbacks.onError?.({code, error}); }
  complete(trigger) { return this.insights.complete(trigger); }
  closeCompletion() { this.insights?.closeCompletion(); }
  acceptCompletion() { return this.insights.acceptCompletion(); }
  paintCompletion() { return this.insights.paintCompletion(); }
  openFind(replace = false) { return this.insights.openFind(replace); }
  findNext(reset = false, direction = 1) { return this.insights.findNext(reset, direction); }
  replaceCurrent(all = false) { return this.insights.replaceCurrent(all); }
  hover(event) {
    clearTimeout(this.hoverTimer);
    if (this.largeFile.active) return;
    const offset = this.view.positionAt(event.clientX, event.clientY);
    this.hoverTimer = setTimeout(() => this.insights.quickInfo(offset), 450);
  }

  dispose() {
    if (this.disposed) return;
    this.saveViewState();
    this.disposed = true;
    for (const timer of [this.hoverTimer, this.changeTimer]) clearTimeout(timer);
    this.modelSubscription?.();
    this.readOnlySubscription?.();
    this.foldSubscription?.();
    this.splitController.dispose();
    for (const contribution of this.contributions) contribution.dispose?.();
    this.contributions.clear();
    for (const service of [this.keymapAdapter, this.foldingProvider, this.folding, this.largeFile, this.bracketColors,
      this.inputController, this.accessibility, this.zoomControl, this.goToWidget, this.view, this.highlightIndex]) service.dispose();
    this.session.views.delete(this);
    this.element.replaceChildren();
  }
}
