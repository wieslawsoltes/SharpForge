import test from 'node:test';
import assert from 'node:assert/strict';
import {DockLayout, DockHost} from '@sharpforge/docking';
import {dockHostDom} from './fixtures/a18-dock-host-dom.js';

function fixture(t) {
  const dom = dockHostDom();
  const layout = new DockLayout([
    {id: 'source', kind: 'document'}, {id: 'other', kind: 'document'}, {id: 'tool', kind: 'tool'}
  ]);
  layout.open('source');
  layout.open('other');
  layout.activate('source');
  layout.dockRoot('tool', 'left');
  const panels = new Map();
  const buttons = new Map();
  const clicks = [];
  for (const id of layout.panels.keys()) {
    const panel = dom.document.createElement('section');
    const button = dom.document.createElement('button');
    button.onclick = () => clicks.push(id);
    panel.append(button);
    panels.set(id, panel);
    buttons.set(id, button);
  }
  const activations = [];
  const events = [];
  const host = new DockHost(dom.element, layout, {
    resolveContent: id => panels.get(id), onActivate: id => activations.push(id)
  });
  const unsubscribe = layout.subscribe(event => events.push(event.type));
  t.after(() => { unsubscribe(); host.dispose(); });
  return {...dom, layout, host, panels, buttons, clicks, activations, events};
}

const shell = fixture => fixture.element.querySelector('.sf-dock-shell');
const tab = (fixture, id) => fixture.element.querySelector(`[data-dock-tab="${id}"]`);

test('focusing a visible panel retains every connected ancestor through its first pointer click and notifies activation', t => {
  const view = fixture(t);
  const {layout, panels, buttons, activations, events, clicks} = view;
  buttons.get('tool').focus();
  const source = panels.get('source');
  source.scrollTop = 73;
  source.scrollLeft = 19;
  const originalShell = shell(view);
  const parent = source.parentElement;
  const detachments = new Map([...panels].map(([id, panel]) => [id, panel.detachments]));
  const button = buttons.get('source');
  button.dispatch('pointerdown', {pointerType: 'mouse', button: 0});
  button.focus();
  assert.equal(shell(view), originalShell);
  assert.equal(source.parentElement, parent);
  assert.equal(button.isConnected, true);
  for (const [id, panel] of panels) assert.equal(panel.detachments, detachments.get(id), id);
  button.dispatch('pointerup');
  button.dispatch('click');
  assert.deepEqual(clicks, ['source']);
  assert.equal(layout.state.activePanel, 'source');
  assert.deepEqual(events, ['activate']);
  assert.deepEqual(activations, ['source']);
  assert.equal(view.document.activeElement, button);
  assert.equal(source.scrollTop, 73);
  assert.equal(source.scrollLeft, 19);
  assert.equal(tab(view, 'source').getAttribute('aria-selected'), 'true');
});

test('selecting a hidden tab still renders its visibility, accessible selection and active-panel callbacks', t => {
  const view = fixture(t);
  const originalShell = shell(view);
  assert.equal(view.panels.get('other').hidden, true);
  tab(view, 'other').dispatch('click');
  assert.notEqual(shell(view), originalShell);
  assert.equal(view.panels.get('source').hidden, true);
  assert.equal(view.panels.get('other').hidden, false);
  assert.equal(tab(view, 'source').getAttribute('aria-selected'), 'false');
  assert.equal(tab(view, 'other').getAttribute('aria-selected'), 'true');
  assert.equal(tab(view, 'source').tabIndex, -1);
  assert.equal(tab(view, 'other').tabIndex, 0);
  assert.deepEqual(view.events, ['activate']);
  assert.deepEqual(view.activations, ['other']);
});

test('auto-hide activation, showing and pinning still render their changed placement', t => {
  const view = fixture(t);
  const {host, layout, panels} = view;
  const originalShell = shell(view);
  layout.autoHide('tool', 'right');
  assert.notEqual(shell(view), originalShell);
  assert.equal(view.element.querySelector('[data-dock-toggle="tool"]').getAttribute('aria-expanded'), 'false');
  layout.activate('source');
  const dockedShell = shell(view);
  layout.activate('tool');
  assert.notEqual(shell(view), dockedShell, 'An auto-hidden panel is not an already selected docked tab.');
  host.showAutoPanel('tool');
  assert.equal(panels.get('tool').closest('.sf-dock-auto-popup')?.isConnected, true);
  assert.equal(view.element.querySelector('[data-dock-toggle="tool"]').getAttribute('aria-expanded'), 'true');
  host.hideAutoPanel();
  assert.equal(view.element.querySelector('.sf-dock-auto-popup'), null);
  layout.pin('tool');
  assert.equal(layout.locate('tool').kind, 'group');
  assert.equal(panels.get('tool').closest('[data-dock-group]').dataset.dockGroup, layout.locate('tool').group.id);
});

test('floating and structural layout changes still render while a visible floating activation preserves content', t => {
  const view = fixture(t);
  const {layout, panels, buttons} = view;
  const originalShell = shell(view);
  layout.float('tool', {x: 90, y: 70, width: 300, height: 200});
  assert.notEqual(shell(view), originalShell);
  const floating = panels.get('tool').closest('.sf-dock-floating');
  assert.equal(floating.isConnected, true);
  buttons.get('source').focus();
  const afterFocus = shell(view);
  buttons.get('tool').focus();
  assert.equal(shell(view), afterFocus);
  assert.equal(panels.get('tool').closest('.sf-dock-floating'), floating);
  layout.bounds(layout.state.floating[0].id, {x: 140});
  assert.notEqual(shell(view), afterFocus);
  assert.equal(panels.get('tool').closest('.sf-dock-floating').style.left, '140px');
  const beforeClose = shell(view);
  layout.close('tool');
  assert.notEqual(shell(view), beforeClose);
  assert.equal(view.element.querySelector('.sf-dock-floating'), null);
  layout.undo();
  assert.equal(panels.get('tool').closest('.sf-dock-floating').isConnected, true);
  layout.redo();
  assert.equal(view.element.querySelector('.sf-dock-floating'), null);
});

test('popout activation and return retain the real panel identity while updating the opener placeholder', t => {
  const view = fixture(t);
  const {host, layout, panels} = view;
  const content = panels.get('source');
  const child = host.popout('source');
  assert.equal(content.ownerDocument, child.document);
  assert.equal(host.popouts.has('source'), true);
  assert.equal(view.element.querySelector('.sf-dock-empty').textContent.includes('separate browser window'), true);
  const beforeActivation = shell(view);
  layout.activate('source');
  assert.notEqual(shell(view), beforeActivation, 'Popout activation must not use the retained docked-panel path.');
  assert.equal(content.ownerDocument, child.document);
  host.returnPopout('source');
  assert.equal(host.popouts.has('source'), false);
  assert.equal(content.ownerDocument, view.document);
  assert.equal(content.closest('[data-dock-group]').dataset.dockGroup, layout.locate('source').group.id);
  assert.equal(content.isConnected, true);
});

test('interactive sizing still defers reconstruction until completion and disposal unsubscribes from changes', t => {
  const view = fixture(t);
  const {host, layout} = view;
  const originalShell = shell(view);
  const beforeResize = layout.snapshot();
  host.dragSizing = true;
  layout.resize(layout.state.root.id, .4, {history: false});
  assert.equal(shell(view), originalShell);
  host.dragSizing = false;
  layout.finishInteraction(beforeResize, {type: 'resize'});
  assert.notEqual(shell(view), originalShell);
  const beforeDisposal = shell(view);
  host.dispose();
  layout.activate('source');
  assert.equal(shell(view), beforeDisposal);
});
