import { getAnnotatedController } from './annotated-host.js';

/** Each assigned controller drives exactly one viewport axis and receives the actual arranged extent. */
export function synchronizeScrollControllers(host, node, model) {
  const storage = host.context.getState(node);
  const next = new Map();
  for (const axis of ['Horizontal', 'Vertical']) {
    const reference = node.properties[axis + 'ScrollController'];
    if (!reference) continue;
    const controllerNode = host.nodes.get(reference.$ref);
    const owner = host.nodes.get(controllerNode?.properties.Owner?.$ref);
    const controller = owner ? getAnnotatedController(host.context, owner)
      : host.services?.scrollControllers?.resolve?.(reference, host);
    if (!controller) throw new Error('SFUI1676: Scroll controller cannot be resolved by this host');
    const horizontal = axis === 'Horizontal';
    controller.scrollTo = (offset, options) => model.scrollTo(horizontal ? offset : model.horizontalOffset,
      horizontal ? model.verticalOffset : offset, options);
    controller.setIsScrollable((horizontal ? model.horizontalScrollMode : model.verticalScrollMode) !== 0);
    controller.setValues(0, horizontal ? model.scrollableWidth : model.scrollableHeight,
      horizontal ? model.horizontalOffset : model.verticalOffset,
      (horizontal ? model.viewportWidth : model.viewportHeight) / model.zoomFactor);
    next.set(axis, controller);
  }
  for (const [axis, controller] of storage.scrollControllers ?? []) if (next.get(axis) !== controller) controller.scrollTo = null;
  storage.scrollControllers = next;
}

export function completeScrollControllers(host, node, correlation) {
  for (const controller of host.context.getState(node).scrollControllers?.values() ?? []) controller.notifyRequestedScrollCompleted(correlation);
}
