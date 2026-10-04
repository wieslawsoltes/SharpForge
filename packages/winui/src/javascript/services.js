import {initializeBindingContext, registerPropertyAdapters, registerObjectModelAdapters, getResourceServices,
  UIObjectTree, ValueSource, EffectiveValueEmitter, visualStateManagerModel,
  initializeItemsContext, initializeContentPresentation, ItemContainerGenerator} from '@sharpforge/winui-properties';
import {registerControlFamilyAdapters, createControlServices, createLayoutTemplateServices,
  RoutedEventRouter} from '@sharpforge/winui-controls';
import {registerRenderingAdapters, materializeRenderingResource, typeOfRenderingModel,
  FrameScheduler, syncRenderingModelProperty, createRenderingBrushConnections} from '@sharpforge/rendering';
import {AnimationClock} from '@sharpforge/framework';
import {initializeJavaScriptWindowLifetimes} from './app-lifetimes.js';
import {facadeRoutedEventArgs, completeFacadeRoute} from './events.js';

export function createJavaScriptFrameScheduler(root, options) {
  const view = root.ownerDocument.defaultView;
  return options.scheduler ?? new FrameScheduler({
    requestFrame: options.requestFrame ?? (callback => view.requestAnimationFrame(callback)),
    cancelFrame: options.cancelFrame ?? (id => view.cancelAnimationFrame(id)), onError: options.onError
  });
}

/** A15 application services on the released host. Retained layout/input/automation and composition are activated by later stacks. */
export function initializeJavaScriptServices(context) {
  const {host, options} = context;
  const view = host.document.defaultView;
  const scheduler = context.frameScheduler ?? createJavaScriptFrameScheduler(host.root, options);
  context.frameScheduler = scheduler;
  context.ownsFrameScheduler = !options.scheduler;
  context.controlServices = createControlServices({...options.uiCapabilities, document: host.document, window: view,
    services: context.services});
  Object.assign(context.services, context.controlServices, options.uiServices);
  host.services ??= context.services;
  initializeJavaScriptWindowLifetimes(context);
  context.services.stringResourceLoader ??= context.controlServices.resources;
  context.services.scheduler ??= scheduler;
  context.services.clockFactory ??= values => new AnimationClock(values);
  context.services.visualStates ??= {apply: (node, states) => {
    const owner = node?.$node ? node : context.objects.get(node.id);
    if (owner) for (const state of states) visualStateManagerModel(context, owner).goToState(state, true);
  }};
  host.services.visualStates = context.services.visualStates;
  const router = new RoutedEventRouter({
    parentOf: id => context.parents.get(id) ?? null,
    contains: id => context.objects.has(id),
    onDispatch: (id, event, payload) => completeFacadeRoute(context, id, event, payload)
  });
  context.routedEventRouter = router;
  const disposeServices = context.controlServices.dispose;
  context.controlServices.dispose = () => { router.dispose(); disposeServices(); };
  host.services.scheduler = scheduler;
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
  registerRenderingAdapters(context.registry);
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
      if (context.isVisual(owner) && context.suppressedSceneProperty?.owner !== owner) context.host.schedule();
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
