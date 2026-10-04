/** Focus activation must not detach the pointer target between its pointerdown and click. */
function retainsVisiblePanel(host) {
  const id = host.layout.state.activePanel;
  const content = host.contents.get(id);
  if (!content || content.hidden || !content.isConnected || host.popouts.has(id)) return false;
  if (content.ownerDocument !== host.element.ownerDocument || !host.element.contains(content)) return false;
  const where = host.layout.locate(id);
  if (where.kind !== 'group') return false;
  const group = content.closest('[data-dock-group]');
  if (group?.dataset.dockGroup !== where.group.id) return false;
  const tab = group.querySelector(`[data-dock-tab="${host.escape(id)}"]`);
  return tab?.getAttribute('aria-selected') === 'true';
}

/** Activation still notifies the application; only an already rendered selection can skip DOM reconstruction. */
export function updateDockHost(host, event) {
  if (host.dragSizing && ['resize', 'bounds', 'flyoutSize'].includes(event.type)) return;
  if (event.type === 'activate' && retainsVisiblePanel(host)) return;
  host.render();
}
