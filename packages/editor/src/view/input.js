import {installTabEscape} from '../tab-focus.js';
import {CompositionController} from './composition.js';
import {dragTextEdits} from '../clipboard-ring.js';
import {copySelections, pasteSelections, SELECTION_CLIPBOARD_MIME} from '../commands/multi-clipboard.js';
import {modelForView} from './model-adapter.js';

/** Explicit element adapter. Native textarea storage is a bounded context; the public value is the buffer. */
export class HiddenInputController {
  constructor(editor) {
    this.editor = editor;
    this.document = editor.element.ownerDocument;
    this.element = this.document.createElement('textarea');
    this.element.className = 'sf-input';
    this.element.dataset.testid = 'code-editor';
    this.element.spellcheck = false;
    this.element.autocomplete = 'off';
    this.element.autocapitalize = 'off';
    this.element.wrap = 'off';
    this.element.setAttribute('aria-label', 'C# source editor');
    this.element.setAttribute('role', 'textbox');
    this.element.setAttribute('aria-multiline', 'true');
    editor.element.append(this.element);
    editor.input = this.element;
    const prototype = this.document.defaultView.HTMLTextAreaElement.prototype;
    this.nativeValue = Object.getOwnPropertyDescriptor(prototype, 'value');
    this.nativeStart = Object.getOwnPropertyDescriptor(prototype, 'selectionStart');
    this.nativeEnd = Object.getOwnPropertyDescriptor(prototype, 'selectionEnd');
    this.nativeSetRange = prototype.setSelectionRange;
    this.context = '';
    this.contextStart = 0;
    this.listeners = [];
    this.installAdapter();
    this.composition = new CompositionController(editor, this);
    this.disposeTabEscape = installTabEscape(this.element);
    this.listen('beforeinput', event => this.beforeInput(event));
    this.listen('input', event => this.input(event));
    this.listen('keydown', event => editor.keydown(event));
    this.listen('compositionstart', () => this.composition.start());
    this.listen('compositionupdate', event => this.composition.update(event.data));
    this.listen('compositionend', event => this.composition.end(event.data));
    this.listen('copy', event => this.copy(event, false));
    this.listen('cut', event => this.copy(event, true));
    this.listen('paste', event => this.paste(event));
    this.listen('focus', () => { editor.element.classList.add('sf-focused'); editor.cursor(); });
    this.listen('blur', () => editor.element.classList.remove('sf-focused'));
    this.listen('scroll', () => editor.sync());
    this.listen('keyup', () => editor.cursor());
    this.listen('select', () => this.nativeSelection());
    this.installDrag();
    this.synchronize();
  }

  listen(type, listener, target = this.element) {
    target.addEventListener(type, listener);
    this.listeners.push(() => target.removeEventListener(type, listener));
  }

  installAdapter() {
    const {editor, element} = this;
    const primary = () => editor.getSelections()[editor.primaryIndex ?? 0] ?? {anchor: 0, active: 0};
    Object.defineProperties(element, {
      value: {configurable: true, get: () => editor.model.getText(), set: value => editor.setValue(String(value))},
      selectionStart: {configurable: true, get: () => Math.min(primary().anchor, primary().active),
        set: value => element.setSelectionRange(value, element.selectionEnd)},
      selectionEnd: {configurable: true, get: () => Math.max(primary().anchor, primary().active),
        set: value => element.setSelectionRange(element.selectionStart, value)},
      selectionDirection: {configurable: true, get: () => primary().active < primary().anchor ? 'backward' : 'forward'},
      scrollTop: {configurable: true, get: () => editor.view?.scrollTop ?? 0, set: value => editor.view?.scrollTo({top: value})},
      scrollLeft: {configurable: true, get: () => editor.view?.viewport.scrollLeft ?? 0,
        set: value => { if (editor.view) editor.view.viewport.scrollLeft = value; }},
      setSelectionRange: {configurable: true, value: (start, end, direction = 'forward') => {
        start = Math.max(0, Math.min(editor.model.length, Number(start) || 0));
        end = Math.max(start, Math.min(editor.model.length, Number(end) || 0));
        editor.setSelections([{anchor: direction === 'backward' ? end : start, active: direction === 'backward' ? start : end}]);
      }},
      select: {configurable: true, value: () => editor.setSelections([{anchor: 0, active: editor.model.length}])},
      setRangeText: {configurable: true, value: (text, start = element.selectionStart, end = element.selectionEnd, mode = 'preserve') => {
        const caret = mode === 'start' ? start : start + String(text).length;
        editor.applyEdits([{start, end, text: String(text)}], {
          selections: mode === 'select' ? [{anchor: start, active: caret}] : [{anchor: caret, active: caret}], source: 'input-adapter'
        });
      }}
    });
  }

  beforeInput(event) {
    if (this.composition.active || event.isComposing) return;
    if (this.editor.notifyContributions('beforeinput', event)) return;
    if (this.editor.input.readOnly) { event.preventDefault(); return; }
    const actions = {
      insertText: () => this.editor.insertText(event.data ?? ''),
      insertReplacementText: () => this.editor.insertText(event.data ?? ''),
      insertLineBreak: () => this.editor.insertNewline(),
      insertParagraph: () => this.editor.insertNewline(),
      deleteContentBackward: () => this.editor.deleteText(-1),
      deleteContentForward: () => this.editor.deleteText(1),
      deleteWordBackward: () => this.editor.deleteText(-1, {word: true}),
      deleteWordForward: () => this.editor.deleteText(1, {word: true}),
      historyUndo: () => this.editor.undo(), historyRedo: () => this.editor.undo(true)
    };
    const action = actions[event.inputType];
    if (action && event.cancelable) { event.preventDefault(); action(); this.synchronize(); }
  }

