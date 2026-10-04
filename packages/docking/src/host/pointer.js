/** Captures one pointer and guarantees one completion callback, including lost capture and disposal. */
export function pointerSession(host, event, target, move, end) {
  const id = event.pointerId;
  let finished = false;
  function finish(current, cancel = current?.type !== 'pointerup') {
    if (finished || current && current.pointerId !== id) return;
    finished = true;
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) target.removeEventListener(type, finish);
    target.removeEventListener('pointermove', onMove);
    host.pointerCancels.delete(cancelSession);
    if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id);
    end(current, cancel);
  }
  const onMove = current => { if (current.pointerId === id) move(current); };
  const cancelSession = () => finish(null, true);
  host.pointerCancels.add(cancelSession);
  target.addEventListener('pointermove', onMove);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) target.addEventListener(type, finish);
  // Synthetic pointer events have no browser pointer to capture; they still exercise the same deterministic handlers.
  if (event.isTrusted !== false) target.setPointerCapture?.(id);
  return cancelSession;
}

export function bindTouchTab(host, tab, id) {
  tab.onpointerdown = event => {
    if (!['touch', 'pen'].includes(event.pointerType) || event.button > 0) return;
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let menuOpened = false;
    const timer = setTimeout(() => {
      menuOpened = true;
      host.menu(id, start.x, start.y);
    }, 550);
    pointerSession(host, event, tab, current => {
      if (Math.hypot(current.clientX - start.x, current.clientY - start.y) < 8 && !dragging) return;
      clearTimeout(timer);
      if (menuOpened) return;
      dragging = true;
      host.dragPanel = id;
      host.element.classList.add('sf-dock-dragging');
      current.preventDefault();
      const group = host.groupAt(current.clientX, current.clientY);
      if (group) host.guides.update(group, current);
    }, (current, cancelled) => {
      clearTimeout(timer);
      if (dragging && !cancelled && current) {
        const under = host.element.ownerDocument.elementFromPoint?.(current.clientX, current.clientY);
        const targetTab = under?.closest?.('[data-dock-tab]');
        if (targetTab && targetTab !== tab) {
          const group = targetTab.closest('[data-dock-group]');
          const items = host.layout.group(group.dataset.dockGroup).panels;
          host.attempt(() => host.layout.dock(id, group.dataset.dockGroup, 'center', items.indexOf(targetTab.dataset.dockTab)));
        } else if (host.guides.active) host.dropDrag(host.guides.active, host.guides.group?.dataset.dockGroup);
      }
      if (dragging || menuOpened) {
        tab.addEventListener('click', suppressClick, { once: true });
        setTimeout(() => tab.removeEventListener('click', suppressClick), 0);
      }
      host.clearDrag();
    });
    function suppressClick(current) { current.preventDefault(); current.stopImmediatePropagation(); }
  };
}

export function resizeSplit(host, event, divider, split, node, first, second) {
  event.preventDefault();
  const bounds = split.getBoundingClientRect();
  const previous = host.layout.snapshot();
  host.dragSizing = true;
  pointerSession(host, event, divider, current => {
    const raw = node.axis === 'horizontal' ? (current.clientX - bounds.left) / Math.max(1, bounds.width)
      : (current.clientY - bounds.top) / Math.max(1, bounds.height);
    const ratio = Math.max(.05, Math.min(.95, raw));
    first.style.flex = `${ratio} 1 0`;
    second.style.flex = `${1 - ratio} 1 0`;
    divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    host.layout.resize(node.id, ratio, { history: false });
  }, (_current, cancel) => {
    host.dragSizing = false;
    host.layout.finishInteraction(previous, { cancel, type: 'resize' });
  });
}

export function moveFloating(host, event, floating, element, resize = false) {
  event.preventDefault();
  const previous = host.layout.snapshot();
  const start = { x: event.clientX, y: event.clientY };
  const bounds = host.clamp(floating);
  host.dragSizing = true;
  host.dragNode = resize ? null : floating.id;
  pointerSession(host, event, event.currentTarget, current => {
    const deltaX = current.clientX - start.x;
    const deltaY = current.clientY - start.y;
    const next = host.clamp(resize ? { ...bounds, width: Math.max(160, bounds.width + deltaX), height: Math.max(100, bounds.height + deltaY) }
      : { ...bounds, x: bounds.x + deltaX, y: bounds.y + deltaY });
    Object.assign(element.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.width}px`, height: `${next.height}px` });
    host.layout.bounds(floating.id, next, { history: false });
    if (!resize && Math.hypot(deltaX, deltaY) > 6) {
      const group = host.groupAt(current.clientX, current.clientY, element);
      if (group) host.guides.update(group, current);
    }
  }, (_current, cancel) => {
    const target = host.guides.active;
    const groupId = host.guides.group?.dataset.dockGroup;
    host.dragSizing = false;
    if (!cancel && target) {
      // The full move and re-dock operation is one undo step.
      host.layout.finishInteraction(previous, { cancel: true, type: 'bounds' });
      host.dropDrag(target, groupId);
    } else host.layout.finishInteraction(previous, { cancel, type: 'bounds' });
    host.clearDrag();
  });
}
