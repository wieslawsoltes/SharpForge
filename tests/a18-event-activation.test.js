import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign, designerMetadata} from '@sharpforge/designer';
import {CONTROLS, eventsFor} from '@sharpforge/framework';
import {activateDesignerEvent, bindDesignerEventActivation, defaultDesignerEvent} from '../apps/studio/designer-event-actions.js';
import {studioHarness, sourceState, constructionUri} from './fixtures/a18-studio-harness.js';

function eventRow() {
  const listeners = new Map();
  const row = {addEventListener: (name, callback) => listeners.set(name, callback), closest: () => null};
  const fire = (type, {target = row, key} = {}) => {
    const event = {target, key, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }};
    return {event, result: listeners.get(type)(event)};
  };
  return {row, fire};
}

test('A18 default events are explicit supported designer capabilities, never arbitrary event ordering', () => {
  const metadata = new Map(designerMetadata.map(type => [type.name, type]));
  assert.equal(metadata.get('Button').defaultEvent, 'Click');
  assert.equal(metadata.get('TextBox').defaultEvent, 'TextChanged');
  assert.equal(metadata.get('ToggleSwitch').defaultEvent, 'Toggled');
  assert.equal(metadata.get('Grid').defaultEvent, null);
  for (const type of designerMetadata) {
    assert(type.defaultEvent === null || Object.hasOwn(eventsFor(type.type), type.defaultEvent), type.type);
  }
  const document = new DesignDocument(createDesign());
  const view = {document};
  assert.equal(defaultDesignerEvent(view, 'action'), 'Click');
  assert.equal(defaultDesignerEvent(view, 'canvas'), null);
  assert.equal(defaultDesignerEvent(view, 'missing'), null);
  view.templateScope = {};
  assert.equal(defaultDesignerEvent(view, 'action'), null);
  document.dispose();
});

test('A18 event-row double-click creates through the real worker, then navigates without a second source transaction', async context => {
  const harness = await studioHarness(context, {subscription: ''});
  await harness.connect();
  const {row, fire} = eventRow();
  bindDesignerEventActivation(row, () => activateDesignerEvent(harness.view, 'action', 'Click'));
  const activated = fire('dblclick');
  const result = await activated.result;
  assert.equal(activated.event.prevented, true);
  assert.equal(activated.event.stopped, true);
  assert.equal(result.ok, true);
  assert.equal(result.existing, false);
  assert(harness.file(constructionUri).text.includes('action.Click += ' + result.handler + ';'));
  assert.equal(harness.history.past.length, 1);
  assert.equal(harness.sync.session.analysis.compilationSucceeded, true);
  const before = sourceState(harness);
  const existing = await fire('dblclick').result;
  assert.equal(existing.existing, true);
  assert.deepEqual(sourceState(harness), before);
  assert.equal(harness.navigation.length, 2);
  assert.equal(harness.document.node('action').type, CONTROLS + 'Button');
});

for (const subscription of ['action.Click += (sender, args) => { action.Content = "Lambda"; };',
  'action.Click += OnClick; action.Click += OnOther;']) {
  test('A18 protected default-event activation navigates through the worker even in a read-only source preview: ' + subscription, async context => {
    const harness = await studioHarness(context, {subscription});
    await harness.connect();
    harness.sync.session.analysis.readOnly = true;
    harness.state.readOnly = true;
    const before = sourceState(harness);
    const result = await activateDesignerEvent(harness.view, 'action', defaultDesignerEvent(harness.view, 'action'));
    assert.equal(result.existing, true);
    assert.equal(result.readOnly, true);
    assert.deepEqual(result.changes, []);
    assert.deepEqual(sourceState(harness), before);
    assert.equal(harness.navigation.length, 1);
  });
}

test('A18 inherited previews, template parts and disconnected designs reject event creation before any source request', async context => {
  const harness = await studioHarness(context, {subscription: ''});
  await harness.connect();
  const before = sourceState(harness);
  const requests = harness.compiler.requests.length;
  harness.sync.session.analysis.readOnly = true;
  await assert.rejects(activateDesignerEvent(harness.view, 'action', 'Click'), {code: 'SFD1842'});
  harness.sync.session.analysis.readOnly = false;
  harness.view.templateScope = {};
  await assert.rejects(activateDesignerEvent(harness.view, 'action', 'Click'), /template parts/);
  delete harness.view.templateScope;
  await assert.rejects(activateDesignerEvent({document: harness.document}, 'action', 'Click'), /Connect a C#/);
  assert.deepEqual(sourceState(harness), before);
  assert.equal(harness.compiler.requests.length, requests);
});

test('A18 event rows preserve inner editor double-click and provide keyboard activation on the row', async () => {
  const {row, fire} = eventRow();
  let activations = 0;
  bindDesignerEventActivation(row, () => ++activations);
  const inner = fire('dblclick', {target: {closest: () => ({tagName: 'SELECT'})}});
  assert.equal(inner.event.prevented, false);
  assert.equal(activations, 0);
  assert.equal(fire('keydown', {key: 'Enter'}).result, 1);
  assert.equal(fire('keydown', {key: 'Escape'}).result, undefined);
  assert.equal(activations, 1);
  assert.equal(row.tabIndex, 0);
});