  input(event) {
    if (this.composition.active || event.isComposing) return;
    const value = this.nativeValue.get.call(this.element);
    if (value === this.context) return;
    let start = 0;
    let beforeEnd = this.context.length;
    let afterEnd = value.length;
    while (start < beforeEnd && start < afterEnd && this.context[start] === value[start]) start++;
    while (beforeEnd > start && afterEnd > start && this.context[beforeEnd - 1] === value[afterEnd - 1]) { beforeEnd--; afterEnd--; }
    const caret = this.contextStart + this.nativeEnd.get.call(this.element);
    this.editor.applyEdits([{start: this.contextStart + start, end: this.contextStart + beforeEnd, text: value.slice(start, afterEnd)}], {
      selections: [{anchor: caret, active: caret}], source: 'native-input'
    });
    this.synchronize();
  }

  synchronize() {
    if (this.composition?.active || this.editor.disposed) return;
    const caret = this.editor.caretOffset;
    this.contextStart = Math.max(0, caret - 1024);
    const end = Math.min(this.editor.model.length, caret + 1024);
    this.context = this.editor.model.getText(this.contextStart, end);
    this.synchronizing = true;
    this.nativeValue.set.call(this.element, this.context);
    const start = Math.max(0, Math.min(this.context.length, this.element.selectionStart - this.contextStart));
    const finish = Math.max(start, Math.min(this.context.length, this.element.selectionEnd - this.contextStart));
    this.nativeSetRange.call(this.element, start, finish, this.element.selectionDirection);
    this.expectedSelection = {start, end: finish};
    this.synchronizing = false;
    if (this.editor.view) {
      const position = this.editor.view.coordsAt(caret);
      this.element.style.left = `${Math.max(0, position.left)}px`;
      this.element.style.top = `${Math.max(0, position.top)}px`;
      this.element.style.height = `${position.height}px`;
    }
  }

  nativeSelection() {
    if (this.synchronizing || this.composition.active || this.document.activeElement !== this.element) return;
    const start = this.contextStart + this.nativeStart.get.call(this.element);
    const end = this.contextStart + this.nativeEnd.get.call(this.element);
    if (start - this.contextStart === this.expectedSelection?.start && end - this.contextStart === this.expectedSelection?.end) return;
    if (start === this.element.selectionStart && end === this.element.selectionEnd) return;
    this.editor.setSelections([{anchor: start, active: end}]);
  }

  copy(event, cut) {
    const payload = copySelections(modelForView(this.editor), {eol: this.editor.options.endOfLine});
    const {text} = payload;
    if (!text || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData(SELECTION_CLIPBOARD_MIME, payload.metadata);
    this.editor.clipboardRing.push(text);
    if (!cut || this.element.readOnly) return;
    if (payload.kind !== 'line') return this.editor.insertText('', {source: 'cut', undoStop: true});
    const lines = new Set(this.editor.getSelections().map(selection => this.editor.model.positionAt(selection.active).line));
    const edits = [...lines].map(line => ({start: this.editor.model.getLineStart(line),
      end: line + 1 < this.editor.model.lineCount ? this.editor.model.getLineStart(line + 1) : this.editor.model.length, text: ''}));
    this.editor.applyEdits(edits, {source: 'cut-line', undoStop: true});
  }

  paste(event) {
    if (this.element.readOnly || !event.clipboardData) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    this.editor.clipboardRing.push(text);
    const model = modelForView(this.editor);
    const options = {source: 'paste', undoStop: true, tabSize: this.editor.options.tabSize};
    const metadata = event.clipboardData.getData(SELECTION_CLIPBOARD_MIME);
    try { pasteSelections(model, text, {...options, metadata}); }
    catch (error) {
      if (!metadata || !(error instanceof TypeError || error instanceof RangeError)) throw error;
      pasteSelections(model, text, options);
    }
  }

  installDrag() {
    const target = this.editor.view.viewport;
    target.draggable = true;
    this.listen('dragstart', event => {
      const start = this.element.selectionStart;
      const end = this.element.selectionEnd;
      if (start === end) { event.preventDefault(); return; }
      this.drag = {start, end, version: this.editor.model.version};
      this.editor.view.dragInProgress = true;
      event.dataTransfer.setData('text/plain', this.editor.model.getText(start, end));
      event.dataTransfer.effectAllowed = 'copyMove';
    }, target);
    this.listen('dragover', event => { if (!this.element.readOnly) event.preventDefault(); }, target);
    this.listen('drop', event => {
      if (this.element.readOnly) return;
      event.preventDefault();
      const offset = this.editor.view.positionAt(event.clientX, event.clientY);
      if (this.drag?.version === this.editor.model.version) {
        const result = dragTextEdits(this.editor.model, this.drag.start, this.drag.end, offset, event.ctrlKey || event.altKey);
        this.editor.applyEdits(result.edits, {...result, source: 'drag', undoStop: true});
      } else this.editor.insert(event.dataTransfer.getData('text/plain'), offset, offset);
      this.drag = null;
    }, target);
    this.listen('dragend', () => { this.drag = null; this.editor.view.dragInProgress = false; }, target);
  }

  dispose() {
    this.composition.dispose();
    this.disposeTabEscape();
    for (const dispose of this.listeners) dispose();
    this.element.remove();
  }
}
