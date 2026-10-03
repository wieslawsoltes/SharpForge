import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign} from '@sharpforge/designer';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {DesignerSurfaceCommands} from '../apps/studio/designer-surface-commands.js';

function fixture() {
  const document = new DesignDocument(createDesign());
  document.select('action');
  const calls = [];
  const view = {document, stage: {ownerDocument: {}}, preview: false, sourceSync: {},
    host: {nodes: new Map([['instance', {designId: 'action'}]])}, safe: callback => callback(),
    componentDefinition: id => id === 'action' ? {path: 'Card.cs'} : null,
    openComponent: id => calls.push(['component', id]), menu: {show: options => calls.push(['menu', options.items])}};
  const controller = {view, text: {begin: id => calls.push(['text', id])}, finishKeyboard: () => calls.push(['finish-keyboard'])};
  const event = {target: {closest: () => ({dataset: {sfId: 'instance'}})},
    preventDefault: () => calls.push(['prevent-default']), stopPropagation: () => calls.push(['stop-propagation'])};
  return {view, controller, event, calls};
}

test('component double-click opens the defining document and ordinary text controls retain inline editing', () => {
  const {view, controller, event, calls} = fixture();
  DesignerSurfaceController.prototype.doubleClick.call(controller, event);
  assert.deepEqual(calls, [['prevent-default'], ['stop-propagation'], ['component', 'action']]);
  calls.length = 0;
  view.componentDefinition = () => null;
  view.host.nodes.set('instance', {designId: 'title'});
  DesignerSurfaceController.prototype.doubleClick.call(controller, event);
  assert.deepEqual(calls, [['prevent-default'], ['stop-propagation'], ['text', 'title']]);
  calls.length = 0;
  view.preview = true;
  DesignerSurfaceController.prototype.doubleClick.call(controller, event);
  assert.deepEqual(calls, []);
});

test('Open component document appears only for one resolved component and uses the shared command path', () => {
  const {view, controller, event, calls} = fixture();
  const commands = new DesignerSurfaceCommands(controller);
  commands.context(event);
  const items = calls.find(([kind]) => kind === 'menu')[1];
  const open = items.find(item => item?.label === 'Open component document');
  assert.equal(open.enabled, true);
  open.action();
  assert.deepEqual(calls.slice(-2), [['finish-keyboard'], ['component', 'action']]);
  view.document.select(['action', 'title']);
  assert.equal(commands.enabled('open-component'), false);
  assert.throws(() => commands.run('open-component'), {code: 'SFD_COMMAND_DISABLED'});
  view.document.select('title');
  calls.length = 0;
  commands.context(event);
  assert(!calls[0][1].some(item => item?.label === 'Open component document'));
});
