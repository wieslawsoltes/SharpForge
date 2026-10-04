import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationMemberService } from '../packages/winui-controls/src/automation/member-service.js';
import { automationFixture, automationNode } from './helpers/a16-automation.js';

const peers = 'Microsoft.UI.Xaml.Automation.Peers.';

function fixture() {
  const graph = automationFixture([automationNode('first', 'Button', { Content: 'First' }), automationNode('second', 'Button')]);
  const states = new WeakMap();
  const bases = new Map([
    ['CustomButtonPeer', peers + 'ButtonAutomationPeer'],
    [peers + 'ButtonAutomationPeer', peers + 'FrameworkElementAutomationPeer'],
    [peers + 'FrameworkElementAutomationPeer', peers + 'AutomationPeer'],
    ['IndependentPeer', peers + 'AutomationPeer']
  ]);
  const context = { id: value => value.id, typeOf: value => value.type, baseType: type => bases.get(type),
    native: value => value, modelReferences: new WeakMap(), services: {}, state(receiver, key, factory) {
      let values = states.get(receiver);
      if (!values) { values = new Map(); states.set(receiver, values); }
      if (!values.has(key) && factory) values.set(key, factory());
      return values.get(key);
    } };
  const service = new AutomationMemberService(context, { tree: graph.tree, callVirtual: () => ({ handled: false }) });
  return { ...graph, context, service, dispose() { service.dispose(); graph.tree.dispose(); } };
}

test('the parameterless framework base defers an element peer until its immutable owner is available', () => {
  const value = fixture();
  const receiver = { id: 'peer', type: 'CustomButtonPeer' };
  try {
    value.service.initializePeer(receiver, peers + 'AutomationPeer', []);
    assert.equal(value.context.state(receiver, 'nativeModel'), undefined);
    value.service.initializePeer(receiver, peers + 'ButtonAutomationPeer', [value.nodes.get('first')]);
    const handle = value.context.state(receiver, 'nativeModel');
    assert.equal(handle.model.id, 'first');
    assert.equal(handle.model.GetName(), 'First');
    value.service.initializePeer(receiver, peers + 'ButtonAutomationPeer', [value.nodes.get('first')]);
    assert.equal(value.context.state(receiver, 'nativeModel'), handle);
    assert.throws(() => value.service.initializePeer(receiver, peers + 'ButtonAutomationPeer', [value.nodes.get('second')]),
      /Peer owner cannot change/);
    assert.equal(handle.model.id, 'first');
  } finally { value.dispose(); }
});

test('a true standalone AutomationPeer subclass still initializes at the parameterless base', () => {
  const value = fixture();
  const receiver = { id: 'standalone', type: 'IndependentPeer' };
  try {
    value.service.initializePeer(receiver, peers + 'AutomationPeer', []);
    const handle = value.context.state(receiver, 'nativeModel');
    assert.equal(handle.model.standalone, true);
    assert.equal(handle.owner, null);
    assert.equal(handle.model.id, 'automation:standalone');
    assert.equal(handle.model.GetName(), '');
  } finally { value.dispose(); }
});
