import {ThemeTransition, themeTransitionKinds} from './theme-transitions.js';
import {ConnectedAnimationService, NavigationTransitionInfo} from './connected-animation.js';
import {ImplicitTransition} from './implicit-transitions.js';
import {CompositionEventBindings, toCompositionResult, fromCompositionArgument} from '../composition/adapter-values.js';

const A = 'Microsoft.UI.Xaml.Media.Animation.';

export function registerTransitionAdapters(registry) {
  for (const kind of ['Scalar', 'Vector3', 'Brush']) {
    const owner = 'Microsoft.UI.Xaml.' + kind + 'Transition';
    registry.register({owner, kind: 'constructor', name: '.ctor'}, ({context}) =>
      context.wrapModel(new ImplicitTransition(kind + 'Transition'), owner));
    registry.register({owner, kind: 'get', name: 'get_Duration'}, ({context, receiver}) =>
      toCompositionResult(context, context.unwrapModel(receiver).Duration, 'System.TimeSpan'));
    registry.register({owner, kind: 'set', name: 'set_Duration'}, ({context, receiver, args}) => {
      const value = fromCompositionArgument(context, args[0], 'System.TimeSpan');
      if (!Number.isFinite(value) || value < 0 || value > 60000) throw new RangeError('Invalid implicit transition duration');
      context.unwrapModel(receiver).Duration = value;
      return null;
    });
  }
  for (const kind of themeTransitionKinds.filter(name => name.endsWith('Transition'))) {
    const owner = A + kind;
    registry.register({owner, kind: 'constructor', name: '.ctor'}, ({context}) => context.wrapModel(new ThemeTransition(kind), owner));
    for (const name of ['FromHorizontalOffset', 'FromVerticalOffset', 'IsStaggeringEnabled']) {
      registry.register({owner, kind: 'get', name: 'get_' + name}, ({context, receiver, descriptor}) =>
        context.managed(context.unwrapModel(receiver)[name], descriptor.result));
      registry.register({owner, kind: 'set', name: 'set_' + name}, ({context, receiver, args}) => {
        const value = context.native(args[0]);
        if (name !== 'IsStaggeringEnabled' && !Number.isFinite(value)) throw new RangeError('Invalid theme transition offset');
        context.unwrapModel(receiver)[name] = name === 'IsStaggeringEnabled' ? !!value : value;
        return null;
      });
    }
  }
  for (const kind of ['Entrance', 'DrillIn', 'Slide', 'Suppress']) {
    const owner = A + kind + 'NavigationTransitionInfo';
    registry.register({owner, kind: 'constructor', name: '.ctor'}, ({context}) => context.wrapModel(new NavigationTransitionInfo(kind + 'NavigationTransitionInfo'), owner));
  }
  const slide = A + 'SlideNavigationTransitionInfo';
  registry.register({owner: slide, kind: 'get', name: 'get_Effect'}, ({context, receiver}) => context.managed(context.unwrapModel(receiver).Effect, 'int'));
  registry.register({owner: slide, kind: 'set', name: 'set_Effect'}, ({context, receiver, args}) => {
    const value = context.native(args[0]);
    if (![0, 1, 2].includes(value)) throw new RangeError('Invalid slide transition effect');
    context.unwrapModel(receiver).Effect = value;
    return null;
  });
  registerConnectedAdapters(registry);
}

function registerConnectedAdapters(registry) {
  const owner = A + 'ConnectedAnimationService';
  registry.register({owner, kind: 'method', name: 'GetForCurrentView'}, ({context}) => {
    const service = context.state(null, 'connected-animations', () => {
      const supplied = context.services.connectedAnimations;
      if (supplied) return supplied;
      const compositor = context.services.compositor;
      if (!compositor) throw new TypeError('Connected animations require an application compositor service');
      return new ConnectedAnimationService(compositor, context.services.connectedAnimationOptions);
    });
    return context.wrapModel(service, owner);
  });
  for (const name of ['PrepareToAnimate', 'GetAnimation']) registry.register({owner, kind: 'method', name}, ({context, receiver, args, descriptor}) => {
    const service = context.unwrapModel(receiver);
    return toCompositionResult(context, service[name](context.native(args[0]), args[1]), descriptor.result);
  });
  const animation = A + 'ConnectedAnimation';
  for (const name of ['TryStart', 'Cancel']) registry.register({owner: animation, kind: 'method', name}, ({context, receiver, args, descriptor}) =>
    context.managed(context.unwrapModel(receiver)[name](...args), descriptor.result));
  for (const [kind, prefix, operation] of [['eventAdd', 'add_', 'add'], ['eventRemove', 'remove_', 'remove']]) {
    registry.register({owner: animation, kind, name: prefix + 'Completed'}, ({context, receiver, args}) => {
      const bindings = context.state(receiver, 'connected-event', () =>
        new CompositionEventBindings(context.unwrapModel(receiver), context, receiver, 'Completed'));
      bindings[operation](args[0]);
      return null;
    });
  }
}
