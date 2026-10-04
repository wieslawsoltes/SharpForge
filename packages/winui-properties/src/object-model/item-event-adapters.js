import {registerModelEvent} from './model-events.js';
import {itemGeneratorModel} from './item-generator-model.js';

const x = 'Microsoft.UI.Xaml.';
const controls = x + 'Controls.';
const changingType = controls + 'ContainerContentChangingEventArgs';

function invokeContentChanged(context, owner, handler, args) {
  context.invokeManaged(handler, [owner, context.wrapModel(args, changingType)]);
}

/** Typed content callbacks retain their original delegate through every deferred phase and release it on recycle. */
export function registerItemEvents(registry) {
  for (const owner of [controls + 'ListViewBase', controls + 'ListView']) registerModelEvent(registry, {
    owner, name: 'ContainerContentChanging',
    source: (context, receiver, listener) => {
      const callback = (_sender, event) => listener(event);
      callback.retainedValues = listener.retainedValues;
      return itemGeneratorModel(context, receiver).onContentChanging(callback);
    },
    invoke: invokeContentChanged
  });
  for (const [name, field] of [['Item', 'item'], ['ItemContainer', 'itemContainer'], ['ItemIndex', 'itemIndex'],
    ['Phase', 'phase'], ['InRecycleQueue', 'inRecycleQueue'], ['Handled', 'handled']]) {
    registry.register({owner: changingType, kind: 'get', name: 'get_' + name}, ({context, receiver, descriptor}) =>
      context.managed(context.unwrapModel(receiver)[field], descriptor.result));
  }
  registry.register({owner: changingType, kind: 'set', name: 'set_Handled'}, ({context, receiver, args}) => {
    context.unwrapModel(receiver).handled = Boolean(context.native(args[0]));
    return null;
  });
  registry.register({owner: changingType, name: 'RegisterUpdateCallback'}, ({context, receiver, args}) => {
    const change = context.unwrapModel(receiver);
    const callback = args.at(-1);
    const invoke = (owner, event) => invokeContentChanged(context, owner, callback, event);
    invoke.retainedValues = function* () { yield callback; };
    change.registerUpdateCallback(invoke, args.length === 2 ? Number(context.native(args[0])) : change.phase + 1);
    return null;
  });
  for (const [name, source] of [['CurrentChanging', 'onCurrentChanging'], ['CurrentChanged', 'onCurrentChanged']]) {
    registerModelEvent(registry, {owner: x + 'Data.ICollectionView', name,
      source: (context, receiver, listener) => context.unwrapModel(receiver)[source](listener),
      invoke: (context, receiver, handler, event) => {
        if (name === 'CurrentChanged') return context.invokeManaged(handler, [receiver, null]);
        const args = context.allocate(x + 'Data.CurrentChangingEventArgs', {Cancel: !!event.cancel, IsCancelable: !!event.isCancelable});
        context.invokeManaged(handler, [receiver, args]);
        if (event.isCancelable) event.cancel = Boolean(context.native(context.read(args, 'Cancel')));
      }});
  }
}
