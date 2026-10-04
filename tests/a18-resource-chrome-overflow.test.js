import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignerResourceDocument, DesignerTemplateScope} from '@sharpforge/designer';
import {DesignerChrome} from '../apps/studio/designer-chrome.js';
import {DesignerResourceContext, designerResourceActionAllowed} from '../apps/studio/designer-resource-context.js';
import {createDesignerActions} from '../apps/studio/designer-actions.js';
import {designerChromeDom} from './fixtures/a18-designer-chrome-dom.js';

const permitted = ['new', 'open', 'save', 'download', 'undo', 'redo', 'source', 'options'];
const forbidden = ['delete', 'duplicate', 'copy', 'paste', 'fit', 'preview', 'attach', 'apply', 'run-app', 'generate'];
const applications = ['attach', 'apply', 'run-app', 'generate'];

function fixture(t, width) {
  const dom = designerChromeDom();
  const model = createDesignerResourceDocument({templates: {
    Frame: {targetType: 'Button', root: {id: 'frame', type: 'Border', properties: {}, children: []}}
  }});
  const panels = new Map();
  for (const id of ['designer', 'designer-toolbox', 'designer-properties', 'designer-layout', 'designer-tree']) {
    const panel = dom.document.createElement('section');
    panels.set(id, panel);
    dom.document.body.append(panel);
  }
  const scroller = dom.document.createElement('div');
  panels.get('designer').append(scroller);
  const calls = [];
  const view = {
    session: {document: model, kind: 'resources', viewState: {mode: 'design'}},
    get document() { return this.templateScope?.document ?? this.session.document; },
    get controlsRoot() { return this.chrome.commandBar.element; },
    panel: id => panels.get(id), scroller, path: 'Palette.sfdesign.json',
    sourceSync: {session: null, renderControls: () => '', bindControls() {}, snapshot: () => ({state: 'disconnected', message: ''})},
    surface: {preview: {toolbar: dom.document.createElement('nav')}},
    docking: {activate: id => calls.push(['activate', id])},
    choose: async () => 'Resources', createDesignDocument: value => calls.push(['new', value.documentKind]),
    save: () => calls.push(['save']),
    download: (...args) => calls.push(['download', ...args]), options: {open: () => calls.push(['options'])}
  };
  const actions = createDesignerActions(view);
  const toolbar = dom.document.createElement('div');
  toolbar.className = 'design-toolbar';
  const buttons = new Map();
  for (const action of [...permitted, ...forbidden]) {
    const button = dom.document.createElement('button');
    button.dataset.designAction = action;
    button.textContent = action;
    button.onclick = () => actions.get(action)();
    toolbar.append(button);
    buttons.set(action, button);
  }
  panels.get('designer').prepend(toolbar);
  view.chrome = new DesignerChrome(view);
  view.chrome.install();
  view.chrome.commandBar.element.clientWidth = width;
  const context = new DesignerResourceContext(view);
  context.update();
  t.after(() => {
    view.templateScope?.document.dispose();
    context.dispose();
    view.chrome.dispose();
    model.dispose();
  });
  return {...dom, view, model, calls, buttons, actions, context, bar: view.chrome.commandBar};
}

for (const width of [320, 960]) {
  test(`resource chrome retains More and allowed overflow commands after installation at ${width}px`, async t => {
    const {view, model, bar, buttons, actions, calls, context} = fixture(t, width);
    const before = model.serialize();
    assert.equal(bar.button.dataset.designAction, 'more');
    assert.equal(bar.button.hidden, false);
    assert.equal(bar.button.inert, false);
    assert.equal(designerResourceActionAllowed(view, 'more'), true);
    assert.equal(view.scroller.inert, true);
    for (const action of permitted) {
      assert.equal(buttons.get(action).hidden, false, action);
      assert.equal(buttons.get(action).inert, false, action);
    }
    for (const action of forbidden) {
      assert.equal(buttons.get(action).hidden, true, action);
      assert.equal(buttons.get(action).inert, true, action);
      assert.throws(() => actions.get(action)(), {code: 'SFD1854'}, action);
    }
    await bar.button.fire('click');
    assert.equal(bar.opened, true);
    assert.equal(bar.overflow.hidden, false);
    assert.equal(bar.button.getAttribute('aria-expanded'), 'true');
    for (const action of ['new', 'save', 'download', 'options']) {
      assert.equal(bar.overflow.contains(buttons.get(action)), true, action);
      assert.equal(buttons.get(action).getClientRects().length, 1, action);
      await buttons.get(action).fire('click');
    }
    assert.deepEqual(calls, [['new', 'resources'], ['save'],
      ['download', 'Palette.sfdesign.json', before, 'application/json'], ['options']]);
    assert.equal(model.serialize(), before);
    context.update();
    assert.equal(bar.button.hidden, false, 'Refreshing an open dictionary must retain its chrome entry point.');
    assert.equal(bar.overflow.hidden, false);
    let prevented = false;
    bar.keydown({key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation() {}});
    assert.equal(prevented, true);
    assert.equal(bar.overflow.hidden, true);
    assert.equal(bar.button.getAttribute('aria-expanded'), 'false');
    assert.equal(view.controlsRoot.ownerDocument.activeElement, bar.button);
  });
}

test('resource chrome preserves overflow identity through template entry and exit while application actions stay blocked', async t => {
  const {view, model, bar, buttons, actions, context} = fixture(t, 480);
  const toggle = bar.button;
  const save = buttons.get('save');
  const before = model.serialize();
  const scope = new DesignerTemplateScope(model, 'Frame');
  view.templateScope = scope;
  context.update();
  assert.equal(bar.button, toggle);
  assert.equal(toggle.hidden, false);
  assert.equal(view.scroller.inert, false);
  assert.equal(buttons.get('delete').hidden, false);
  assert.equal(buttons.get('preview').hidden, false);
  for (const action of applications) {
    assert.equal(buttons.get(action).hidden, true, action);
    assert.throws(() => actions.get(action)(), {code: 'SFD1854'}, action);
  }
  scope.cancel();
  view.templateScope = null;
  scope.document.dispose();
  context.update();
  assert.equal(bar.button, toggle);
  assert.equal(buttons.get('save'), save);
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.inert, false);
  assert.equal(view.scroller.inert, true);
  assert.equal(buttons.get('delete').hidden, true);
  assert.equal(buttons.get('preview').hidden, true);
  await toggle.fire('click');
  assert.equal(bar.overflow.hidden, false);
  assert.equal(save.getClientRects().length, 1);
  assert.equal(model.serialize(), before);
  assert.equal(model.undoStack.length, 0);
});
