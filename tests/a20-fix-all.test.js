import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {EditorModel} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {BuildServices} from '../apps/studio/workbench/build.js';
import {createWorkspaceLanguageActions, mergeWorkspaceEdits} from '../apps/studio/workbench/language-actions.js';
import {registerEditorLanguageHandlers} from '../apps/studio/workers/editor-language.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';

const explicit = 'sharpforge.local.explicit-type';
const implicit = 'sharpforge.local.implicit-type';
const source = (name, value = 1) => `class ${name} { int M(){var number=${value};return number;} }`;

function engine() {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  for (const name of ['A', 'B', 'C']) workspace.update(name + '.cs', source(name), 7);
  return {workspace, refactoring: new RefactoringEngine(workspace, new LanguageService(workspace))};
}

test('document/project/solution Fix All batch exactly one selected action equivalence family', () => {
  const {workspace, refactoring} = engine();
  const ownership = {projects: [{id: 'one', documents: ['A.cs', 'B.cs'].map(uri => ({uri, version: 7}))},
    {id: 'two', documents: [{uri: 'C.cs', version: 7}]}]};
  const options = {uri: 'A.cs', version: 7, projectId: 'one', ownership, equivalenceKey: explicit};
  const available = refactoring.actions('A.cs', source('A').indexOf('number'));
  const selected = available.find(action => action.equivalenceKey === explicit);
  assert.deepEqual(selected.fixAllScopes, ['document', 'project', 'solution']);
  for (const [scope, expected] of [['document', 1], ['project', 2], ['solution', 3]]) {
    const action = refactoring.fixAll({...options, scope});
    assert.equal(action.edits.length, expected);
    assert(action.edits.every(edit => edit.newText === 'int' && edit.version === 7));
  }
  assert.equal(workspace.documents.get('A.cs').source.text, source('A'));
  const action = refactoring.fixAll({...options, scope: 'solution'});
  refactoring.apply(action);
  assert([...workspace.documents.values()].every(document => document.source.text.includes('int number=')));
});

test('Fix All validates every source version and rejects forged, absent or ambiguous ownership', () => {
  const {refactoring} = engine();
  const request = {uri: 'A.cs', version: 7, scope: 'project', projectId: 'one', equivalenceKey: explicit,
    ownership: {projects: [{id: 'one', documents: [{uri: 'A.cs', version: 7}, {uri: 'B.cs', version: 6}]}]}};
  assert.throws(() => refactoring.fixAll(request), /changed/);
  assert.throws(() => refactoring.fixAll({...request, ownership: undefined}), /ownership/);
  assert.throws(() => refactoring.fixAll({...request, projectId: 'unknown'}), /unavailable/);
  assert.throws(() => refactoring.fixAll({...request, scope: 'document', version: 6}), /stale/);
  assert.throws(() => refactoring.fixAll({...request, equivalenceKey: 'refactor.inline'}), /does not support/);
});

test('implicit type batches preserve nonexact numeric conversions, const locals and comments', () => {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  const text = 'class C { void M(){int exact=1;double converted=1;const int fixedValue=2;string label="var";} } // var';
  workspace.update('C.cs', text, 1);
  const refactoring = new RefactoringEngine(workspace, new LanguageService(workspace));
  const action = refactoring.fixAll({uri: 'C.cs', version: 1, scope: 'document', equivalenceKey: implicit});
  assert.equal(action.edits.length, 2);
  refactoring.apply(action);
  assert.equal(workspace.documents.get('C.cs').source.text,
    text.replace('int exact', 'var exact').replace('string label', 'var label'));
});

/** A deterministic in-process transport routes the actual compiler handlers; it is not browser-worker qualification. */
class CompilerTransport {
  constructor(control) {
    this.control = control;
    this.workspace = new Workspace();
    const language = new LanguageService(this.workspace);
    this.handlers = createWorkerProtocol('compiler');
    registerEditorLanguageHandlers(this.handlers, {workspace: this.workspace, language,
      refactoring: new RefactoringEngine(this.workspace, language)});
  }
  postMessage({id, method, params}) {
    queueMicrotask(() => {
      if (this.disposed) return;
      try {
        const uris = new Set(params.files.map(file => file.uri));
        for (const uri of this.workspace.documents.keys()) if (!uris.has(uri)) this.workspace.remove(uri);
        for (const file of params.files) this.workspace.update(file.uri, file.text, file.version);
        if (JSON.stringify(this.workspace.compilationOptions) !== JSON.stringify(params.compilationOptions)) {
          this.workspace.compilationOptions = params.compilationOptions;
          this.workspace.result = null;
        }
        const result = this.handlers.dispatch(method, params);
        this.control.beforeReply?.(method, params);
        this.onmessage({data: {id, result, revision: params.revision}});
      } catch (error) { this.onmessage({data: {id, error: {name: error.name, code: error.code, message: error.message}}}); }
    });
  }
  terminate() { this.disposed = true; }
}

