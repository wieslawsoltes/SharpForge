import assert from 'node:assert/strict';
import {CodeEditor, HiddenInputController} from '@sharpforge/editor';

class InputElement {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag;
    this.listeners = new Map();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = {add() {}, remove() {}};
    this.scrollLeft = 0;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(child) { this.children.push(child); child.parent = this; }
  replaceChildren() { this.children.length = 0; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() {
    this.ownerDocument.activeElement = this;
    for (const listener of this.listeners.get('focus') ?? []) listener({type: 'focus', target: this});
  }
}

class TextArea extends InputElement {
  get value() { return this.nativeText ?? ''; }
  set value(value) { this.nativeText = String(value); }
  get selectionStart() { return this.nativeStart ?? 0; }
  set selectionStart(value) { this.nativeStart = value; }
  get selectionEnd() { return this.nativeEnd ?? 0; }
  set selectionEnd(value) { this.nativeEnd = value; }
  setSelectionRange(start, end) { this.nativeStart = start; this.nativeEnd = end; }
}

export function inputDocument() {
  const document = {defaultView: {HTMLTextAreaElement: TextArea}};
  document.createElement = tag => tag === 'textarea' ? new TextArea(document, tag) : new InputElement(document, tag);
  return document;
}

/** Presentation is inert; model binding, edit/undo, input adapters, focus handlers and cursor publication are production methods. */
export function inputView(model, selections, onEdit = () => {}) {
  const document = inputDocument();
  const noop = () => {};
  const service = extra => ({dispose: noop, ...extra});
  const editor = Object.create(CodeEditor.prototype);
  const element = document.createElement('div');
  const viewport = document.createElement('div');
  Object.assign(editor, {
    model, uri: '', selections: [{anchor: 0, active: 0}], primaryIndex: 0, element,
    models: new Map(), viewStates: new Map(), session: {views: new Set([editor]), foldingState: {save: noop}},
    options: {}, optionsRevision: 0, callbacks: {}, contributions: new Set(), decorationOwners: new Map(), decorationRevision: 0,
    onCursor: noop, onEdits: onEdit, inputController: {composition: {cancel: noop}, synchronize: noop},
    largeFile: service({update: noop}), highlightIndex: service(), folding: service({setRanges: noop, applyChange: noop, regions: []}),
    view: service({viewport, scrollTop: 0, layout: {reset: noop, invalidate: noop},
      scroll: {reset: noop, update: noop, invalidate: noop}, scrollTo: noop, schedule: noop,
      coordsAt(offset) { assert.ok(offset >= 0 && offset <= editor.model.length); return {top: 0, left: 0, height: 20}; }}),
    presentation: {syncReadOnly: noop, transformDecorations: noop}, bracketColors: service({update: noop}),
    foldingProvider: service({refresh: noop, schedule: noop}), keymapAdapter: service({beforeModelChange: noop, setModel: noop}),
    accessibility: service({update: noop}), splitController: service(), zoomControl: service(), goToWidget: service()
  });
  editor.setModel(model.uri, model);
  editor.setSelections(selections);
  editor.inputController = new HiddenInputController(editor);
  return editor;
}

/** Reproduce docking's capture → synchronous focus → selection restore using the real textarea adapter. */
export function restoreInputFocus(editor) {
  const selection = [editor.input.selectionStart, editor.input.selectionEnd];
  editor.input.focus();
  editor.input.setSelectionRange(...selection);
  return selection;
}
