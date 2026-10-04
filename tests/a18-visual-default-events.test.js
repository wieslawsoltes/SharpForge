import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesign, DesignDocument} from '@sharpforge/designer';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {DesignerSurfaceCommands} from '../apps/studio/designer-surface-commands.js';
import {designerInlineTextCapability} from '../apps/studio/designer-surface-text.js';

function fixture() {
  const document = new DesignDocument(createDesign());
  document.select('action');
  const calls = [];
  const view = {document, safe: callback => callback(), host: {nodes: new Map()},
    sourceSync: {session: {analysis: {uri: 'View.cs', bindings: {}}},
      createEventHandler: async request => { calls.push(['create', request]); return {ok: true}; },
      navigateEvent: (id, event) => calls.push(['navigate', id, event])}};
  const controller = {view, text: {begin: id => calls.push(['inline', id])}, finishKeyboard() {}};
  const event = {target: {closest: () => ({dataset: {sfId: 'action'}})}, timeStamp: 200, detail: 2,
    clientX: 20, clientY: 30, preventDefault() {}, stopPropagation() {}};
  return {document, controller, view, event, calls};
}

test('normal Button double-click creates its declared default Click event through the shared source transaction', async () => {
  const {controller, event, calls} = fixture();
  await DesignerSurfaceController.prototype.doubleClick.call(controller, event);
  assert.deepEqual(calls, [['create', {nodeId: 'action', event: 'Click'}]]);
});

test('existing protected lambda default event navigates without creating or rewriting a handler', async () => {
  const {controller, view, event, calls} = fixture();
  view.sourceSync.session.analysis.bindings.action = {events: {Click: {dynamic: true, reason: 'lambda', subscriptions: [
    {protected: true, location: {uri: 'View.cs', start: 70, end: 110}}
  ]}}};
  await DesignerSurfaceController.prototype.doubleClick.call(controller, event);
  assert.deepEqual(calls, [['navigate', 'action', 'Click']]);
  const commands = new DesignerSurfaceCommands(controller);
  assert.equal(commands.enabled('go-handler'), true);
  commands.run('go-handler');
  assert.deepEqual(calls.at(-1), ['navigate', 'action', 'Click']);
});

test('slow double-click retains inline editing while readonly previews cannot create a default handler', async () => {
  const {controller, view, event, calls} = fixture();
  DesignerSurfaceController.prototype.click.call(controller, {...event, detail: 1, timeStamp: 100});
  DesignerSurfaceController.prototype.click.call(controller, {...event, detail: 1, timeStamp: 900});
  assert.deepEqual(calls, [['inline', 'action']]);
  calls.length = 0;
  controller.doubleClickInterval = null;
  view.sourceSync.session.analysis.readOnly = true;
  await assert.rejects(DesignerSurfaceController.prototype.doubleClick.call(controller, event), {code: 'SFD1842'});
  assert.deepEqual(calls, []);
});

test('inline menu capability rejects containers, images, component content and protected text before invocation', () => {
  const {document, controller, view} = fixture();
  const commands = new DesignerSurfaceCommands(controller);
  assert.equal(commands.enabled('inline-text'), true);
  document.select('canvas');
  assert.equal(commands.enabled('inline-text'), false);
  const image = document.add('Image', 'canvas');
  document.select(image);
  assert.equal(commands.enabled('inline-text'), false);
  document.select('action');
  view.componentDefinition = () => ({path: 'Card.cs'});
  assert.equal(designerInlineTextCapability(view).editable, false);
  view.componentDefinition = () => null;
  view.sourceSync.session.analysis.bindings.action = {properties: {Content: {dynamic: true}}};
  assert.equal(commands.enabled('inline-text'), false);
  assert.throws(() => commands.run('inline-text'), {code: 'SFD_COMMAND_DISABLED'});
  assert.equal(commands.enabled('go-handler'), false);
});
