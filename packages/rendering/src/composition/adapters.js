import {COMPOSITION as C, compositionTypeSpecs, compositionCollections, compositionPropertyTypes} from '../contracts/composition-surface.js';
import {Compositor} from './compositor.js';
import {ElementCompositionPreview} from './element-preview.js';
import {CompositionEventBindings, fromCompositionArgument, toCompositionResult, registerNumericsAdapters} from './adapter-values.js';
import {registerTransitionAdapters} from '../animation/transition-adapters.js';
import {LoadedImageSurface} from './brushes.js';

function nativeModel(context, receiver) {
  const model = context.unwrapModel(receiver);
  if (model === receiver || !model || model.closed) throw new TypeError('Composition instance is missing or disposed');
  return model;
}

function full(type) {
  return type.includes('.') || ['void', 'object', 'float', 'double', 'int', 'uint', 'bool', 'string'].includes(type) ? type : C + type;
}

function registerTypeAdapters(registry, specification) {
  const owner = C + specification.name;
  if (specification.constructor === true) registry.register({owner, kind: 'constructor', name: '.ctor'}, ({context}) => {
    const model = new Compositor({clockFactory: context.services.clockFactory, scheduler: context.services.scheduler,
      onRender: context.services.onCompositionRender, onInvalidate: context.services.onCompositionInvalidate});
    (context.services.createCompositionTransport?.(model) ?? context.services.compositionTransport)?.connect(model);
    return context.wrapModel(model, owner);
  });
  for (const property of specification.properties ?? []) {
    registry.register({owner, kind: 'get', name: 'get_' + property.name}, ({context, receiver}) => {
      const model = nativeModel(context, receiver);
      return toCompositionResult(context, model[property.name], full(property.type));
    });
    if (!property.readOnly) registry.register({owner, kind: 'set', name: 'set_' + property.name}, ({context, receiver, args}) => {
      const model = nativeModel(context, receiver);
      model[property.name] = fromCompositionArgument(context, args[0], full(property.type));
      return null;
    });
  }
  const names = new Set();
  for (const method of specification.methods ?? []) {
    if (names.has(method.name)) continue;
    names.add(method.name);
    registry.register({owner, kind: 'method', name: method.name}, ({context, receiver, args, descriptor}) => {
      const model = nativeModel(context, receiver);
      if (typeof model[method.name] !== 'function') throw new TypeError(`SF_COMPOSITION_UNSUPPORTED_MEMBER: ${owner}.${method.name}`);
      const result = model[method.name](...args.map((value, index) => fromCompositionArgument(context, value, descriptor.parameters[index])));
      return toCompositionResult(context, result, descriptor.result);
    });
  }
  for (const event of specification.events ?? []) {
    for (const [kind, prefix, operation] of [['eventAdd', 'add_', 'add'], ['eventRemove', 'remove_', 'remove']]) {
      registry.register({owner, kind, name: prefix + event}, ({context, receiver, args}) => {
        const model = nativeModel(context, receiver);
        const bindings = context.state(receiver, 'composition-event:' + event, () => new CompositionEventBindings(model, context, receiver, event));
        bindings[operation](args[0]);
        return null;
      });
    }
  }
}

function registerCollections(registry) {
  for (const [name, element, unary, binary, clear] of compositionCollections) {
    const owner = C + name;
    registry.register({owner, kind: 'get', name: 'get_Count'}, ({context, receiver}) => context.managed(nativeModel(context, receiver).Count, 'int'));
    registry.register({owner, kind: 'method', name: 'get_Item'}, ({context, receiver, args}) => {
      const index = context.native(args[0]);
      const items = nativeModel(context, receiver).items;
      if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new RangeError('Composition collection index out of range');
      return toCompositionResult(context, items[index], C + element);
    });
    for (const name of [...unary, ...binary, clear]) registry.register({owner, kind: 'method', name}, ({context, receiver, args, descriptor}) => {
      const model = nativeModel(context, receiver);
      return toCompositionResult(context, model[name](...args.map(value => context.unwrapModel(value))), descriptor.result);
    });
  }
}

class PreviewService {
  constructor(context) {
    this.ownsCompositor = !context.services.compositor && !context.services.elementCompositionPreview;
    this.compositor = context.services.elementCompositionPreview?.compositor ?? context.services.compositor ?? new Compositor({clockFactory: context.services.clockFactory, scheduler: context.services.scheduler,
      onRender: context.services.onCompositionRender, onInvalidate: context.services.onCompositionInvalidate});
    context.services.createCompositionTransport?.(this.compositor)?.connect(this.compositor);
    this.preview = context.services.elementCompositionPreview ?? new ElementCompositionPreview(this.compositor, {
      keyFor: element => context.id(element), ownerReference: element => element,
      resolveAlive: element => !context.isAlive || context.isAlive(element) ? element : null, ...context.services.compositionPreview
    });
  }
  retainedValues() { return this.ownsCompositor ? [this.compositor] : []; }
  snapshot() { return this.ownsCompositor ? {compositor: this.compositor.snapshot(), entries: this.preview.snapshot()} : null; }
  restore(snapshot) { if (snapshot) { this.compositor.restore(snapshot.compositor); this.preview.restore(snapshot.entries); } }
  dispose() { if (this.ownsCompositor) { this.preview.dispose(); return this.compositor.dispose(); } }
}

