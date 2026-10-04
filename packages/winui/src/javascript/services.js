import {initializeBindingContext, registerPropertyAdapters, registerObjectModelAdapters, getResourceServices,
  UIObjectTree, ValueSource, EffectiveValueEmitter, visualStateManagerModel, installDefaultTemplateCatalog,
  initializeItemsContext, initializeContentPresentation, ItemContainerGenerator} from '@sharpforge/winui-properties';
import {registerControlFamilyAdapters, createControlServices, registerLayoutAdapters, materializeDefaultControlStyle,
  registerAutomationMemberAdapters, createAutomationMemberServices, DragServices,
  createLayoutTemplateServices} from '@sharpforge/winui-controls';
import {registerRenderingAdapters, registerCompositionAdapters, materializeRenderingResource, serializeRenderingValue,
  typeOfRenderingModel, createCompositionServices, FrameScheduler, syncRenderingModelProperty,
  createRenderingBrushConnections} from '@sharpforge/rendering';
import {AnimationClock} from '@sharpforge/framework';
import {initializeJavaScriptWindowLifetimes} from './app-lifetimes.js';
import {facadeRoutedEventArgs} from './events.js';

export function createJavaScriptFrameScheduler(root, options) {
  const view = root.ownerDocument.defaultView;
  return options.scheduler ?? new FrameScheduler({
    requestFrame: options.requestFrame ?? (callback => view.requestAnimationFrame(callback)),
    cancelFrame: options.cancelFrame ?? (id => view.cancelAnimationFrame(id)), onError: options.onError
  });
}

/** Share renderer services by explicit projection; resource strings and GPU resource tables remain distinct. */
export function initializeJavaScriptServices(context) {
  const {host, options} = context;
  const view = host.document.defaultView;
  const scheduler = context.frameScheduler ?? createJavaScriptFrameScheduler(host.root, options);
  context.frameScheduler = scheduler;
  context.ownsFrameScheduler = !options.scheduler;
  context.controlServices = createControlServices({...options.uiCapabilities, document: host.document, window: view,
    services: context.services});
  Object.assign(context.services, context.controlServices, options.uiServices);
  for (const name of ['environment', 'textScale', 'inputPane', 'systemColors']) context.services[name] = host.services[name];
  initializeJavaScriptWindowLifetimes(context);
  context.services.stringResourceLoader ??= context.controlServices.resources;
  context.services.scheduler ??= scheduler;
  context.services.clockFactory ??= values => new AnimationClock(values);
  context.services.text ??= host.services.text;
  context.services.layout ??= {getLayout: value => host.getLayout(typeof value === 'string' ? value : context.id(value)),
    invoke: (value, name, args) => {
      const result = host.invoke(value ? context.id(value) : null, name, args);
      return ['GetFocusedElement', 'FindNextElement', 'TryGetElement'].includes(name) && result != null ? context.reference(result) : result;
    }};
  context.services.controls ??= {invoke: (value, name, args) => {
    return host.invoke(value ? context.id(value) : null, name, args.map(item => context.value(item)));
  }};
  context.services.visualStates ??= {apply: (node, states) => {
    const owner = node?.$node ? node : context.objects.get(node.id);
    if (owner) for (const state of states) visualStateManagerModel(context, owner).goToState(state, true);
  }};
  host.services.visualStates = context.services.visualStates;
  context.services.automation ??= createAutomationMemberServices(context, {tree: host.automation, synchronize: () => host.flush()});
  context.services.drag ??= new DragServices(context, {send: command => host.apply(command),
    readFiles: (token, request) => host.input.dragDrop.files.read(token, request)});
  context.routedEventRouter = host.eventRouter;
  context.routedEventArgs = payload => facadeRoutedEventArgs(context, payload);
  context.dispatcherServices = {schedule: callback => queueMicrotask(callback), currentThread: () => 'ui',
    uiThread: 'ui', enterThread: action => action()};
  context.scheduleUI = callback => queueMicrotask(() => { if (!context.disposed) callback(); });
  context.materializeResource = (value, type) => materializeRenderingResource(context, value, type);
  initializeBindingContext(context);
  initializeItemsContext(context);
  context.layoutTemplates = createLayoutTemplateServices(context, {
    createGenerator: options => new ItemContainerGenerator({adapter: context.itemContainerAdapter, ...options}),
    publish: (owner, value) => {
      context.sceneJournal?.captureObject(owner);
      owner.$values.$layoutTemplates = value;
      context.send({op: 'set', id: context.id(owner), property: '$layoutTemplates', value});
    }
  });
  initializeContentPresentation(context);
  host.services.itemContainers = context.services.itemContainers;
  registerPropertyAdapters(context.registry);
  registerObjectModelAdapters(context.registry);
  registerControlFamilyAdapters(context.registry);
  registerLayoutAdapters(context.registry);
  registerAutomationMemberAdapters(context.registry);
  registerRenderingAdapters(context.registry);
  registerCompositionAdapters(context.registry);
  installDefaultTemplateCatalog(context, materializeDefaultControlStyle);
  initializeComposition(context, scheduler);
  context.brushConnections = createRenderingBrushConnections(context);
  initializeValueDependencies(context);
}

