import { panelIds } from '../model/nodes.js';
import { moveFloating } from './pointer.js';

export function redockFloating(host, floating) {
  const location = floating.returnLocation;
  const original = host.layout.group(location?.groupId);
  const target = original && !host.layout.state.floating.some(item => panelIds(item.root).includes(original.panels[0])) ? original : null;
  if (target) return host.layout.dockGroup(floating.id, target.id, 'center');
  for (const anchor of location?.anchors ?? []) {
    const peer = anchor.panels.map(id => host.layout.locate(id)).find(item => item.group && !item.floatingId);
    if (peer) return host.layout.dockGroup(floating.id, peer.group.id, anchor.side);
  }
  return host.layout.dockGroup(floating.id, null, location?.side ?? 'right', { root: true });
}

export function createFloatingView(host, floating) {
  const box = host.el('section', 'sf-dock-floating');
  box.dataset.floatId = floating.id;
  box.setAttribute('aria-label', 'Floating window');
  const bounds = host.clamp(floating);
  Object.assign(box.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  box.onpointerdown = () => {
    for (const other of host.element.querySelectorAll('.sf-dock-floating')) other.style.zIndex = '12';
    box.style.zIndex = '13';
  };
  const ids = panelIds(floating.root);
  const handle = host.el('div', 'sf-dock-float-title', host.layout.require(ids[0]).title);
  handle.tabIndex = 0;
  handle.setAttribute('aria-label', 'Move floating group');
  handle.append(host.button('↙', 'Dock floating group', () => redockFloating(host, floating)));
  handle.ondblclick = event => { if (!event.target.closest('button')) redockFloating(host, floating); };
  handle.onpointerdown = event => { if (!event.target.closest('button')) moveFloating(host, event, floating, box); };
  handle.onkeydown = event => floatingKeyDown(host, floating, event);
  box.append(handle, host.node(floating.root));
  const grip = host.el('div', 'sf-dock-float-grip');
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-label', 'Resize floating group');
  grip.onpointerdown = event => moveFloating(host, event, floating, box, true);
  grip.onkeydown = event => floatingKeyDown(host, floating, event, true);
  box.append(grip);
  return box;
}

function floatingKeyDown(host, floating, event, resize = false) {
  const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const delta = deltas[event.key];
  if (!delta) return;
  event.preventDefault();
  const step = event.shiftKey ? 1 : 10;
  const next = resize ? { ...floating, width: floating.width + delta[0] * step, height: floating.height + delta[1] * step }
    : { ...floating, x: floating.x + delta[0] * step, y: floating.y + delta[1] * step };
  host.layout.bounds(floating.id, host.clamp(next));
}
