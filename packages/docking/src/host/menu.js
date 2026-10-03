/** Opens an accessible keyboard menu. Items use stable ids and an explicit enabled state. */
export function showDockMenu(host, items, x, y, { label = 'Window actions' } = {}) {
  host.dismissMenu?.();
  const menu = host.el('div', 'sf-dock-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  const previousFocus = host.element.ownerDocument.activeElement;
  for (const item of items) {
    if (!item) {
      const divider = host.el('hr', 'sf-dock-menu-divider');
      divider.setAttribute('role', 'separator');
      menu.append(divider);
      continue;
    }
    const button = host.button(item.title, item.title, () => {
      host.dismissMenu?.(false);
      return item.execute();
    });
    button.dataset.commandId = item.id ?? '';
    button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
    button.disabled = item.enabled === false;
    menu.append(button);
  }
  const window = host.element.ownerDocument.defaultView;
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - 260))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - 320))}px`;
  host.element.ownerDocument.body.append(menu);
  menu.querySelector('button:not(:disabled)')?.focus();
  const outside = event => { if (!menu.contains(event.target)) host.dismissMenu?.(false); };
  host.dismissMenu = (restoreFocus = true) => {
    menu.remove();
    host.element.ownerDocument.removeEventListener('pointerdown', outside, true);
    host.dismissMenu = null;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  host.element.ownerDocument.addEventListener('pointerdown', outside, true);
  menu.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); host.dismissMenu?.(); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(menu.ownerDocument.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return menu;
}
