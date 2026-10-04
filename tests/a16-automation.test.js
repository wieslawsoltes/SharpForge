import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationControlType, AutomationEvents, AutomationNotificationProcessing, PatternInterface, FrameworkElementAutomationPeer,
  getAutomationProperty, setAutomationProperty, automationElementId, automationAttributes, auditAutomationSnapshot,
  registerAutomationAdapters } from '../packages/winui-controls/src/automation/index.js';
import { automationFixture, automationNode as node } from './helpers/a16-automation.js';

test('custom OnCreateAutomationPeer core methods appear in retained snapshots', () => {
  class GaugePeer extends FrameworkElementAutomationPeer {
    GetNameCore() { return 'Rotor speed'; }
    GetAutomationControlTypeCore() { return AutomationControlType.Slider; }
    GetClassNameCore() { return 'RotorGauge'; }
  }
  const fixture = automationFixture([node('root', 'Grid', {}, ['gauge']), node('gauge', 'RotorGauge')], {
    createPeer: (owner, tree) => owner.type === 'RotorGauge' ? new GaugePeer(owner, tree) : null
  });
  const entry = fixture.tree.snapshot().roots[0].children[0];
  assert.equal(entry.name, 'Rotor speed');
  assert.equal(entry.controlType, AutomationControlType.Slider);
  assert.equal(entry.className, 'RotorGauge');
  const peer = fixture.peer('gauge');
  fixture.tree.dispose();
  assert.throws(() => peer.GetName(), /disposed/);
});

test('suppressed intermediate peers retain depth-first visual order for their descendants', () => {
  const fixture = automationFixture([node('root', 'Grid', {}, ['raw', 'last']),
    node('raw', 'Border', {}, ['first', 'second']), node('first', 'Button', { Content: 'First' }),
    node('second', 'Button', { Content: 'Second' }), node('last', 'Button', { Content: 'Last' })], {
    tryCreatePeer: owner => owner.id === 'raw' ? { handled: true, value: null } : { handled: false }
  });
  assert.deepEqual(fixture.peer('root').GetChildren().map(peer => peer.id), ['first', 'second', 'last']);
  fixture.tree.dispose();
  assert.equal(fixture.tree.peerClasses.size, 0);
});

test('internal Name does not overwrite content labels and attached relationship ids do not collide', () => {
  const fixture = automationFixture([node('root', 'Grid', {}, ['button', 'label', 'edit']),
    node('button', 'Button', { Name: 'ImplementationButton', Content: 'Publish' }),
    node('label', 'TextBlock', { Text: 'Repository' }),
    node('edit', 'TextBox', { Name: 'PrivateMember', 'AutomationProperties.LabeledBy': { $ref: 'label' } })]);
  assert.equal(fixture.peer('button').GetName(), 'Publish');
  assert.equal(fixture.peer('edit').GetName(), 'Repository');
  const attrs = automationAttributes(fixture.peer('edit'), fixture.tree);
  assert.equal(attrs['aria-labelledby'], automationElementId('test-root', 'label'));
  assert.notEqual(automationElementId('root', 'a:b'), automationElementId('root', 'a-b'));
  setAutomationProperty(fixture.nodes.get('button'), 'Name', 'Deploy', () => fixture.tree.names.clear());
  assert.equal(fixture.peer('button').GetName(), 'Deploy');
  assert.throws(() => setAutomationProperty(fixture.nodes.get('button'), 'PositionInSet', -2), /PositionInSet/);
  assert.throws(() => setAutomationProperty(fixture.nodes.get('button'), 'LabeledBy', [{}]), /references/);
});

test('all automation attached properties have stable bridge mappings', () => {
  const fixture = automationFixture([node('root', 'Grid', {}, ['label', 'description', 'edit']),
    node('label', 'TextBlock', { Text: 'Amount' }), node('description', 'TextBlock', { Text: 'In dollars' }), node('edit', 'TextBox')]);
  const owner = fixture.nodes.get('edit');
  const properties = { Name: 'Amount', AutomationId: 'amount-edit', HelpText: 'Required amount',
    LabeledBy: { $ref: 'label' }, DescribedBy: [{ $ref: 'description' }], LiveSetting: 1, HeadingLevel: 2,
    LandmarkType: 3, AccessibilityView: 2, ItemStatus: 'Valid', PositionInSet: 2, SizeOfSet: 5,
    IsRequiredForForm: true, FullDescription: 'Enter an amount', LocalizedLandmarkType: 'Invoice' };
  for (const [name, value] of Object.entries(properties)) {
    setAutomationProperty(owner, name, value);
    assert.deepEqual(getAutomationProperty(owner, name), value);
  }
  const attrs = automationAttributes(fixture.peer('edit'), fixture.tree);
  assert.equal(attrs['aria-live'], 'polite');
  assert.equal(attrs['aria-level'], 2);
  assert.equal(attrs['aria-required'], 'true');
  assert.equal(attrs['aria-posinset'], 2);
  assert.equal(attrs['aria-setsize'], 5);
  assert.equal(attrs['aria-description'], 'Required amount. Enter an amount. Valid');
  assert.equal(attrs['aria-describedby'], automationElementId('test-root', 'description'));
  assert.equal(attrs['data-automation-id'], 'amount-edit');
});

