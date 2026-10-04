import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, EditorModelWorkspace, EditorLanguageServices} from '@sharpforge/editor';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {createInsightContext} from '../packages/editor/src/features/context.js';
import {InlineRenameWidget} from '../packages/editor/src/widgets/rename.js';
import {AnalysisDecorations} from '../packages/editor/src/features/analysis-decorations.js';
import {createEditorInsights} from '../packages/editor/src/features/insights.js';
import {deferred} from './a19-session-fixtures.js';

// Only DOM layout is doubled. Preview, request guards, versions and bound providers are production code.
class Element extends EventTarget {
  constructor(document) {
    super();
    this.ownerDocument = document;
    this.style = {};
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classList = {add() {}, remove() {}};
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
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
  const document = new EventTarget();
  document.createElement = () => new Element(document);
  document.getElementById = () => null;
  const editor = {model, uri: model.uri, element: new Element(document), input: new Element(document),
    get value() { return this.model.value; }, get offset() { return this.model.primarySelection.active; },
    sourceSnapshot() { return this.model.snapshot(); }, refreshPreview() {}, focus() {},
    goto(offset) { this.model.setSelections([{anchor: offset, active: offset}]); }};
  editor.goto(original.indexOf('class Widget') + 6);
  editor.input.selectionEnd = editor.offset;
  const context = createInsightContext(editor, {services, workspace: new EditorModelWorkspace(new Map([[model.uri, model]]))});
  const widget = new InlineRenameWidget(context);
  t.after(() => { widget.dispose(); context.guard.dispose(); context.lifetime.dispose(); services.dispose(); model.dispose(); });
  return {model, workspace, services, calls, context, widget, editor, document};
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

test('same-model secondary views remain suspended through restored-source rename request windows', async t => {
  const {widget, context, services, editor, model} = fixture(t);
  const secondary = createInsightContext(editor, {services, workspace: context.workspace});
  t.after(() => { secondary.guard.dispose(); secondary.lifetime.dispose(); });
  const pending = deferred();
  let calls = 0;
  services.register('hover', () => { calls++; return pending.promise; });
  const oldRequest = secondary.request('hover');
  await widget.open();
  assert.equal(model.previewActive, true);
  assert.equal(model.snapshot(), model.publishedSnapshot());
  assert.equal(await secondary.request('hover'), undefined);
  assert.equal(calls, 1);
  await update(widget, context);
  pending.resolve({contents: 'old locations'});
  assert.equal(await oldRequest, undefined);
  assert.equal(await secondary.request('hover'), undefined);
  widget.cancel();
  assert.ok(await secondary.request('hover'));
});

test('CodeLens commands and legacy references cannot dispatch from an active rename preview', async t => {
  const {widget, context, services, editor, model} = fixture(t);
  const commands = [], legacy = [];
  services.register('executeCommand', params => { commands.push(params); return true; });
  editor.request = (method, params) => { legacy.push({method, params}); return true; };
  const decorations = new AnalysisDecorations(context);
  t.after(() => decorations.dispose());
  await widget.open();
  await update(widget, context);
  assert.equal(await decorations.activateLens({command: {command: 'sharpforge.tests.run'}}, 6), undefined);
  assert.equal(await decorations.activateLens({count: 2}, 6), undefined);
  assert.deepEqual(commands, []);
  assert.deepEqual(legacy, []);
  widget.cancel();
  assert.equal(await decorations.activateLens({command: {command: 'sharpforge.tests.run'}}, 6), true);
  assert.equal(commands[0].version, model.publishedSnapshot().version);
  assert.equal(await decorations.activateLens({count: 2}, 6), true);
  assert.deepEqual(legacy, [{method: 'references', params: {uri: 'Widget.cs', offset: 6}}]);
});

test('model switch before a delayed update closes the captured rename without querying the new document', async t => {
  const {widget, context, editor, model, calls} = fixture(t);
  await widget.open();
  await update(widget, context);
  const next = new EditorModel(original, {uri: 'Other.cs'});
  t.after(() => next.dispose());
  editor.model = next;
  editor.uri = next.uri;
  const count = calls.length;
  await update(widget, context, {comments: true});
  assert.equal(calls.length, count);
  assert.equal(widget.origin, null);
  assert.equal(model.previewActive, false);
  assert.equal(model.value, original);
  assert.equal(next.canUndo, false);
});

test('actual insights changed lifecycle cancels rename on same-URI model replacement', async t => {
  const {context, services, editor, model} = fixture(t);
  const insights = createEditorInsights(editor, {services, workspace: context.workspace});
  t.after(() => insights.dispose());
  await insights.rename();
  assert.equal(model.previewActive, true);
  const next = new EditorModel(original, {uri: model.uri});
  t.after(() => next.dispose());
  editor.model = next;
  context.workspace.models.set(model.uri, next);
  insights.changed();
  assert.equal(model.previewActive, false);
  assert.equal(model.value, original);
  assert.equal(next.canUndo, false);
  const popup = editor.element.children.filter(item => item.attributes.get('aria-label') === 'inline-rename').at(-1);
  assert.equal(popup.hidden, true);
});

test('removing workspace ownership closes rename even while its old editor still references the model', async t => {
  const {widget, context, model, calls} = fixture(t);
  await widget.open();
  await update(widget, context);
  context.workspace.models.delete(model.uri);
  const count = calls.length;
  await widget.update();
  assert.equal(widget.origin, null);
  assert.equal(model.previewActive, false);
  assert.equal(calls.length, count);
  assert.equal(model.value, original);
});

test('a failed final commit closes the released capability and resumes normal requests', async t => {
  const {widget, context, model} = fixture(t);
  await widget.open();
  await update(widget, context);
  model.readOnly = true;
  await assert.rejects(widget.commit(), {code: 'SFED1113'});
  assert.equal(widget.origin, null);
  assert.equal(widget.preview, null);
  assert.equal(model.previewActive, false);
  assert.equal(model.value, original);
  model.readOnly = false;
  assert.ok(await context.request('documentSymbols'));
  widget.dispose();
  assert.equal(model.value, original);
});

test('async resource Apply forwards real cancellation and its old finally cannot close a newer rename', async t => {
  const {widget, context, model} = fixture(t);
  const pending = deferred();
  let signal, dispatches = 0;
  context.workspace = new EditorModelWorkspace(new Map([[model.uri, model]]), {
    applyResourceTransaction: async (plan, options) => {
      dispatches++;
      signal = options.signal;
      await pending.promise;
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      throw new Error('The test must cancel before resource publication');
    }
  });
  await widget.open();
  await update(widget, context);
  widget.plan = {...widget.plan, resources: [{kind: 'rename', oldUri: model.uri,
    newUri: 'Gadget.cs', version: 1, before: original}]};
  const applying = widget.commit();
  assert.equal(signal.aborted, false);
  await widget.commit();
  assert.equal(dispatches, 1);
  widget.cancel(false);
  assert.equal(signal.aborted, true);
  await widget.open();
  const nextPreview = widget.preview;
  assert.equal(model.previewActive, true);
  pending.resolve();
  await assert.rejects(applying, {name: 'AbortError'});
  assert.equal(widget.preview, nextPreview);
  assert.equal(model.previewActive, true);
  widget.cancel(false);
  assert.equal(model.value, original);
});
