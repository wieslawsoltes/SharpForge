import {DispatcherQueue, DispatcherQueuePriority} from './dispatcher-queue.js';
import {RoutedEventRegistry, builtInRoutedEvents} from './routed-event-registry.js';
import {RoutedHandlerList} from './routed-handler-list.js';
import {ResourceFault} from '../resources/errors.js';

const x = 'Microsoft.UI.Xaml.';
const dispatcherType = 'Microsoft.UI.Dispatching.DispatcherQueue';

/** Each application has one queue for its logical UI thread, supplied by the cooperative scheduler. */
export function getDispatcherQueue(context) {
  if (context.dispatcherQueue) return context.dispatcherQueue;
  return context.state(null, 'dispatcherQueue', () => {
    const services = context.dispatcherServices;
    if (!services?.schedule || !services.currentThread || !services.enterThread) {
      throw new ResourceFault('SFDISPATCH001', 'This host has no logical UI-thread dispatcher capability.');
    }
    return new DispatcherQueue({...services, invoke: callback => context.invokeManaged(callback, [])});
  });
}

export function routedEventRegistry(context) {
  return context.state(null, 'routedEventRegistry', () => new RoutedEventRegistry({
    isAssignable: (target, source) => context.propertyRegistry.isAssignable(target, source)}));
}

/** Tree data and input routing are supplied by A16; these adapters provide the registered language contracts. */
export function registerObjectModelAdapters(registry) {
  registry.register({owner: dispatcherType, name: 'GetForCurrentThread'}, ({context}) => {
    const queue = getDispatcherQueue(context);
    return queue.hasThreadAccess ? context.wrapModel(queue, dispatcherType) : null;
  });
  registry.register({owner: dispatcherType, name: 'TryEnqueue'}, ({context, receiver, args}) => {
    const queue = context.unwrapModel(receiver);
    return queue.tryEnqueue(args.at(-1), args.length === 2 ? Number(context.native(args[0])) : DispatcherQueuePriority.Normal);
  });
  registry.register({owner: dispatcherType, kind: 'get', name: 'get_HasThreadAccess'}, ({context, receiver}) =>
    context.unwrapModel(receiver).hasThreadAccess);
  registry.register({owner: x + 'DependencyObject', kind: 'get', name: 'get_DispatcherQueue'}, ({context}) =>
    context.wrapModel(getDispatcherQueue(context), dispatcherType));
  registerTreeAdapters(registry);
  registerRoutedAdapters(registry);
}

function requireTree(context) {
  if (!context.objectTree) throw new ResourceFault('SFTREE006', 'This host does not provide shared visual/logical tree services.');
  return context.objectTree;
}

function registerTreeAdapters(registry) {
  const helper = x + 'Media.VisualTreeHelper';
  registry.register({owner: helper, name: 'GetParent'}, ({context, args}) => {
    const tree = requireTree(context);
    const id = context.id(args[0]);
    return tree.contains(id) ? tree.getValue(tree.getVisualParent(id)) : null;
  });
  registry.register({owner: helper, name: 'GetChildrenCount'}, ({context, args}) => {
    const tree = requireTree(context);
    const id = context.id(args[0]);
    return tree.contains(id) ? tree.getVisualChildren(id).length : 0;
  });
  registry.register({owner: helper, name: 'GetChild'}, ({context, args}) => {
    const tree = requireTree(context);
    const id = context.id(args[0]);
    const children = tree.contains(id) ? tree.getVisualChildren(id) : [];
    const index = Number(context.native(args[1]));
    if (!Number.isInteger(index) || index < 0 || index >= children.length) throw new RangeError('Visual child index is out of range.');
    return tree.getValue(children[index]);
  });
  registry.register({owner: helper, name: 'FindElementsInHostCoordinates'}, ({context, args}) => {
    const tree = requireTree(context);
    const source = context.native(args[0]);
    const bounds = {x: source.x ?? source.X, y: source.y ?? source.Y};
    if ('width' in source || 'Width' in source) Object.assign(bounds, {width: source.width ?? source.Width, height: source.height ?? source.Height});
    const values = tree.findElementsInHostCoordinates(bounds, args[1] === null ? null : context.id(args[1]), {
      includeAllElements: args.length > 2 && Boolean(context.native(args[2]))});
    return context.array ? context.array(values, x + 'UIElement') : context.managed(values, x + 'UIElement[]');
  });
  registry.register({owner: x + 'FrameworkElement', kind: 'get', name: 'get_Parent'}, ({context, receiver}) => {
    const tree = requireTree(context);
    const id = context.id(receiver);
    return tree.contains(id) ? tree.getValue(tree.getLogicalParent(id)) : null;
  });
}

function registerRoutedAdapters(registry) {
  for (const name of ['AddHandler', 'RemoveHandler']) {
    registry.register({owner: x + 'UIElement', name}, ({context, receiver, args}) => {
      const event = routedEventRegistry(context).resolve(context.unwrapModel(args[0]));
      const handlers = context.state(receiver, 'routedHandlers', () => new RoutedHandlerList({context, owner: receiver}));
      if (name === 'AddHandler') handlers.add(event, args[1], Boolean(context.native(args[2])));
      else handlers.remove(event, args[1]);
      return null;
    });
  }
  for (const name of builtInRoutedEvents) {
    registry.register({owner: x + 'UIElement', kind: 'get', name: 'get_' + name + 'Event'}, ({context}) => {
      const definition = context.frameworkRegistry.types.get(x + 'UIElement')?.events[name];
      const events = routedEventRegistry(context);
      const event = events.lookup(x + 'UIElement', name) ?? events.register({name, ownerType: x + 'UIElement',
        handlerType: definition?.delegate ?? definition ?? 'object', routingStrategy: name.startsWith('Preview') ? 'tunnel' : 'bubble'});
      return context.wrapModel(event, x + 'RoutedEvent');
    });
  }
}