export function javascriptObjectTree(context) {
  return new UIObjectTree({onEvent: (owner, event, payload) => {
    if (!owner?.$node || context.restoring) return;
    if (event === 'Loaded') context.getBindingOperations().loaded(context.storeFor(owner));
    if (event === 'Unloaded') context.getBindingOperations().unloaded(context.storeFor(owner));
    context.bindingLifecycle?.(owner, event);
    if (event === 'Loaded') context.brushConnections?.attach(owner);
    if (event === 'Unloaded') context.brushConnections?.detach(owner);
    context.emit(owner, event, payload);
  }});
}

function initializeComposition(context, scheduler) {
  const {host, services} = context;
  const composition = createCompositionServices({clockFactory: services.clockFactory, scheduler,
    environment: services.environment,
    onInvalidate: () => host.scheduleRender(),
    elementId: value => context.id(value), preview: {
      isElement: value => context.isVisual(value), getLayout: value => host.getLayout(context.id(value)),
      getOpacity: value => context.read(value, 'Opacity') ?? 1,
      setComposition: (value, entry) => host.setElementComposition(context.id(value), entry),
      keyFor: value => context.id(value), ownerReference: value => new WeakRef(value),
      resolveAlive: reference => reference.deref(),
      registerOwner: (owner, lease) => context.state(owner, 'composition-preview-lease', () => lease)
    },
    themes: {transitionsFor: (owner, name) => {
      const values = context.read(owner, name);
      return values ? context.items(values).map(value => context.unwrapModel(value)) : [];
    }, ...services.themeTransitionsOptions},
    implicit: {getTransition: (owner, name) => context.unwrapModel(context.read(owner, name)),
      setBrush: (owner, property, brush) => host.setCompositionBrush(context.id(owner), property, brush),
      getColorBrush: value => {
        const brush = serializeRenderingValue(context.unwrapModel(value));
        return brush?.Color ?? brush?.color ?? brush;
      }, ...services.implicitTransitionsOptions},
    connected: {getBounds: value => host.getLayout(context.id(value))?.rect, ...services.connectedAnimationsOptions}
  });
  context.composition = composition;
  services.onCompositionInvalidate ??= () => host.scheduleRender();
  for (const name of ['createCompositionTransport', 'compositionPreview', 'elementCompositionPreview',
    'themeTransitions', 'implicitTransitions', 'connectedAnimations', 'navigationTransitions']) services[name] ??= composition[name];
}

