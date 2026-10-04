import test from 'node:test';
import assert from 'node:assert/strict';
import { automationFixture, automationNode } from './helpers/a16-automation.js';
import { serializeAutomationPeerState, validateAutomationPeerState } from '../packages/winui-controls/src/automation/state-transport.js';
import { AutomationControlType, PatternInterface } from '../packages/winui-controls/src/automation/enums.js';

test('custom peer values cross a structured-clone boundary and preserve retained peer identity', () => {
  const { tree, peer } = automationFixture([automationNode('root', 'Button', { Content: 'Original' })]);
  const original = peer('root');
  const packet = serializeAutomationPeerState(original);
  assert.throws(() => { packet.Name = 'cannot mutate'; }, TypeError);
  const restored = structuredClone(packet);
  tree.remote.apply('root', restored);
  assert.equal(peer('root'), original);
  assert.equal(original.GetName(), 'Original');
});

test('remote custom Invoke executes the explicit host action channel', () => {
  const calls = [];
  const { tree, peer } = automationFixture([automationNode('root', 'Button', { Content: 'Original' })],
    { onAction: (...args) => calls.push(args) });
  const retained = peer('root');
  const packet = structuredClone(serializeAutomationPeerState(retained));
  packet.Name = 'Custom accessible label';
  packet.ControlType = AutomationControlType.Group;
  packet.Patterns[PatternInterface.Invoke].native = false;
  tree.remote.apply('root', packet);
  assert.equal(peer('root'), retained);
  assert.equal(retained.GetName(), 'Custom accessible label');
  assert.equal(retained.GetAutomationControlType(), AutomationControlType.Group);
  retained.GetPattern(PatternInterface.Invoke).Invoke();
  assert.deepEqual(calls, [['root', 'Invoke', [], PatternInterface.Invoke]]);
  assert.equal(tree.snapshot().roots[0].name, 'Custom accessible label');
});

test('malformed or private state is rejected before changing published semantics', () => {
  const fixture = automationFixture([automationNode('root', 'PasswordBox')]);
  const packet = structuredClone(serializeAutomationPeerState(fixture.peer('root')));
  packet.IsPassword = false;
  assert.throws(() => fixture.tree.remote.apply('root', packet), /Password|password/);
  const invalid = { ...packet, Name: () => 'not data' };
  assert.throws(() => validateAutomationPeerState(invalid), /SFAX018/);
  assert.equal(fixture.peer('root').IsPassword(), true);
});
