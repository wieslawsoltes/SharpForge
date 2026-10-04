import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {CompletionWidget} from '../packages/editor/src/widgets/completion.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {registerEditorLanguageHandlers} from '../apps/studio/workers/editor-language.js';

/** Minimal DOM surface only; source, worker handlers, completion widget, edits and undo remain production code. */
class Element extends EventTarget {
  constructor(document) {
    super();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.classes = new Set();
    this.classList = {add: name => this.classes.add(name), remove: name => this.classes.delete(name)};
  }
  get id() { return this.attributes.get('id'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}

function fixture(t, text = 'class C { void Format(int value){} void M(){ For') {
  const model = new EditorModel(text, {uri: 'Completion.cs'});
  model.setSelections([{anchor: text.length, active: text.length}]);
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  workspace.update(model.uri, text, model.version);
  const language = new LanguageService(workspace);
  const protocol = createWorkerProtocol('compiler');
  registerEditorLanguageHandlers(protocol, {workspace, language, refactoring: new RefactoringEngine(workspace, language)});
  const document = {getElementById: () => null, createElement: () => new Element(document)};
  const editor = {model, uri: model.uri, element: new Element(document), input: new Element(document),
    get value() { return model.value; }, get offset() { return model.primarySelection.active; },
    sourceSnapshot: () => model.snapshot(), applyEdits: (edits, options) => model.applyEdits(edits, options),
    goto: offset => model.setSelections([{anchor: offset, active: offset}]), focus() { document.activeElement = this.input; }};
  const requests = [];
  const context = {editor, document, services: {supports: () => false}, guard: {cancel() {}}, status() {},
    safe: action => action(), request: async (method, parameters) => {
      requests.push({method, parameters});
      return {value: protocol.dispatch(method, {uri: model.uri, version: model.version, ...parameters}), revision: {text: model.value}};
    }};
  const widget = new CompletionWidget(context);
  t.after(() => { widget.dispose(); protocol.dispose(); model.dispose(); });
  return {model, language, protocol, editor, widget, requests, text};
}

test('actual C# worker supplies invocation commit characters for source and intrinsic methods only', t => {
  const source = fixture(t);
  const items = source.protocol.dispatch('completion', {uri: source.model.uri, version: 1, offset: source.text.length});
  const format = items.find(item => item.label === 'Format');
  assert.equal(format.kind, 'method');
  assert.deepEqual(format.commitCharacters, ['(']);
  const keywords = source.language.completions(source.model.uri, source.text.length).filter(item => item.kind === 'keyword');
  assert.ok(keywords.length > 0);
  assert.ok(keywords.every(item => item.commitCharacters === undefined));
  const intrinsic = fixture(t, 'Console.WriteL');
  const writeLine = intrinsic.protocol.dispatch('completion', {uri: intrinsic.model.uri, version: 1,
    offset: intrinsic.text.length}).find(item => item.label === 'WriteLine');
  assert.deepEqual(writeLine.commitCharacters, ['(']);
});

test('typing a method invocation opener commits the selected real provider item and the opener in one undo step', async t => {
  const current = fixture(t);
  await current.widget.open();
  current.widget.index = current.widget.ranked.findIndex(entry => entry.item.label === 'Format');
  assert.ok(current.widget.index >= 0);
  assert.equal(current.widget.keydown({key: '('}), true);
  assert.equal(current.model.value, current.text.slice(0, -3) + 'Format(');
  assert.equal(current.editor.offset, current.model.length);
  assert.equal(current.widget.popup.visible, false);
  assert.equal(current.model.undo(), true);
  assert.equal(current.model.value, current.text);
  assert.equal(current.model.undo(), false);
});

test('suggestion mode keeps an invocation opener available to typing and Escape preserves the prefix', async t => {
  const current = fixture(t);
  await current.widget.open();
  current.widget.index = current.widget.ranked.findIndex(entry => entry.item.label === 'Format');
  current.widget.toggleSuggestion();
  assert.equal(current.widget.keydown({key: '('}), false);
  assert.equal(current.model.value, current.text);
  assert.equal(current.widget.keydown({key: 'Escape'}), true);
  assert.equal(current.model.value, current.text);
  assert.equal(current.model.canUndo, false);
});

test('read-only completion does not consume a commit character or mutate the source', async t => {
  const current = fixture(t);
  await current.widget.open();
  current.widget.index = current.widget.ranked.findIndex(entry => entry.item.label === 'Format');
  current.editor.input.readOnly = true;
  assert.equal(current.widget.keydown({key: '('}), false);
  assert.equal(current.model.value, current.text);
});