test('pattern actions use control invoke hooks and reject invalid, disabled and read-only writes', () => {
  const fixture = automationFixture([node('root', 'Grid', {}, ['button', 'toggle', 'text', 'range', 'item', 'expand']),
    node('button', 'Button', { Content: 'Run' }), node('toggle', 'CheckBox', { Content: 'Check', IsChecked: false }),
    node('text', 'TextBox', { Header: 'Value', Text: '' }), node('range', 'Slider', { Header: 'Volume', Minimum: 0, Maximum: 10 }),
    node('item', 'ListViewItem', { Content: 'One' }), node('expand', 'Expander', { Header: 'Details' })], {
    invoke(owner, method, [value]) {
      if (method === 'Toggle') owner.properties.IsChecked = !owner.properties.IsChecked;
      if (method === 'SetValue') owner.properties[owner.type === 'TextBox' ? 'Text' : 'Value'] = value;
      if (method === 'Select') owner.properties.IsSelected = true;
      if (method === 'Expand') owner.properties.IsExpanded = true;
    }
  });
  fixture.peer('button').GetPattern(PatternInterface.Invoke).Invoke();
  fixture.peer('toggle').GetPattern(PatternInterface.Toggle).Toggle();
  fixture.peer('text').GetPattern(PatternInterface.Value).SetValue('hello');
  fixture.peer('range').GetPattern(PatternInterface.RangeValue).SetValue(5);
  fixture.peer('item').GetPattern(PatternInterface.SelectionItem).Select();
  fixture.peer('expand').GetPattern(PatternInterface.ExpandCollapse).Expand();
  assert.deepEqual(fixture.actions.map(action => action.method), ['Invoke', 'Toggle', 'SetValue', 'SetValue', 'Select', 'Expand']);
  assert.equal(fixture.peer('toggle').GetPattern('Toggle').ToggleState, 1);
  assert.equal(fixture.peer('item').GetPattern('SelectionItem').IsSelected, true);
  assert.equal(fixture.peer('expand').GetPattern('ExpandCollapse').ExpandCollapseState, 1);
  assert.throws(() => fixture.peer('range').GetPattern('RangeValue').SetValue(11), /outside/);
  fixture.nodes.get('text').properties.IsReadOnly = true;
  assert.throws(() => fixture.peer('text').GetPattern('Value').SetValue('denied'), /read-only/);
  fixture.nodes.get('root').properties.IsEnabled = false;
  assert.throws(() => fixture.peer('button').GetPattern('Invoke').Invoke(), /disabled/);
});

test('password peers expose no text/value or secret property events', () => {
  const fixture = automationFixture([node('root', 'Grid', {}, ['password']), node('password', 'PasswordBox', { Header: 'Password' })]);
  const peer = fixture.peer('password');
  assert.equal(peer.IsPassword(), true);
  assert.equal(peer.GetPattern('Value'), null);
  assert.equal(peer.GetPattern('Text'), null);
  peer.RaisePropertyChangedEvent('Password', 'old secret', 'new secret');
  peer.RaisePropertyChangedEvent('Value', 'old secret', 'new secret');
  assert.deepEqual(fixture.tree.events.flush(), []);
  assert.throws(() => peer.RaiseNotificationEvent(4, 2, 'secret'), /Password/);
  assert.ok(!JSON.stringify(fixture.tree.snapshot()).includes('secret'));
});

test('property writes and notifications coalesce, then disposal cancels queued deliveries', () => {
  const fixture = automationFixture([node('root', 'Button', { Content: 'Run' })]);
  const peer = fixture.peer('root');
  peer.RaisePropertyChangedEvent('Name', 'one', 'two');
  peer.RaisePropertyChangedEvent('Name', 'two', 'three');
  peer.RaiseNotificationEvent(4, AutomationNotificationProcessing.MostRecent, 'first', 'load');
  peer.RaiseNotificationEvent(4, AutomationNotificationProcessing.MostRecent, 'latest', 'load');
  fixture.tree.events.flush();
  assert.equal(fixture.events.length, 2);
  assert.equal(fixture.events[0].oldValue, 'one');
  assert.equal(fixture.events[0].newValue, 'three');
  assert.equal(fixture.events[1].text, 'latest');
  peer.RaiseAutomationEvent(AutomationEvents.InvokePatternOnInvoked);
  fixture.tree.dispose();
  assert.deepEqual(fixture.tree.events.flush(), []);
  assert.throws(() => peer.GetName(), /disposed/);
});

test('recursive custom peer creation, invalid types and structurally invalid snapshots are diagnosed', () => {
  const recursive = automationFixture([node('root', 'Grid')], { createPeer: (owner, tree) => tree.getPeer(owner.id) });
  assert.throws(() => recursive.peer('root'), /recursively/);
  const fixture = automationFixture([node('root', 'Button')]);
  const report = auditAutomationSnapshot(fixture.tree.snapshot());
  assert.equal(report.violations[0].rule, 'accessible-name');
  assert.throws(() => fixture.peer('root').GetPattern(999), /Invalid pattern/);
  registerAutomationAdapters(fixture.host.registry);
  for (const descriptor of fixture.host.registry.entries.values()) assert.equal(typeof descriptor.createAutomationPeer, 'function');
});

test('CurrentThenMostRecent preserves the first and last pending activity notifications', () => {
  const { tree, peer, events } = automationFixture([node('root', 'Button', { Content: 'Save' })]);
  for (const text of ['First', 'Middle', 'Last']) peer('root').RaiseNotificationEvent(4, 4, text, 'same-activity');
  tree.events.flush();
  assert.deepEqual(events.filter(value => value.text).map(value => value.text), ['First', 'Last']);
});

test('suppressed custom peers promote visible descendants into their parent automation children', () => {
  const { tree, peer } = automationFixture([node('root', 'Grid', {}, ['suppressed']),
    node('suppressed', 'Grid', {}, ['leaf']), node('leaf', 'Button', { Content: 'Leaf' })],
  { tryCreatePeer: node => node.id === 'suppressed' ? { handled: true, value: null } : { handled: false } });
  assert.deepEqual(peer('root').GetChildren().map(value => value.id), ['leaf']);
  assert.equal(tree.snapshot().roots[0].children[0].name, 'Leaf');
});
