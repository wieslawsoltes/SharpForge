/** Same-origin popouts retain the exact panel DOM and listener identity; no serialized source crosses origins. */
export function openPopout(host, id) {
  host.layout.require(id);
  if (host.popouts.has(id)) { host.popouts.get(id).window.focus(); return host.popouts.get(id).window; }
  const owner = host.element.ownerDocument;
  const window = owner.defaultView.open('', '', 'popup,width=900,height=650');
  if (!window) throw Object.assign(new Error('The browser blocked the tool window popup'), { code: 'SFDOCK004' });
  const document = window.document;
  const identity = `popout:${id}`;
  document.title = `${host.layout.require(id).title} — SharpForge`;
  document.documentElement.dataset.theme = owner.documentElement.dataset.theme;
  document.documentElement.dataset.dockWindow = identity;
  for (const style of owner.querySelectorAll('style,link[rel="stylesheet"]')) {
    const copy = style.cloneNode(true);
    if (copy.tagName === 'LINK') copy.href = style.href;
    document.head.append(copy);
  }
  const controller = new (window.AbortController ?? AbortController)();
  const options = { signal: controller.signal };
  const activate = () => {
    if (!host.layout.panels.has(id)) return;
    host.layout.activate(id);
    host.onActivate(id);
    host.onWindowFocus({ id: identity, panelId: id, window });
  };
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    activate();
    host.onWindowKeyDown(event, { windowId: identity, panelId: id });
  }, options);
  document.addEventListener('focusin', activate, options);
  window.addEventListener('focus', activate, options);
  document.body.className = 'sf-dock-popout';
  const returnButton = document.createElement('button');
  returnButton.type = 'button';
  returnButton.textContent = 'Return to main workspace';
  returnButton.onclick = () => host.returnPopout(id);
  const content = host.content(id);
  content.hidden = false;
  host.popouts.set(id, { window, identity, controller });
  document.body.append(returnButton, content);
  window.addEventListener('pagehide', () => reattachPopout(host, id), options);
  window.addEventListener('beforeunload', () => reattachPopout(host, id), options);
  if (host.windowWatch === null) {
    host.windowWatch = setInterval(() => {
      for (const [panelId, entry] of host.popouts) if (entry.window.closed) reattachPopout(host, panelId);
      stopWatchIfEmpty(host);
    }, 250);
  }
  host.onPopoutDocument(document, { windowId: identity, panelId: id, window });
  host.render();
  return window;
}

function stopWatchIfEmpty(host) {
  if (host.popouts.size || host.windowWatch === null) return;
  clearInterval(host.windowWatch);
  host.windowWatch = null;
}

export function reattachPopout(host, id, { close = false, reopen = true } = {}) {
  const entry = host.popouts.get(id);
  if (!entry) return false;
  host.popouts.delete(id);
  entry.controller.abort();
  if (host.layout.panels.has(id)) {
    host.element.append(host.content(id));
    if (reopen && !host.disposed && host.layout.locate(id).kind === 'closed') host.layout.open(id);
  }
  if (close && !entry.window.closed) entry.window.close();
  stopWatchIfEmpty(host);
  if (!host.disposed) host.render();
  host.onWindowFocus({ id: 'main', panelId: id, window: host.element.ownerDocument.defaultView });
  return true;
}
