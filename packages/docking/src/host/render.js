import { createAutoHidePopup, createAutoHideShelves } from './auto-hide.js';
import { createFloatingView } from './floating.js';

function captureView(host) {
  const focused = host.element.ownerDocument.activeElement;
  let key = null;
  if (focused?.dataset.dockTab) key = { tab: focused.dataset.dockTab };
  else if (focused?.classList.contains('sf-dock-divider')) key = { split: focused.parentElement.dataset.splitId };
  const selection = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;
  const scrolls = new Map([...host.contents].map(([id, content]) => [id, [content.scrollTop, content.scrollLeft]]));
  const tabs = new Map([...host.element.querySelectorAll('.sf-dock-tabs')]
    .map(strip => [strip.closest('[data-dock-group]').dataset.dockGroup, strip.scrollLeft]));
  return { focused, key, selection, scrolls, tabs };
}

function restoreView(host, saved, parking) {
  for (const [id, content] of host.contents) {
    if (!content.isConnected && !host.popouts.has(id)) parking.append(content);
    const scroll = saved.scrolls.get(id);
    if (scroll) { content.scrollTop = scroll[0]; content.scrollLeft = scroll[1]; }
  }
  if (saved.key && !saved.focused?.isConnected) {
    if (saved.key.tab) host.focusTab(saved.key.tab);
    else host.element.querySelector(`[data-split-id="${host.escape(saved.key.split)}"] > .sf-dock-divider`)?.focus({ preventScroll: true });
  }
  if (saved.focused?.isConnected && saved.focused !== host.element.ownerDocument.body && !saved.focused.closest('[hidden]')) {
    saved.focused.focus({ preventScroll: true });
    if (saved.selection && typeof saved.focused.setSelectionRange === 'function' && saved.selection[0] !== null) {
      saved.focused.setSelectionRange(...saved.selection);
    }
  }
  for (const tabs of host.element.querySelectorAll('.sf-dock-tabs')) {
    tabs.scrollLeft = saved.tabs.get(tabs.closest('[data-dock-group]').dataset.dockGroup) ?? 0;
    const active = tabs.querySelector('[aria-selected="true"]');
    if (!active) continue;
    const viewport = tabs.getBoundingClientRect();
    const bounds = active.getBoundingClientRect();
    if (bounds.left < viewport.left) tabs.scrollLeft -= viewport.left - bounds.left;
    else if (bounds.right > viewport.right) tabs.scrollLeft += bounds.right - viewport.right;
  }
}

export function renderDockHost(host) {
  if (host.disposed || host.rendering) return;
  host.rendering = true;
  try {
    const saved = captureView(host);
    const document = host.element.ownerDocument;
    const fragment = document.createDocumentFragment();
    const parking = host.el('div', 'sf-dock-parking');
    parking.hidden = true;
    for (const [id, content] of host.contents) if (!host.popouts.has(id)) parking.append(content);
    host.element.replaceChildren(parking);
    const shell = host.el('div', 'sf-dock-shell');
    createAutoHideShelves(host, shell);
    const root = host.el('div', 'sf-dock-root');
    root.append(host.node(host.layout.state.root));
    shell.append(root);
    fragment.append(shell);
    for (const floating of host.layout.state.floating) fragment.append(createFloatingView(host, floating));
    const popup = createAutoHidePopup(host);
    if (popup) fragment.append(popup);
    host.element.append(fragment);
    if (host.maximizedGroup) {
      const group = host.element.querySelector(`[data-dock-group="${host.escape(host.maximizedGroup)}"]`);
      group?.classList.add('sf-dock-maximized');
    }
    host.element.classList.toggle('sf-dock-fullscreen', Boolean(host.fullscreen));
    restoreView(host, saved, parking);
    host.resizeObserver?.disconnect();
    if (host.resizeObserver) for (const tabs of host.element.querySelectorAll('.sf-dock-tabs')) host.resizeObserver.observe(tabs);
    host.updateOverflow();
  } finally {
    host.rendering = false;
  }
}
