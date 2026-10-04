import {ItemContainerGenerator} from '../items/container-generator.js';

/** Resolve the single generator owned by an ItemsControl or its public generator facade. */
export function itemGeneratorModel(context, owner) {
  const model = context.unwrapModel(owner);
  if (model instanceof ItemContainerGenerator) return model;
  return context.state(owner, 'itemContainerGenerator', () => {
    if (!context.itemContainerAdapter) throw new Error('The host does not provide item container realization.');
    return new ItemContainerGenerator({owner, adapter: context.itemContainerAdapter,
      schedule: context.scheduleUI, maxPool: context.services?.maxRecycledContainers ?? 256});
  });
}
