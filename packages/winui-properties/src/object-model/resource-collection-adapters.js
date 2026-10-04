/** Collection methods are registered only for model-backed UI collections. */
export function registerResourceCollectionAdapters(registry, owner, elementType) {
  registry.register({owner, kind: 'get', name: 'get_Count'}, ({context, receiver}) => context.unwrapModel(receiver).count);
  for (const name of ['Add', 'Insert', 'Remove', 'RemoveAt', 'Clear', 'get_Item']) {
    registry.register({owner, name}, ({context, receiver, args}) => {
      const collection = context.unwrapModel(receiver);
      const handlers = {
        Add: () => collection.add(args[0]),
        Insert: () => collection.insert(Number(context.native(args[0])), args[1]),
        Remove: () => collection.remove(args[0]),
        RemoveAt: () => collection.removeAt(Number(context.native(args[0]))),
        Clear: () => collection.clear(),
        get_Item: () => context.wrapModel(collection.get(Number(context.native(args[0]))), elementType)
      };
      return handlers[name]() ?? null;
    });
  }
}
