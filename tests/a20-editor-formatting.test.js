import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '../packages/editor/src/model.js';
import {EditorModelWorkspace} from '../packages/editor/src/services/model-workspace.js';
import {EditorFormatting} from '../packages/editor/src/features/formatting.js';

function formatting(options = {}) {
  const model = new EditorModel('class C {\nx();\n}', {uri: 'a'});
  const pending = [];
  const requests = [];
  const context = {
    options, editor: {model, uri: 'a', input: {readOnly: false}, sourceSnapshot: () => model.snapshot(),
      get offset() { return model.primarySelection.active; }},
    workspace: new EditorModelWorkspace(new Map([['a', model]])),
    services: {supports: method => ['format', 'formatRange', 'formatOnType'].includes(method)},
    lifetime: {delay: (key, callback) => pending.push(callback)}, safe: callback => callback(),
    async request(method, parameters) {
      requests.push({method, parameters});
      return {revision: {uri: 'a'}, versions: new Map([['a', model.version]]), value: [{uri: 'a', version: model.version,
        start: parameters.start ?? 0, end: parameters.start ?? 0, newText: '    '}]};
    }
  };
  return {format: new EditorFormatting(context), model, context, pending, requests};
}

test('real paste source triggers bounded range formatting and its own undo transaction', async () => {
  const {format, model, pending, requests} = formatting();
  const before = model.value;
  const change = model.applyEdits([{start: 10, end: 10, text: 'y();\n'}], {source: 'paste', undoStop: true});
  const pasted = model.value;
  format.changed(change);
  assert.equal(pending.length, 1);
  await pending[0]();
  assert.equal(requests[0].method, 'formatRange');
  assert.equal(requests[0].parameters.start, 10);
  assert.equal(requests[0].parameters.end, 15);
  assert.equal(model.value, 'class C {\n    y();\nx();\n}');
  assert.equal(model.undo(), true);
  assert.equal(model.value, pasted);
  assert.equal(model.undo(), true);
  assert.equal(model.value, before);
});

test('disabled paste/type/completion triggers and formatting recursion schedule no work', () => {
  const {format, model, pending} = formatting({formatOnPaste: false, formatOnType: false, formatOnCompletion: false});
  format.beforeinput({inputType: 'insertFromPaste', data: 'x'});
  format.changed(model.applyEdits([{start: 10, end: 10, text: 'x'}], {source: 'paste'}));
  assert.equal(format.pendingPaste, null);
  format.changed({source: 'typing', changes: [{start: 10, end: 10, text: ';'}]});
  format.afterCompletion();
  format.changed({source: 'Format code', changes: [{start: 10, end: 10, text: '}'}]});
  assert.equal(pending.length, 0);
});

test('on-type formatting uses the registered provider and read-only editors cannot commit it', async () => {
  const {format, context, requests} = formatting();
  await format.format({character: '}', range: {start: 10, end: 14}});
  assert.equal(requests[0].method, 'formatOnType');
  assert.equal(requests[0].parameters.character, '}');
  context.editor.input.readOnly = true;
  await format.format();
  assert.equal(requests.length, 1);
});
