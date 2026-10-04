import test from 'node:test';
import assert from 'node:assert/strict';
import { contributeDesignerAutomation } from '../apps/studio/tools/designer-automation.js';

function automation(context) {
  let result;
  contributeDesignerAutomation({contributeAutomation: (_scope, value) => { result = value.designer; }}, context);
  return result;
}

test('lazy designer automation loads a document through the A18 facade and preserves source undo and session targeting', async () => {
  const calls = [];
  let ready, active;
  const pending = new Promise(resolve => { ready = resolve; });
  const tools = {
    load: async (value, options) => { calls.push(['load', value, options]); return {uri: options.path}; },
    ensure: () => { throw new Error('Session document load bypassed'); },
    replace: () => { throw new Error('Active document was replaced'); },
    undo: redo => { calls.push(['source undo', redo]); return 'source history'; },
    attach: (sessionId, options) => { calls.push(['attach', sessionId, options]); return sessionId; },
    document: {
      select: ids => ids,
      undo: () => { throw new Error('Source history was bypassed'); }
    }
  };
  const api = automation({loadDesigner: () => active ?? pending});
  const value = {nodes: []}, options = {path: 'New.sfdesign.json'};
  const loaded = api.load(value, options);
  assert.deepEqual(calls, []);
  active = tools;
  ready(tools);
  assert.deepEqual(await loaded, {uri: 'New.sfdesign.json'});
  assert.deepEqual(api.select(['node1']), ['node1']);
  assert.equal(api.undo(true), 'source history');
  const attachment = {preview: true};
  assert.equal(api.attach('second-app', attachment), 'second-app');
  assert.deepEqual(calls, [['load', value, options], ['source undo', true], ['attach', 'second-app', attachment]]);
});

test('loaded upstream controllers retain synchronous document operations and the legacy load contract', () => {
  const calls = [];
  const tools = {
    ensure: () => calls.push('ensure'), replace: (value, options) => calls.push([value, options]),
    snapshot: () => ({version: 7}), document: {undo: redo => redo ? 'redo' : 'undo'}
  };
  const api = automation({designerTools: tools});
  const value = {nodes: []}, options = {path: 'Legacy.sfdesign.json'};
  assert.deepEqual(api.load(value, options), {version: 7});
  assert.deepEqual(calls, ['ensure', [value, options]]);
  assert.equal(api.undo(true), 'redo');
});

test('designer activation and document-load failures propagate without replacing an active document', async () => {
  const activationError = new Error('Designer activation failed');
  const cold = automation({loadDesigner: () => Promise.reject(activationError)});
  await assert.rejects(cold.load({}), error => error === activationError);
  const loadError = new Error('Document creation refused');
  const loaded = automation({designerTools: {
    load: () => Promise.reject(loadError),
    replace: () => { throw new Error('Must not fall back after a failed document load'); }
  }});
  await assert.rejects(loaded.load({}), error => error === loadError);
});
