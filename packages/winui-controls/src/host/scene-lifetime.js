const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

function attempt(failures, action) {
  try { action(); } catch (error) {
    if (error instanceof AggregateError) failures.push(...error.errors);
    else failures.push(error);
  }
}

function complete(failures, message) {
  if (failures.length) throw new AggregateError(failures, message);
}

/** Template identities are scene references, never arbitrary serialized objects. */
export function applyTemplateCommand(host, command) {
  const property = command.op === 'template' ? 'templateRoot' : 'templateOwner';
  const value = command.op === 'template' ? command.root : command.owner;
  if (!identity(command.id) || value !== null && !identity(value)) throw new TypeError('Invalid template identity');
  const node = host.nodes.get(command.id);
  if (!node) return;
  node[property] = value;
  host.invalidate(node.id);
}

/** Visual eviction preserves scene ownership, but releases every resource even if a disposer faults. */
export function removeHostElement(host, id) {
  const failures = [], node = host.nodes.get(id), element = host.elements.get(id);
  const state = host.states.get(id), surface = host.surfaces.get(id);
  attempt(failures, () => host.eventRequests.cancelTarget(id));
  attempt(failures, () => host.input?.removeNode(id, { removeHandlers: false }));
  if (node && element) attempt(failures, () => host.registry.resolve(node.type)?.dispose?.(host.context, node, element));
  attempt(failures, () => state?.dispose?.());
  attempt(failures, () => state?.scrollModel?.dispose());
  if (element) attempt(failures, () => host.resizeObserver?.unobserve(element));
  attempt(failures, () => element?.remove());
  attempt(failures, () => surface?.dispose());
  for (const name of ['states', 'elements', 'surfaces', 'layouts', 'privateValues']) host[name].delete(id);
  if (element) {
    attempt(failures, () => host.automation?.bridge.remove(element));
    attempt(failures, () => host.options.onElementRemoved?.(id, element));
  }
  complete(failures, 'UI element removal cleanup failed');
}

function releasePortals(host, id, element, failures) {
  host.windows = host.windows.filter(value => value !== id);
  host.pendingFlyouts = host.pendingFlyouts.filter(value => value.id !== id && value.anchor !== id);
  for (const [flyout, anchor] of host.openFlyouts) {
    if (flyout !== id && anchor !== id) continue;
    attempt(failures, () => { const popup = host.elements.get(flyout); if (popup) popup.hidden = true; });
    host.openFlyouts.delete(flyout);
  }
  const overlays = host.services.overlays;
  for (const entry of [...(overlays?.entries ?? [])]) {
    if (entry.id === id || element && (entry.anchor === element || element.contains?.(entry.anchor))) {
      attempt(failures, () => overlays.dismiss(entry, { reason: 'unloaded' }));
    }
  }
}

function releaseLayout(host, id) {
  host.parents.delete(id);
  for (const [child, parent] of host.parents) if (parent === id) host.parents.delete(child);
  host.worldLayout.delete(id);
  host.portalTransforms?.delete(id);
  const engine = host.layoutEngine;
  engine.states.delete(id);
  engine.dirty.delete(id);
  engine.dependencies.delete(id);
  for (const dependencies of engine.dependencies.values()) dependencies.delete(id);
  engine.roots = engine.roots.filter(value => value !== id);
  for (const state of engine.states.values()) {
    if (state.parent === id) state.parent = null;
    state.children = state.children.filter(value => value !== id);
  }
}

/** Explicit removal also releases retained graph edges and makes the partial batch renderable after an error. */
export function removeHostNode(host, id) {
  if (!identity(id)) throw new TypeError('Invalid scene identity');
  const failures = [], element = host.elements.get(id);
  attempt(failures, () => removeHostElement(host, id));
  attempt(failures, () => host.eventRouter.removeNode(id));
  attempt(failures, () => host.input.dragDrop.removeNode(id));
  attempt(failures, () => host.automation?.remove(id));
  attempt(failures, () => host.composition.remove(id));
  host.nodes.delete(id);
  attempt(failures, () => host.services.objectTree?.remove(id));
  releasePortals(host, id, element, failures);
  releaseLayout(host, id);
  for (const node of host.nodes.values()) {
    if (node.templateRoot === id) node.templateRoot = null;
    if (node.templateOwner === id) node.templateOwner = null;
  }
  host.modelDirty = true;
  attempt(failures, () => host.schedule());
  complete(failures, 'Scene node removal cleanup failed');
}