/** One registration function serves source/CIL and JavaScript facade contexts. */
export function registerCompositionAdapters(registry) {
  registerNumericsAdapters(registry);
  for (const specification of compositionTypeSpecs) registerTypeAdapters(registry, specification);
  registerCollections(registry);
  registerPropertySetReads(registry);
  registerDashArrayAdapters(registry);
  registerTransitionAdapters(registry);
  registerImageSurface(registry);
  const owner = 'Microsoft.UI.Xaml.Hosting.ElementCompositionPreview';
  for (const name of ['GetElementVisual', 'GetElementChildVisual', 'SetElementChildVisual', 'SetIsTranslationEnabled']) {
    registry.register({owner, kind: 'method', name}, ({context, args, descriptor}) => {
      const service = context.state(null, 'composition-preview', () => new PreviewService(context));
      context.state(args[0], 'composition-preview-lease', () => service.preview.lease(args[0]));
      const parameters = [args[0], ...args.slice(1).map((value, index) => fromCompositionArgument(context, value, descriptor.parameters[index + 1]))];
      const result = toCompositionResult(context, service.preview[name](...parameters), descriptor.result);
      context.syncOwner?.(args[0]);
      return result;
    });
  }
}

function registerDashArrayAdapters(registry) {
  registry.register({owner: C + 'CompositionStrokeDashArray', kind: 'method', name: 'IndexOf', arity: 2},
    ({context, receiver, args}) => {
      const index = nativeModel(context, receiver).IndexOf(context.native(args[0]));
      context.writeReference(args[1], context.managed(Math.max(0, index), 'uint'));
      return context.managed(index >= 0, 'bool');
    });
  for (const name of ['CopyTo', 'GetMany']) {
    registry.register({owner: C + 'CompositionStrokeDashArray', kind: 'method', name, arity: 2}, ({context, receiver, args}) => {
      const model = nativeModel(context, receiver);
      const array = args[name === 'CopyTo' ? 0 : 1];
      const index = context.native(args[name === 'CopyTo' ? 1 : 0]);
      const length = context.arrayLength(array);
      if (!Number.isInteger(index) || index < 0 || index > (name === 'CopyTo' ? length - model.Count : model.Count)) {
        throw new RangeError('Invalid stroke dash destination or source index');
      }
      const count = name === 'CopyTo' ? model.Count : Math.min(length, model.Count - index);
      for (let offset = 0; offset < count; offset++) {
        context.arraySet(array, name === 'CopyTo' ? index + offset : offset,
          context.managed(model.GetAt(name === 'CopyTo' ? offset : index + offset), 'float'));
      }
      return name === 'CopyTo' ? null : context.managed(count, 'uint');
    });
  }
}

function registerImageSurface(registry) {
  const owner = 'Microsoft.UI.Xaml.Media.LoadedImageSurface';
  registry.register({owner, kind: 'method', name: 'StartLoadFromUri'}, ({context, args}) => {
    const uri = context.native(context.read(args[0], 'AbsoluteUri') ?? args[0]);
    const model = new LoadedImageSurface(uri, {load: context.services.loadCompositionImage});
    const reference = context.wrapModel(model, owner);
    model.ready.catch(error => context.services.onError?.(error));
    return reference;
  });
  registry.register({owner, kind: 'method', name: 'Dispose'}, ({context, receiver}) => {
    context.unwrapModel(receiver).dispose();
    return null;
  });
  for (const [kind, prefix, operation] of [['eventAdd', 'add_', 'add'], ['eventRemove', 'remove_', 'remove']]) {
    registry.register({owner, kind, name: prefix + 'LoadCompleted'}, ({context, receiver, args}) => {
      const bindings = context.state(receiver, 'loaded-image-event', () =>
        new CompositionEventBindings(context.unwrapModel(receiver), context, receiver, 'LoadCompleted'));
      bindings[operation](args[0]);
      return null;
    });
  }
}

function registerPropertySetReads(registry) {
  for (const [kind, type] of Object.entries(compositionPropertyTypes)) {
    registry.register({owner: C + 'CompositionPropertySet', kind: 'method', name: 'TryGet' + kind}, ({context, receiver, args}) => {
      const result = nativeModel(context, receiver).tryGet(context.native(args[0]), kind);
      const fallback = kind === 'Boolean' ? false : kind === 'Scalar' ? 0 : Array(kind === 'Matrix4x4' ? 16
        : kind === 'Vector2' ? 2 : kind === 'Vector3' ? 3 : 4).fill(0);
      context.writeReference(args[1], toCompositionResult(context, result.value ?? fallback, type));
      return context.managed({Succeeded: 0, TypeMismatch: 1, NotFound: 2}[result.status], C + 'CompositionGetValueStatus');
    });
  }
}
