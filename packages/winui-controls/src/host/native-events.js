function dispatchRenderer(host, node, type, event) {
  const properties = node.properties;
  if (properties.IsEnabled === false || properties.IsEnabled === 0 || properties.IsHitTestVisible === false) return;
  const renderer = host.registry.resolve(node.type);
  renderer?.events?.[type]?.(host.context, node, host.elements.get(node.id), event);
  renderer?.handleEvent?.(host.context, node, host.elements.get(node.id), { type, event });
}

/** Contributions explicitly opt into descendant input; ordinary renderer event maps keep their existing target semantics. */
function dispatchAncestors(host, original, handled, type, event) {
  let current = host.layoutEngine.states.get(original)?.parent;
  let depth = 0;
  while (current && !event.defaultPrevented && !event.cancelBubble) {
    if (++depth > 512) throw new RangeError('SFUI1605: Native input ancestry limit');
    const node = host.nodes.get(current);
    if (node && !handled.has(current) && host.registry.resolve(node.type)?.bubbleEvents?.includes(type)) {
      handled.add(current);
      dispatchRenderer(host, node, type, event);
    }
    current = host.layoutEngine.states.get(current)?.parent;
  }
}

/** Preserve the physical managed source while a template forwards behavior to its owning control. */
export function handleNativeEvent(host, type, event) {
  if (host.disposed || host.root.classList.contains('debug-paused')) return;
  const native = event.target.closest?.('[data-sf-id]');
  if (!native || !host.root.contains(native)) return;
  let node = host.nodes.get(native.dataset.sfId);
  if (!node) return;
  const original = node.id;
  const previous = host.nativeEventSource;
  host.nativeEventSource = original;
  try {
    host.input.handle(type, event, original);
    if (event.defaultPrevented && ['keydown', 'keyup'].includes(type)) return;
    if (type === 'keydown' && event.key === 'Escape') host.hideFlyouts();
    if (node.templateOwner && ['click', 'input', 'change'].includes(type)) node = host.nodes.get(node.templateOwner) ?? node;
    const properties = node.properties;
    if (properties.IsEnabled === false || properties.IsEnabled === 0 || properties.IsHitTestVisible === false) return;
    const handled = new Set([node.id]);
    dispatchRenderer(host, node, type, event);
    const selected = event.target.closest?.('[data-selection-owner]');
    if (selected && !handled.has(selected.dataset.selectionOwner) && ['click', 'keydown'].includes(type)) {
      const owner = host.nodes.get(selected.dataset.selectionOwner);
      if (owner) { handled.add(owner.id); dispatchRenderer(host, owner, type, event); }
    }
    dispatchAncestors(host, original, handled, type, event);
    if (type === 'click' && properties.Flyout?.$ref) host.flyout({ id: properties.Flyout.$ref, anchor: node.id, show: true });
    if (type === 'contextmenu' && properties.ContextFlyout?.$ref && !host.services.interactions) {
      event.preventDefault();
      host.flyout({ id: properties.ContextFlyout.$ref, anchor: node.id, show: true });
    }
  } finally { host.nativeEventSource = previous; }
}
