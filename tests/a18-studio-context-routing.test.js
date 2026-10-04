import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesign, DesignDocument} from '@sharpforge/designer';
import {StudioContextMenuRouter} from '../apps/studio/menus/document-context.js';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {DesignerSurfaceCommands} from '../apps/studio/designer-surface-commands.js';
import {resourceDom} from './fixtures/a18-resource-dom.js';

function fixture() {
  const {document} = resourceDom();
  const listeners = new Map();
  document.addEventListener = (type, callback, capture) => {
    assert.equal(capture, true);
    const callbacks = listeners.get(type) ?? new Set();
    callbacks.add(callback);
    listeners.set(type, callbacks);
  };
  document.removeEventListener = (type, callback, capture) => {
    assert.equal(capture, true);
    listeners.get(type)?.delete(callback);
  };
  const element = (tag, {className = '', dataset = {}, parent = document.body} = {}) => {
    const value = document.createElement(tag);
    value.className = className;
    Object.assign(value.dataset, dataset);
    const matches = value.matches.bind(value);
    value.matches = selector => selector.split(',').some(part => matches(part.trim()));
    value.getBoundingClientRect = () => ({left: 100, top: 200, width: 80, height: 40});
    parent.append(value);
    return value;
  };
  const source = element('div', {dataset: {sourceUri: 'View.cs'}});
  const code = element('div', {className: 'designer-document-code', parent: source});
  const input = element('textarea', {className: 'sf-input', parent: code});
  const design = element('div', {className: 'designer-document-surface', parent: source});
  const scroller = element('div', {className: 'design-scroll', parent: design});
  const stage = element('div', {className: 'design-stage', parent: scroller});
  const control = element('button', {parent: stage});
  const instance = {uri: 'View.cs', input};
  const menus = [];
  const routes = [];
  const route = (kind, ...values) => {
    routes.push([kind, ...values]);
    return [{label: kind}];
  };
  const router = new StudioContextMenuRouter({
    editors: new Map([['View.cs', instance]]), menu: {show: options => menus.push(options)},
    dockItems: id => route('dock', id), breakpointItems: (uri, line) => route('breakpoint', uri, line),
    editorItems: editor => route('editor', editor), panelItems: (id, target) => route('panel', id, target)
  });
  const capture = event => {
    for (const callback of listeners.get(event.type) ?? []) {
      callback(event);
      if (event.immediateStopped) break;
    }
  };
  return {document, listeners, element, source, code, input, scroller, stage, control, instance, menus, routes, router, capture};
}

function menuEvent(target, options = {}) {
  return {
    type: 'keydown', key: 'F10', shiftKey: true, target, clientX: 25, clientY: 35,
    defaultPrevented: false, stopped: false, immediateStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; this.immediateStopped = true; },
    ...options
  };
}

test('Studio capture yields both keyboard menus to the real designer component command route', () => {
  const host = fixture();
  const model = new DesignDocument(createDesign());
  model.select('action');
  const opened = [];
  const view = {
    document: model, scroller: host.scroller, stage: host.stage, preview: false, sourceSync: {},
    componentDefinition: id => id === 'action' ? {path: 'Card.cs'} : null,
    openComponent: id => opened.push(id), safe: action => action(),
    menu: {show: options => host.menus.push(options)}
  };
  const controller = {view, finishKeyboard() {}};
  const commands = new DesignerSurfaceCommands(controller);
  controller.context = event => commands.context(event);
  const dispose = host.router.install(host.document);
  try {
    for (const options of [{key: 'F10', shiftKey: true}, {key: 'ContextMenu', shiftKey: false}]) {
      for (const target of [host.scroller, host.control]) {
        const event = menuEvent(target, options);
        host.capture(event);
        assert.equal(event.defaultPrevented, false, 'document capture must leave the surface event untouched');
        assert.equal(event.immediateStopped, false);
        assert.deepEqual(host.routes, [], 'the shared source ancestor must not select editor items');
        assert.equal(DesignerSurfaceController.prototype.keydown.call(controller, event), true);
        assert.equal(event.defaultPrevented, true);
        assert.equal(event.stopped, true);
        const menu = host.menus.at(-1);
        assert.equal(menu.document, host.document);
        const open = menu.items.find(item => item?.label === 'Open component document');
        assert.equal(open.enabled, true);
        open.action();
      }
    }
    assert.deepEqual(opened, ['action', 'action', 'action', 'action']);
  } finally {
    dispose();
    model.dispose();
  }
});