function initializeValueDependencies(context) {
  const emitter = new EffectiveValueEmitter({
    isMutableValue: value => !!typeOfRenderingModel(context.unwrapModel(value)) || Array.isArray(value) ||
      ['value', 'brush', 'rendering'].includes(context.frameworkRegistry.frameworkType(context.typeOf(value))?.kind),
    valuesOf: value => value.$node ? {model: context.state(value, 'nativeModel'), values: value.$values} : value.data ?? value.items ?? value,
    emit: (owner, property) => {
      if (!context.objects.has(owner.$node.id)) return;
      const value = context.storeFor(owner).getValue(property);
      emitter.track(owner, property, value);
      context.send({op: 'set', id: context.id(owner), property: property.name, value: context.value(value)});
    }
  });
  context.valueDependencies = {
    changed: change => emitter.track(change.owner, change.property, change.newValue),
    mutated(owner) {
      emitter.mutated(owner);
      emitter.mutated(context.unwrapModel(owner));
      if (context.isVisual(owner) && context.suppressedSceneProperty?.owner !== owner) context.host.invalidate(context.id(owner), 'render');
    },
    remove: owner => emitter.remove(owner)
  };
  context.services.invalidateRendering ??= owner => context.valueDependencies.mutated(owner);
  context.services.invalidateCanvas ??= owner => context.emit(typeof owner === 'string' ? context.reference(owner) : owner, 'Draw');
  context.propertyChanged = change => {
    syncRenderingModelProperty(context, change.owner, change.property.name, change.newValue);
    context.valueDependencies.changed(change);
    context.valueDependencies.mutated(change.owner);
    context.brushConnections.propertyChanged(change);
    context.presentationChanged(change);
    context.layoutTemplates.changed(change);
    if (context.storeFor(change.owner).getValueSource(change.property) !== ValueSource.Animation) {
      context.composition.propertyChanged(change.owner, change.property.name, change.oldValue, change.newValue);
    }
  };
}

export function prepareJavaScriptVisuals(context, owner) {
  const queue = [owner], seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    const object = queue[index];
    if (!object?.$node || seen.has(object)) continue;
    if (seen.size >= 100000) throw new RangeError('Visual preparation limit');
    seen.add(object);
    context.objectTree.register(context.id(object), {value: object});
    if (context.propertyRegistry.lookup(context.typeOf(object), 'Style')) getResourceServices(context).applyStyle(object);
    if (context.propertyRegistry.lookup(context.typeOf(object), 'Template')) getResourceServices(context).applyTemplate(object);
    context.layoutTemplates.prepare(object);
    queue.push(...context.templateHostAdapter.children(object));
    if (object.$values.$templateRoot) queue.push(object.$values.$templateRoot);
  }
  context.flushContentPresenters?.();
}

export function animationSourceAccess(context) {
  const property = (owner, name) => context.propertyRegistry.lookup(owner.$node.type, name.replace(/^\$/, ''));
  return {
    read: (owner, name) => property(owner, name) ? context.storeFor(owner).getValue(property(owner, name)) : owner.$values[name],
    base: (owner, name) => property(owner, name) ? context.storeFor(owner).getBaseValue(property(owner, name), ValueSource.Animation)
      : owner.$values[name],
    write: (owner, name, value, options) => withSceneProjection(context, owner, name, options, () => {
      const token = property(owner, name);
      if (token) context.styles.setSource(owner, token, ValueSource.Animation, value);
      else { owner.$values[name] = value; context.styles.valueChanged(owner); }
    }),
    clear: (owner, name, options) => withSceneProjection(context, owner, name, options, () => {
      const token = property(owner, name);
      if (token) context.styles.clearSource(owner, token, ValueSource.Animation);
    })
  };
}

function withSceneProjection(context, owner, name, options, action) {
  const previous = context.suppressedSceneProperty;
  if (options?.independent) context.suppressedSceneProperty = {owner, name: name.replace(/^\$/, '')};
  try { return action(); } finally { context.suppressedSceneProperty = previous; }
}
