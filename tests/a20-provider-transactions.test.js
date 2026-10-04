import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, EditorModelWorkspace, EditorLanguageServices, prepareWorkspaceEdit, commitWorkspaceEdit} from '@sharpforge/editor';
import {RenamePreview} from '../packages/editor/src/features/rename-preview.js';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';

function resourceWorkspace(applyResourceTransaction, capability = true) {
  const models = new Map([['Widget.cs', new EditorModel('class Widget {}', {uri: 'Widget.cs'})],
    ['Use.cs', new EditorModel('class Use { Widget value; }', {uri: 'Use.cs'})]]);
  return new EditorModelWorkspace(models, {applyResourceTransaction, supportsResourceRename: capability});
}

function renameEdit() {
  return {documentChanges: [
    {textDocument: {uri: 'Widget.cs', version: 1}, edits: [{start: 6, end: 12, newText: 'Gadget'}]},
    {textDocument: {uri: 'Use.cs', version: 1}, edits: [{start: 12, end: 18, newText: 'Gadget'}]},
    {kind: 'rename', oldUri: 'Widget.cs', newUri: 'Gadget.cs', version: 1}
  ]};
}

test('text and resource rename produce one immutable complete host plan without editing live models first', () => {
  let called = 0;
  const workspace = resourceWorkspace(plan => {
    called++;
    assert.equal(workspace.models.get('Widget.cs').value, 'class Widget {}');
    assert.equal(workspace.models.get('Use.cs').value, 'class Use { Widget value; }');
    assert.equal(plan.changes.length, 2);
    assert.equal(plan.resources.length, 1);
    return {applied: true, changes: plan.changes, resources: plan.resources};
  });
  const plan = prepareWorkspaceEdit(workspace, renameEdit());
  assert(Object.isFrozen(plan) && Object.isFrozen(plan.resources[0]));
  assert.equal(plan.resources[0].before, 'class Widget {}');
  assert.equal(plan.changes[0].text, 'class Gadget {}');
  const result = commitWorkspaceEdit(workspace, plan);
  assert.equal(called, 1);
  assert.equal(result.resources[0].newUri, 'Gadget.cs');
});

test('workspace resource support is evaluated again when the host mode changes after preview', () => {
  let supported = true;
  const workspace = resourceWorkspace(() => {throw new Error('Host must not be called');}, () => supported);
  const plan = prepareWorkspaceEdit(workspace, renameEdit());
  supported = false;
  assert.equal(workspace.supportsResourceRename, false);
  assert.throws(() => commitWorkspaceEdit(workspace, plan), /does not support/);
  assert.equal(workspace.models.get('Widget.cs').value, 'class Widget {}');
});

test('stale targets, resource collisions, readonly source and host failure leave source unchanged', () => {
  const workspace = resourceWorkspace(() => {throw new Error('host failure');});
  const plan = prepareWorkspaceEdit(workspace, renameEdit());
  assert.throws(() => commitWorkspaceEdit(workspace, plan), /host failure/);
  workspace.models.set('Gadget.cs', new EditorModel('occupied', {uri: 'Gadget.cs'}));
  assert.throws(() => commitWorkspaceEdit(workspace, plan), /changed/);
  assert.throws(() => prepareWorkspaceEdit(workspace, renameEdit()), /destination/);
  workspace.models.delete('Gadget.cs');
  workspace.models.get('Widget.cs').readOnly = true;
  assert.throws(() => prepareWorkspaceEdit(workspace, renameEdit()), /read-only/);
  workspace.models.get('Widget.cs').readOnly = false;
  workspace.models.get('Use.cs').applyEdits([{start: 0, end: 0, text: '// updated\n'}]);
  assert.throws(() => commitWorkspaceEdit(workspace, plan), /changed/);
  assert.equal(workspace.models.get('Widget.cs').value, 'class Widget {}');
});

test('unversioned and unsupported resource operations fail before the host receives any plan', () => {
  const workspace = resourceWorkspace(() => {throw new Error('Unexpected host call');});
  const operation = {kind: 'rename', oldUri: 'Widget.cs', newUri: 'Gadget.cs'};
  assert.throws(() => prepareWorkspaceEdit(workspace, {documentChanges: [operation]}), /Stale/);
  assert.throws(() => prepareWorkspaceEdit(workspace, {documentChanges: [{kind: 'delete', uri: 'Widget.cs'}]}), /Unsupported/);
  const captured = prepareWorkspaceEdit(workspace, {documentChanges: [operation]}, {versions: new Map([['Widget.cs', 1]])});
  assert.equal(captured.resources.length, 1);
});