test('pointer menus inside nested designer controls remain available to the surface', () => {
  const host = fixture();
  host.router.install(host.document);
  const event = menuEvent(host.control, {type: 'contextmenu'});
  host.capture(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, false);
  assert.deepEqual(host.menus, []);
  assert.deepEqual(host.routes, []);
});

test('Code pane keyboard and pointer menus preserve the source editor, input anchor and coordinates', () => {
  const host = fixture();
  host.router.install(host.document);
  for (const target of [host.code, host.input]) {
    const keyboard = menuEvent(target);
    host.capture(keyboard);
    assert.deepEqual(host.routes.at(-1), ['editor', host.instance]);
    assert.equal(keyboard.immediateStopped, true);
    assert.equal(host.menus.at(-1).anchor, host.input);
    assert.deepEqual([host.menus.at(-1).x, host.menus.at(-1).y], [140, 230]);
  }
  const adaptedInput = host.element('textarea');
  host.instance.keymapAdapter = {cm: {getInputField: () => adaptedInput}};
  const pointer = menuEvent(host.input, {type: 'contextmenu'});
  host.capture(pointer);
  assert.equal(pointer.defaultPrevented, true);
  assert.equal(host.menus.at(-1).anchor, adaptedInput);
  assert.deepEqual([host.menus.at(-1).x, host.menus.at(-1).y], [25, 35]);
});

test('source gutter, dock tabs and tools retain their distinct menu providers', () => {
  const host = fixture();
  host.router.install(host.document);
  const gutter = host.element('span', {dataset: {line: '42'}, parent: host.code});
  host.capture(menuEvent(gutter, {type: 'contextmenu'}));
  assert.deepEqual(host.routes.at(-1), ['breakpoint', 'View.cs', 42]);
  const tab = host.element('button', {dataset: {dockTab: 'source:View.cs'}, parent: host.source});
  host.capture(menuEvent(tab));
  assert.deepEqual(host.routes.at(-1), ['dock', 'source:View.cs']);
  const tool = host.element('div', {dataset: {tool: 'output'}});
  const row = host.element('span', {parent: tool});
  host.capture(menuEvent(row));
  assert.deepEqual(host.routes.at(-1), ['panel', 'output', row]);
});

test('owned menus, modal content, trees, handled events and ordinary keys are not recaptured', () => {
  const host = fixture();
  host.router.install(host.document);
  for (const className of ['sf-menu', 'sf-tree']) {
    const owner = host.element('div', {className, parent: host.source});
    host.capture(menuEvent(host.element('button', {parent: owner})));
  }
  const modal = host.element('div', {parent: host.source});
  modal.id = 'modal-backdrop';
  host.capture(menuEvent(modal));
  host.capture(menuEvent(host.input, {defaultPrevented: true}));
  host.capture(menuEvent(host.input, {key: 'F10', shiftKey: false}));
  host.capture(menuEvent(host.input, {key: 'a'}));
  const missing = host.element('div', {dataset: {sourceUri: 'Missing.cs'}});
  host.capture(menuEvent(missing));
  assert.deepEqual(host.routes, []);
  assert.deepEqual(host.menus, []);
});

test('main and popout installation is independent, idempotent, and removable', () => {
  const main = fixture();
  const child = fixture();
  const dispose = main.router.install(main.document);
  assert.equal(main.router.install(main.document), dispose);
  const disposeChild = main.router.install(child.document);
  assert.equal(main.listeners.get('keydown').size, 1);
  assert.equal(child.listeners.get('keydown').size, 1);
  child.capture(menuEvent(child.input, {key: 'ContextMenu', shiftKey: false}));
  assert.equal(main.menus.length, 1);
  assert.equal(main.menus[0].document, child.document);
  dispose();
  assert.equal(main.listeners.get('keydown').size, 0);
  assert.equal(main.listeners.get('contextmenu').size, 0);
  const reinstall = main.router.install(main.document);
  dispose();
  assert.equal(main.router.install(main.document), reinstall);
  assert.equal(main.listeners.get('keydown').size, 1);
  disposeChild();
  assert.equal(child.listeners.get('keydown').size, 0);
  reinstall();
});