function workspaceActions({shared = false, records: suppliedRecords, owned: suppliedOwned, closure} = {}) {
  const records = suppliedRecords ?? ['A', 'B', 'C'].map(name => ({uri: name + '.cs', text: source(name), version: 1}));
  const documents = new DocumentService({records, createModel: record => new EditorModel(record.text, record)});
  const owned = suppliedOwned ?? new Map([['one', ['A.cs', 'B.cs']], ['two', shared ? ['B.cs', 'C.cs'] : ['C.cs']]]);
  const control = {};
  const builds = new BuildServices({workerFactory: () => new CompilerTransport(control), snapshot: id => ({
    files: (closure ?? owned).get(id).map(uri => documents.get(uri)), compilationOptions: {outputKind: 'library'}
  })});
  for (const id of owned.keys()) builds.register({id, name: id});
  const projects = {services: {builds}, sync() {}, serviceFor(uri, id) {
    return builds.get(id ?? [...owned].find(([, uris]) => uris.includes(uri))[0]);
  }};
  const actions = createWorkspaceLanguageActions({projects, documents, getProjectDocuments: id => owned.get(id)});
  return {actions, builds, documents, owned, control, dispose() {builds.dispose(); documents.dispose();}};
}

test('solution Fix All uses real isolated compiler contexts, deduplicates shared source and does not commit', async t => {
  const context = workspaceActions({shared: true});
  t.after(() => context.dispose());
  const result = await context.actions.codeActions({uri: 'A.cs', version: 1, offset: source('A').indexOf('number'),
    scope: 'solution', equivalenceKey: explicit});
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].edits.map(edit => edit.uri), ['A.cs', 'B.cs', 'C.cs']);
  assert(context.documents.list().every(record => record.text.includes('var number=')));
});

test('project Fix All does not broaden to an unrelated project', async t => {
  const context = workspaceActions();
  t.after(() => context.dispose());
  const result = await context.actions.codeActions({uri: 'A.cs', version: 1, offset: source('A').indexOf('number'),
    scope: 'project', projectId: 'one', equivalenceKey: explicit});
  assert.deepEqual(result[0].edits.map(edit => edit.uri), ['A.cs', 'B.cs']);
});

test('type rename reaches each dependent compiler context and returns one resource move', async t => {
  const records = [{uri: 'Widget.cs', text: 'public class Widget {}', version: 1},
    {uri: 'One.cs', text: 'class One { Widget value=new Widget(); }', version: 1},
    {uri: 'Two.cs', text: 'class Two { Widget value=new Widget(); }', version: 1}];
  const context = workspaceActions({records, owned: new Map([['one', ['Widget.cs', 'One.cs']], ['two', ['Two.cs']]]),
    closure: new Map([['one', ['Widget.cs', 'One.cs']], ['two', ['Widget.cs', 'Two.cs']]])});
  t.after(() => context.dispose());
  const result = await context.actions.rename({uri: 'One.cs', version: 1, offset: records[1].text.indexOf('Widget'),
    newName: 'Gadget', renameFile: true});
  const texts = result.documentChanges.filter(change => change.textDocument);
  assert.deepEqual(texts.map(change => change.textDocument.uri), ['One.cs', 'Two.cs', 'Widget.cs']);
  assert.equal(texts.reduce((count, change) => count + change.edits.length, 0), 5);
  assert.deepEqual(result.documentChanges.filter(change => change.kind),
    [{kind: 'rename', oldUri: 'Widget.cs', newUri: 'Gadget.cs', version: 1}]);
  assert(context.documents.list().every(record => record.text.includes('Widget')));
});

test('workspace action rejects a source mutation or ownership change while providers are answering', async t => {
  const context = workspaceActions();
  t.after(() => context.dispose());
  context.control.beforeReply = () => {
    context.control.beforeReply = null;
    context.documents.models.get('B.cs').applyEdits([{start: 0, end: 0, text: '// changed\n'}]);
  };
  await assert.rejects(context.actions.codeActions({uri: 'A.cs', version: 1, scope: 'solution', equivalenceKey: explicit}), /changed|stale/i);
  assert(context.documents.get('A.cs').text.includes('var number='));
});

test('pre-cancelled solution action never returns a partial plan', async t => {
  const context = workspaceActions();
  t.after(() => context.dispose());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(context.actions.codeActions({uri: 'A.cs', version: 1, scope: 'solution', equivalenceKey: explicit},
    {signal: controller.signal}), {name: 'AbortError'});
});

test('solution Fix All and rename reject new project membership during the final semantic validation', async t => {
  for (const operation of ['fixAll', 'rename']) {
    const context = workspaceActions();
    t.after(() => context.dispose());
    context.control.beforeReply = method => {
      if (method !== 'validateWorkspaceEdit') return;
      context.control.beforeReply = null;
      context.owned.set('added', ['C.cs']);
      context.builds.register({id: 'added', name: 'Added during validation'});
    };
    const result = operation === 'fixAll' ? context.actions.codeActions({uri: 'A.cs', version: 1,
      scope: 'solution', equivalenceKey: explicit}) : context.actions.rename({uri: 'A.cs', version: 1,
      offset: source('A').indexOf('A'), newName: 'Renamed'});
    await assert.rejects(result, /Solution.*changed/);
    assert.equal(context.documents.get('A.cs').text, source('A'));
  }
});

test('conflicting shared edits or resources are refused before a preview can be committed', () => {
  const edit = {uri: 'A.cs', version: 1, start: 0, end: 3, newText: 'int'};
  assert.throws(() => mergeWorkspaceEdits([[edit], [{...edit, newText: 'double'}]]), /disagree/);
  assert.throws(() => mergeWorkspaceEdits([[edit, {...edit, start: 2, end: 4}]]), /overlap/);
  const resource = {kind: 'rename', oldUri: 'A.cs', newUri: 'B.cs', version: 1};
  assert.throws(() => mergeWorkspaceEdits([{edits: [], resources: [resource]},
    {edits: [], resources: [{...resource, newUri: 'C.cs'}]}]), /disagree/);
});