test('real bound type rename preview restores original source, selection and undo after changing options', () => {
  const text = '//😀 Widget\r\nclass Widget { Widget Get()=>new Widget(); string name="Widget"; }';
  const model = new EditorModel(text, {uri: 'Widget.cs'});
  model.setSelections([{anchor: text.indexOf('Widget', 12), active: text.indexOf('Widget', 12)}]);
  const original = model.primarySelection;
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  workspace.update('Widget.cs', text, model.version);
  const refactoring = new RefactoringEngine(workspace, new LanguageService(workspace));
  const editor = {model, get value() {return model.value;}, paint() {}, refreshPreview() {}};
  const preview = new RenamePreview(editor);
  const target = new EditorModelWorkspace(new Map([['Widget.cs', model]]));
  for (const [name, options] of [['Gadget', {}], ['Changed', {includeComments: true, includeStrings: true}]]) {
    preview.restore();
    const action = refactoring.rename('Widget.cs', text.indexOf('class Widget') + 6, name, options);
    const plan = prepareWorkspaceEdit(target, action);
    preview.show(plan.changes[0].edits);
    assert(model.value.includes('class ' + name));
  }
  preview.restore();
  assert.equal(model.value, text);
  assert.equal(model.version, 1);
  assert.deepEqual(model.primarySelection, original);
  assert.equal(model.canUndo, false);
});

test('provider invalidation is scoped, explicitly disposable and does not fabricate source changes', async () => {
  const services = new EditorLanguageServices({codeLens: () => ({version: 1, items: []})});
  const events = [];
  const unsubscribe = services.subscribe(event => events.push(event));
  services.invalidate('codeLens', {uri: 'Widget.cs'});
  assert.deepEqual(events, [{method: 'codeLens', uri: 'Widget.cs'}]);
  assert.deepEqual(await services.invoke('codeLens', {}), {version: 1, items: []});
  unsubscribe();
  services.invalidate('codeLens');
  assert.equal(events.length, 1);
  assert.throws(() => services.invalidate('missing'), /Unknown/);
  services.dispose();
  services.invalidate('codeLens');
  assert.throws(() => services.subscribe(() => {}), /disposed/);
});

test('rename preview refuses a newer low-level buffer revision even when external edits reproduce its displayed bytes', () => {
  const model = new EditorModel('class Widget {}', {uri: 'Widget.cs'});
  const editor = {model, get value() {return this.model.value;}, refreshPreview() {}};
  const preview = new RenamePreview(editor);
  preview.show([{start: 6, end: 12, text: 'Gadget'}]);
  const displayed = model.value;
  model.buffer.applyEdits([{start: model.length, end: model.length, text: ' '}]);
  model.buffer.applyEdits([{start: model.length - 1, end: model.length, text: ''}]);
  assert.equal(model.value, displayed);
  const version = model.version;
  assert.throws(() => preview.restore(), {code: 'SFEDITOR_PREVIEW_STALE'});
  assert.equal(model.value, displayed);
  assert.equal(model.version, version);
  assert.equal(model.previewActive, false);
});

test('changing the active model restores only the captured rename preview and refuses another preview', () => {
  const original = new EditorModel('class Widget {}', {uri: 'Widget.cs'});
  const replacement = new EditorModel('class Other {}', {uri: 'Other.cs'});
  const editor = {model: original, get value() {return this.model.value;}, refreshPreview() {}};
  const preview = new RenamePreview(editor);
  preview.show([{start: 6, end: 12, text: 'Gadget'}]);
  editor.model = replacement;
  preview.restore();
  assert.equal(original.value, 'class Widget {}');
  assert.equal(original.version, 1);
  assert.equal(replacement.value, 'class Other {}');
  assert.equal(replacement.version, 1);
  assert.throws(() => preview.show([{start: 6, end: 12, text: 'Changed'}]), /active document/);
});
