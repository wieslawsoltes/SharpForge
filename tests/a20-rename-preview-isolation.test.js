import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, EditorModelWorkspace, EditorLanguageServices} from '@sharpforge/editor';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {createInsightContext} from '../packages/editor/src/features/context.js';
import {InlineRenameWidget} from '../packages/editor/src/widgets/rename.js';
import {deferred} from './a19-session-fixtures.js';

// Only DOM layout is doubled. Preview, request guards, versions and bound providers are production code.
class Element extends EventTarget {
  constructor(document) {
    super();
    this.ownerDocument = document;
    this.style = {};
    this.children = [];
    this.classList = {add() {}, remove() {}};
  }
  setAttribute() {}
  append(...children) { this.children.push(...children); }
  focus() { this.ownerDocument.activeElement = this; }
  select() {}
  remove() {}
}

const original = '//😀 Widget\r\nclass Widget { Widget Get()=>new Widget(); string name="Widget"; }';

function fixture(t) {
  const model = new EditorModel(original, {uri: 'Widget.cs'});
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  const language = new LanguageService(workspace);
  const refactoring = new RefactoringEngine(workspace, language);
  const services = new EditorLanguageServices();
  const calls = [];
  for (const [method, invoke] of Object.entries({
    prepareRename: params => language.prepareRename(params.uri, params.offset),
    rename: params => refactoring.rename(params.uri, params.offset, params.newName, params),
    documentSymbols: params => language.documentSymbols(params.uri)
  })) services.register(method, params => {
    calls.push({method, version: model.version, text: model.value});
    workspace.update(model.uri, model.value, model.version);
    return invoke(params);
  });
  const document = {createElement: () => new Element(document)};
  const editor = {model, uri: model.uri, element: new Element(document), input: new Element(document),
    get value() { return model.value; }, get offset() { return model.primarySelection.active; },
    sourceSnapshot: () => model.snapshot(), refreshPreview() {}, focus() {},
    goto: offset => model.setSelections([{anchor: offset, active: offset}])};
  editor.goto(original.indexOf('class Widget') + 6);
  editor.input.selectionEnd = editor.offset;
  const context = createInsightContext(editor, {services, workspace: new EditorModelWorkspace(new Map([[model.uri, model]]))});
  const widget = new InlineRenameWidget(context);
  t.after(() => { widget.dispose(); context.guard.dispose(); context.lifetime.dispose(); services.dispose(); model.dispose(); });
  return {model, workspace, services, calls, context, widget};
}

async function update(widget, context, {comments = false, strings = false} = {}) {
  widget.input.value = 'Gadget';
  widget.comments.input.checked = comments;
  widget.strings.input.checked = strings;
  widget.schedule();
  context.lifetime.cancel('rename-update');
  await widget.update();
}

test('live rename option changes never publish preview source into the monotonic bound workspace', async t => {
  const {widget, context, workspace, model, calls} = fixture(t);
  await widget.open();
  await update(widget, context);
  assert.ok(model.value.includes('class Gadget'));
  assert.ok(model.value.includes('//😀 Widget'));
  const count = calls.length;
  assert.equal(await context.request('documentSymbols'), undefined);
  assert.equal(calls.length, count);
  assert.equal(workspace.documents.get(model.uri).source.version, 1);
  await update(widget, context, {comments: true});
  assert.ok(model.value.includes('//😀 Gadget'));
  assert.ok(model.value.includes('name="Widget"'));
  await update(widget, context, {comments: true, strings: true});
  assert.ok(model.value.includes('name="Gadget"'));
  assert.equal(widget.status.textContent, '5 occurrences in 1 documents');
  widget.cancel();
  assert.equal(model.value, original);
  assert.equal(model.version, 1);
  assert.equal(model.canUndo, false);
  assert.ok(await context.request('documentSymbols'));
  assert.ok(calls.every(call => call.version === 1 && call.text === original));
});

test('committing an expanded preview publishes one atomic undo entry before background requests resume', async t => {
  const {widget, context, model, workspace} = fixture(t);
  let events = 0;
  model.onDidChange(() => events++);
  await widget.open();
  await update(widget, context, {comments: true, strings: true});
  const preview = model.value;
  assert.equal(events, 0);
  await widget.commit();
  assert.equal(model.value, preview);
  assert.equal(events, 1);
  assert.equal(model.undoStack.depth, 1);
  assert.ok(await context.request('documentSymbols'));
  assert.equal(workspace.documents.get(model.uri).source.text, preview);
  assert.equal(model.undo(), true);
  assert.equal(model.value, original);
});

test('request suspension aborts pending providers and independent leases release idempotently', async t => {
  const {context, services} = fixture(t);
  const pending = deferred();
  let signal;
  services.register('hover', params => { signal = params.signal; return pending.promise; });
  const request = context.request('hover');
  const resume = context.suspendRequests(['rename']);
  assert.equal(signal.aborted, true);
  pending.resolve({contents: 'old result'});
  assert.equal(await request, undefined);
  const otherResume = context.suspendRequests(['rename']);
  resume();
  resume();
  assert.equal(await context.request('documentSymbols'), undefined);
  otherResume();
  assert.ok(await context.request('documentSymbols'));
});

test('disposing a visible rename restores exact source and releases provider ownership', async t => {
  const {widget, context, model} = fixture(t);
  await widget.open();
  await update(widget, context);
  widget.dispose();
  assert.equal(model.value, original);
  assert.equal(model.version, 1);
  assert.equal(model.canUndo, false);
  assert.ok(await context.request('documentSymbols'));
});
