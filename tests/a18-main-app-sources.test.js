import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerMainAppSources} from '../apps/studio/designer-main-app-sources.js';

function fixture() {
  const state = {workspace: 'First:1', revision: 1, files: [
    {uri: 'First/View.cs', text: 'first', version: 1}, {uri: 'Second/View.cs', text: 'second', version: 1}
  ]};
  const sources = new DesignerMainAppSources({files: () => state.files, workspaceId: () => state.workspace,
    revision: () => state.revision});
  const compilationFiles = () => [state.files[0]];
  return {state, sources, compilationFiles};
}

test('main app evidence retains full workspace bytes and exact compilation membership', () => {
  const {state, sources, compilationFiles} = fixture();
  const ticket = sources.capture({compilationFiles: compilationFiles()});
  sources.arm(ticket, {compilationFiles: compilationFiles(), previousSessionId: 4});
  assert.equal(sources.loaded(4), false);
  assert.equal(sources.loaded(5), true);
  const attached = sources.state({sessionId: 5, state: 'terminated', uiActive: true});
  assert.deepEqual(attached.compilationUris, ['First/View.cs']);
  assert.equal(attached.sourceProjection.length, 2);
  state.files[0].text = 'edited after launch';
  state.revision++;
  assert.equal(sources.state({sessionId: 5}).sourceProjection[0].text, 'first');
  assert.equal(sources.state({sessionId: 6}).sourceProjection, undefined);
  state.workspace = 'Second:2';
  assert.equal(sources.state({sessionId: 5}).sourceProjection, undefined);
});

test('stale compilation, changed project membership and unowned sources cannot arm a receipt', () => {
  const {state, sources, compilationFiles} = fixture();
  assert.throws(() => sources.capture({compilationFiles: [{uri: 'Other.cs', text: 'other'}]}), {code: 'SFDA0012'});
  const ticket = sources.capture({compilationFiles: compilationFiles()});
  assert.throws(() => sources.arm(ticket, {compilationFiles: state.files, previousSessionId: 1}), {code: 'SFDA0012'});
  state.files[1].text = 'changed dependency';
  assert.throws(() => sources.arm(ticket, {compilationFiles: compilationFiles(), previousSessionId: 1}), {code: 'SFDA0012'});
  assert.equal(sources.loaded(2), false);
});

test('late worker loads, imported assemblies and cleared launches do not acquire source ownership', () => {
  const {state, sources, compilationFiles} = fixture();
  const ticket = sources.capture({compilationFiles: compilationFiles()});
  sources.arm(ticket, {compilationFiles: compilationFiles(), previousSessionId: 1});
  state.revision++;
  assert.equal(sources.loaded(2), false);
  assert.equal(sources.state({sessionId: 2}).sourceProjection, undefined);
  assert.equal(sources.capture({compilationFiles: compilationFiles(), eligible: false}), null);
  sources.arm(null, {compilationFiles: compilationFiles(), previousSessionId: 2});
  assert.equal(sources.loaded(3), false);
  const current = sources.capture({compilationFiles: compilationFiles()});
  sources.arm(current, {compilationFiles: compilationFiles(), previousSessionId: 3});
  sources.clear();
  assert.equal(sources.loaded(4), false);
});
