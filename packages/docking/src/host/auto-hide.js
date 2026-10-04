import { pointerSession } from './pointer.js';

export function createAutoHideShelves(host, shell) {
  for (const side of ['top', 'left', 'right', 'bottom']) {
    const shelf = host.el('div', `sf-dock-shelf ${side}`);
    shelf.dataset.side = side;
    shelf.setAttribute('role', 'toolbar');
    shelf.setAttribute('aria-label', `Auto-hidden ${side} tools`);
    for (const id of host.layout.state.autoHide[side]) {
      const button = host.button(host.layout.require(id).title, `Show ${host.layout.require(id).title}`, () => {
        if (host.autoPanel === id) host.hideAutoPanel();
        else host.showAutoPanel(id, true);
      });
      button.dataset.dockToggle = id;
      button.classList.toggle('active', host.autoPanel === id);
      button.setAttribute('aria-expanded', String(host.autoPanel === id));
      button.onpointerenter = event => {
        if (event.pointerType === 'touch') return;
        host.clearFlyoutTimers();
        host.flyoutOpenTimer = setTimeout(() => host.showAutoPanel(id), 220);
      };
      button.onpointerleave = () => host.scheduleFlyoutClose();
      button.oncontextmenu = event => { event.preventDefault(); host.menu(id, event.clientX, event.clientY); };
      shelf.append(button);
    }
    shell.append(shelf);
  }
}

export function createAutoHidePopup(host) {
  const id = host.autoPanel;
  if (!id || !host.layout.panels.has(id)) return null;
  const where = host.layout.locate(id);
  if (where.kind !== 'autoHide') { host.autoPanel = null; return null; }
  const popup = host.el('section', `sf-dock-auto-popup ${where.side}`);
  popup.setAttribute('aria-label', host.layout.require(id).title);
  popup.onpointerenter = () => host.clearFlyoutTimers();
  popup.onpointerleave = () => host.scheduleFlyoutClose();
  const horizontal = where.side === 'left' || where.side === 'right';
  const limit = horizontal ? host.element.clientWidth : host.element.clientHeight;
  const size = Math.min(host.layout.state.flyoutSizes[id] ?? (horizontal ? 420 : 300), Math.max(100, limit - 40));
  popup.style[horizontal ? 'width' : 'height'] = `${size}px`;
  const bar = host.el('div', 'sf-dock-float-title', host.layout.require(id).title);
  bar.append(host.button('◆', 'Pin tool window', () => { host.autoPanel = null; host.layout.pin(id); }),
    host.button('×', `Close ${host.layout.require(id).title}`, () => host.closePanel(id)));
  const content = host.content(id);
  content.hidden = false;
  const grip = host.el('div', `sf-dock-flyout-grip ${where.side}`);
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-label', 'Resize auto-hidden tool');
  grip.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal');
  grip.setAttribute('aria-valuemin', '100');
  grip.setAttribute('aria-valuemax', String(Math.max(100, limit - 40)));
  grip.setAttribute('aria-valuenow', String(Math.round(size)));
  const sign = where.side === 'right' || where.side === 'bottom' ? -1 : 1;
  grip.onkeydown = event => {
    const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 20 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -20 : 0;
    if (delta) { event.preventDefault(); host.layout.resizeFlyout(id, Math.min(limit - 40, size + delta * sign)); }
  };
  grip.onpointerdown = event => {
    event.preventDefault();
    const previous = host.layout.snapshot();
    const start = horizontal ? event.clientX : event.clientY;
    host.dragSizing = true;
    pointerSession(host, event, grip, current => {
      const coordinate = horizontal ? current.clientX : current.clientY;
      const next = Math.max(100, Math.min(limit - 40, size + (coordinate - start) * sign));
      popup.style[horizontal ? 'width' : 'height'] = `${next}px`;
      host.layout.resizeFlyout(id, next, { history: false });
    }, (_current, cancel) => {
      host.dragSizing = false;
      host.layout.finishInteraction(previous, { cancel, type: 'flyoutSize' });
    });
  };
  popup.append(bar, content, grip);
  return popup;
}
