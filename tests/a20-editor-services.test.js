import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceText} from '@sharpforge/text';
import {EditorModel} from '../packages/editor/src/model.js';
import {AsyncRequestGuard, editorRevision, sameRevision, EDITOR_SERVICE_METHODS, EditorLanguageServices, createRequestServices,
  prepareWorkspaceEdit, commitWorkspaceEdit, EditorModelWorkspace, diagnosticDecorations,
  mergeSemanticTokens, semanticDecorations} from '../packages/editor/src/services/index.js';
import {RenamePreview} from '../packages/editor/src/features/rename-preview.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

test('every declared service can be supplied by a standalone fake provider', async () => {
  const services = new EditorLanguageServices();
  for (const method of EDITOR_SERVICE_METHODS) services.register(method, parameters => ({method, version: parameters.version}));
  for (const method of EDITOR_SERVICE_METHODS) {
    assert.equal(services.supports(method), true);
    assert.deepEqual(await services.invoke(method, {uri: 'a.cs', version: 3}), {method, version: 3});
  }
  assert.throws(() => services.register('madeUp', () => []), /Unknown/);
  assert.throws(() => services.register('hover', () => []), /already registered/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(services.invoke('hover', {signal: controller.signal}), {name: 'AbortError'});
  services.dispose();
  await assert.rejects(services.invoke('hover', {}), /No hover provider/);
});

test('RPC adapter advertises only pure registered methods and passes cancellation through', async () => {
  const received = [];
  const services = createRequestServices((method, parameters) => { received.push({method, parameters}); return []; },
    ['completion', {method: 'codeLens', remote: 'referenceLenses'}]);
  const signal = new AbortController().signal;
  await services.invoke('codeLens', {uri: 'a.cs', version: 4, signal});
  assert.equal(received[0].method, 'referenceLenses');
  assert.equal(received[0].parameters.signal, signal);
  assert.equal(services.supports('rename'), false);
});

test('request generations reject older versions, edits at identical caret offsets and out-of-order results', async () => {
  let snapshot = {uri: 'a.cs', version: 1, text: 'first'};
  const guard = new AsyncRequestGuard(() => snapshot);
  const requests = Array.from({length: 12}, deferred);
  const signals = [];
  const pending = requests.map((request, index) => {
    snapshot = {uri: 'a.cs', version: index + 1, text: `version ${index}`};
    return guard.run('hover', parameters => { signals.push(parameters.signal); return request.promise; });
  });
  for (const index of [4, 8, 1, 11, 0, 7, 2, 10, 3, 6, 9, 5]) requests[index].resolve({contents: String(index)});
  const values = await Promise.all(pending);
  assert.equal(values.filter(Boolean).length, 1);
  assert.equal(values[11].value.contents, '11');
  assert(signals.slice(0, -1).every(signal => signal.aborted));
  const sameVersion = deferred();
  const waiting = guard.run('hover', () => sameVersion.promise);
  snapshot = {...snapshot, text: 'new text under the same externally supplied version'};
  sameVersion.resolve({contents: 'outdated'});
  assert.equal(await waiting, undefined);
});

test('guard propagates errors, isolates feature channels and cancels on dispose', async () => {
  const guard = new AsyncRequestGuard(() => ({uri: 'a', version: 1, text: ''}));
  await assert.rejects(guard.run('hover', () => { throw new Error('provider failed'); }), /provider failed/);
  const hover = deferred();
  const completion = deferred();
  const first = guard.run('hover', () => hover.promise);
  const second = guard.run('completion', () => completion.promise);
  hover.resolve({version: 2});
  assert.equal(await first, undefined);
  guard.dispose();
  completion.resolve(['never delivered']);
  assert.equal(await second, undefined);
  assert.equal(await guard.run('hover', () => { throw new Error('must not run'); }), undefined);
});

test('guard retains persistent snapshot identities and compares target document versions independently', async () => {
  let model = new EditorModel('origin', {uri: 'a'});
  const editor = {uri: 'a', get model() { return model; }, get value() { throw new Error('Guard must not flatten a model'); }};
  const first = editorRevision(editor);
  assert(sameRevision(first, editorRevision(editor)));
  const guard = new AsyncRequestGuard(() => editorRevision(editor));
  const result = await guard.run('peek', () => ({uri: 'b', version: 9, text: 'target'}), {}, {validateResponseVersion: false});
  assert.equal(result.value.version, 9);
  const pending = deferred();
  const waiting = guard.run('peek', () => pending.promise, {}, {validateResponseVersion: false});
  model = new EditorModel('origin', {uri: 'a'});
  assert(!sameRevision(first, editorRevision(editor)));
  pending.resolve({uri: 'b', version: 9, text: 'target'});
  assert.equal(await waiting, undefined);
});

function workspace() {
  return new EditorModelWorkspace(new Map(['a', 'b', 'c'].map(uri => [uri, new EditorModel('value', {uri})])));
}

const allEdits = target => target.listDocuments().map(document => ({uri: document.uri, version: document.version,
  start: 0, end: 5, newText: 'renamed'}));

test('three-document edits commit before any subscriber and undo in one step per document', () => {
  const target = workspace();
  const seen = [];
  for (const model of target.models.values()) model.onDidChange(() => seen.push(target.listDocuments().map(document => document.text)));
  const plan = prepareWorkspaceEdit(target, allEdits(target));
  commitWorkspaceEdit(target, plan);
  assert.equal(seen.length, 3);
  assert(seen.every(texts => texts.every(text => text === 'renamed')));
  for (const model of target.models.values()) {
    assert.equal(model.undo(), true);
    assert.equal(model.value, 'value');
    assert.equal(model.undo(), false);
  }
});

test('stale, overlapping, missing, readonly and invalid LSP edits fail before any mutation', () => {
  const target = workspace();
  const first = allEdits(target)[0];
  for (const edits of [
    [...allEdits(target), {...first, uri: 'missing'}],
    [first, {...first, start: 1}],
    [{...first, version: 99}],
    [{...first, version: undefined}],
    [{...first, end: 100}],
    [{uri: 'a', version: first.version, range: {start: {line: 20, character: 0}, end: {line: 20, character: 0}}, newText: 'x'}],
    [{uri: 'a', version: first.version, range: {start: {line: 0, character: 80}, end: {line: 0, character: 80}}, newText: 'x'}]
  ]) assert.throws(() => prepareWorkspaceEdit(target, edits));
  target.models.get('b').readOnly = true;
  assert.throws(() => prepareWorkspaceEdit(target, allEdits(target)), /read-only/);
  assert(target.listDocuments().every(document => document.text === 'value'));
});

test('LSP document changes and captured versions require an explicit host for resource operations', () => {
  const target = workspace();
  const range = {start: {line: 0, character: 0}, end: {line: 0, character: 5}};
  const plan = prepareWorkspaceEdit(target, {documentChanges: [{textDocument: {uri: 'a', version: 1}, edits: [{range, newText: 'new'}]}]});
  assert.equal(plan.changes[0].text, 'new');
  assert.throws(() => prepareWorkspaceEdit(target, {documentChanges: [{kind: 'rename', oldUri: 'a', newUri: 'b'}]}), /atomic resource rename/);
  const changes = prepareWorkspaceEdit(target, {changes: {a: [{range, newText: 'ok'}]}}, {versions: new Map([['a', 1]])});
  assert.equal(changes.changes[0].text, 'ok');
});

test('version change after preview blocks commit and an internal participant failure rolls back history', () => {
  const target = workspace();
  const plan = prepareWorkspaceEdit(target, allEdits(target));
  target.models.get('c').applyEdits([{start: 0, end: 0, text: '!'}]);
  assert.throws(() => commitWorkspaceEdit(target, plan), /changed before commit/);
  assert.equal(target.models.get('a').value, 'value');
  class FailedModel extends EditorModel {
    commitPrepared() { throw new Error('injected commit failure'); }
  }
  const failing = workspace();
  failing.models.set('c', new FailedModel('value', {uri: 'c'}));
  let notifications = 0;
  for (const model of failing.models.values()) model.onDidChange(() => notifications++);
  assert.throws(() => commitWorkspaceEdit(failing, prepareWorkspaceEdit(failing, allEdits(failing))), /injected/);
  assert(failing.listDocuments().every(document => document.text === 'value' && document.version === 1));
  assert([...failing.models.values()].every(model => !model.canUndo));
  assert.equal(notifications, 0);
});

test('rename preview updates source without publishing then cancel restores exact bytes and undo state', () => {
  const model = new EditorModel('value + value\r\n', {uri: 'a'});
  const editor = {model, get value() { return model.value; }, paint() {}, view: {render() {}}};
  let events = 0;
  model.onDidChange(() => events++);
  const preview = new RenamePreview(editor);
  preview.show([{start: 0, end: 5, text: 'new'}, {start: 8, end: 13, text: 'new'}]);
  assert.equal(editor.value, 'new + new\r\n');
  assert.equal(events, 0);
  preview.show([{start: 0, end: 5, text: 'other'}, {start: 8, end: 13, text: 'other'}]);
  assert.equal(editor.value, 'other + other\r\n');
  preview.restore();
  assert.equal(editor.value, 'value + value\r\n');
  assert.equal(model.version, 1);
  assert.equal(model.canUndo, false);
});

test('diagnostic severities and semantic overlays are version checked and preserve lexical coverage', () => {
  const source = new SourceText('class C { int x; }', 'a', 7);
  const diagnostics = ['error', 'warning', 'suggestion', 'hidden'].map((severity, index) => ({uri: 'a', version: 7,
    start: index, length: 1, severity, message: severity, code: `D${index}`, tags: index === 3 ? ['unnecessary'] : []}));
  const decorations = diagnosticDecorations([...diagnostics, {...diagnostics[0], version: 6}], source);
  assert.equal(decorations.length, 4);
  assert(decorations[3].className.includes('unnecessary'));
  const lexical = [{start: 0, end: 5, kind: 'keyword'}, {start: 5, end: source.length, kind: ''}];
  const semantic = [{start: 6, end: 7, kind: 'type'}, {start: 14, end: 15, kind: 'local'}];
  const merged = mergeSemanticTokens(lexical, semantic, source);
  assert.equal(merged.map(run => source.text.slice(run.start, run.end)).join(''), source.text);
  assert.equal(merged.filter(run => run.semantic).length, 2);
  assert.equal(mergeSemanticTokens(lexical, semantic, source, 6), lexical);
  assert.deepEqual(semanticDecorations(semantic, source, 6), []);
  assert.throws(() => mergeSemanticTokens(lexical, [{start: 1, end: 3}, {start: 2, end: 4}], source), /overlap/);
});
