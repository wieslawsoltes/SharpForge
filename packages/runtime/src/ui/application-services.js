import {createControlServices, managedWindow, managedApplication, createContextEnvironment} from '@sharpforge/winui-controls';
import {createCompositionServices, serializeRenderingValue} from '@sharpforge/rendering';
import {ValueSource, getResourceServices, visualStateManagerModel} from '@sharpforge/winui-properties';
import {XAML} from '@sharpforge/framework';
import {ManagedFault} from '../heap.js';
import {initializeManagedHostServices} from './host-services.js';

/** Host capabilities are injected once; all model operations still use the shared managed context. */
export function initializeManagedApplicationServices(context) {
  const platform = context.platform, options = platform.options;
  context.controlServices = createControlServices({...(options.uiCapabilities ?? {}), services: context.services});
  Object.assign(context.services, context.controlServices, options.uiServices);
  context.services.defaultStyleValues ??= (receiver, values) => platform.heap.withRoots([receiver], () => {
    for (const [name, value] of Object.entries(values)) {
      const property = context.properties.lookup(receiver, name);
      const managed = context.managed(value, property.propertyType);
      platform.heap.withRoots([managed], () => context.properties.setSource(receiver, property, ValueSource.DefaultStyle, managed));
    }
  });
  const environment = createContextEnvironment(context);
  context.services.systemColors ??= name => environment.SystemColors[name];
  context.services.stringResourceLoader ??= context.controlServices.resources;
  context.windowClosed = owner => finalizeManagedWindowClose(context, owner);
  context.applicationExited = () => {
    for (const owner of [...platform.windows.values()]) finalizeManagedWindowClose(context, owner);
    platform.animations.clear();
  };
  context.controlServices.application.on('Exiting', context.applicationExited);
  initializeManagedHostServices(context);
  const composition = context.state(null, 'compositionServices', () => createCompositionServices({
    clockFactory: context.services.clockFactory, scheduler: context.services.scheduler,
    environment,
    emit: options.onUIComposition, elementId: value => context.id(value),
    preview: {
      isElement: value => context.isVisual(value),
      keyFor: value => context.id(value), ownerReference: value => value,
      resolveAlive: value => context.isAlive(value) ? value : null,
      registerOwner: (owner, lease) => context.state(owner, 'composition-preview-lease', () => lease),
      getLayout: value => context.services.layout?.getLayout(value),
      getOpacity: value => context.native(context.read(value, 'Opacity')) ?? 1,
      ...context.services.compositionPreview
    },
    themes: {transitionsFor: (owner, name) => {
      const values = context.read(owner, name);
      return values ? context.items(values).map(value => context.unwrapModel(value)) : [];
    }, ...context.services.themeTransitionsOptions},
    implicit: {
      getTransition: (owner, name) => context.unwrapModel(context.read(owner, name)),
      getColorBrush: value => {
        const brush = serializeRenderingValue(context.unwrapModel(value));
        return brush?.Color ?? brush?.color ?? brush;
      },
      ...context.services.implicitTransitionsOptions
    },
    connected: {getBounds: owner => context.services.layout?.getLayout(owner)?.rect, ...context.services.connectedAnimationsOptions}
  }));
  context.composition = composition;
  for (const name of ['createCompositionTransport', 'compositionPreview', 'elementCompositionPreview',
    'themeTransitions', 'implicitTransitions', 'connectedAnimations', 'navigationTransitions']) context.services[name] ??= composition[name];
  context.services.independentTimelines ??= composition.createIndependentTimelines(platform.animations, value => context.id(value));
  const previous = context.propertyChanged;
  context.propertyChanged = change => {
    previous?.(change);
    const property = change.property;
    if (context.storeFor(change.owner).getValueSource(property) !== ValueSource.Animation) {
      composition.propertyChanged(change.owner, property.name, context.native(change.oldValue), context.native(change.newValue));
    }
    if (property.name === 'RequestedTheme') {
      const application = context.properties.assignable(XAML + 'Application', context.typeOf(change.owner));
      const themes = application ? ['Light', 'Dark'] : ['Default', 'Light', 'Dark'];
      context.resourceScopeFor(change.owner).setTheme(themes[Number(context.native(change.newValue))] ?? 'Default');
    }
    if (property.name === 'Style' || property.name === 'DefaultStyleKey') getResourceServices(context).applyStyle(change.owner);
    if (property.name === 'Template') getResourceServices(context).templateChanged(change.owner);
  };
  context.services.visualStates ??= {apply: (owner, states) => {
    for (const state of states) visualStateManagerModel(context, owner).goToState(state, true);
  }};
}

export function activateManagedWindow(context, owner) {
  const platform = context.platform;
  platform.windows.set(context.id(owner), owner);
  platform.set(owner, '$active', true);
  const model = managedWindow(context, owner);
  model.activate();
  const application = platform.application ? managedApplication(context, platform.application) : context.controlServices.application;
  if (!application.windows.has(context.id(owner))) application.registerWindow(context.id(owner), model);
  platform.raiseLifecycle(owner, 'Loaded');
  platform.command({op: 'activate', id: context.id(owner), snapshot: platform.scene()});
  context.services.automation?.publishTree?.();
}

export function closeManagedWindow(context, owner) {
  const closing = managedWindow(context, owner).close().then(closed => {
    if (closed) finalizeManagedWindowClose(context, owner);
  });
  context.task(closing, {resultType: 'void', roots: [owner]});
}

export function finalizeManagedWindowClose(context, owner) {
  const platform = context.platform;
  if (!context.isAlive(owner) || !platform.windows.has(context.id(owner))) return;
  const id = context.id(owner);
  platform.raiseLifecycle(owner, 'Unloaded');
  platform.windows.delete(id);
  context.controlServices.application.windows.delete(id);
  if (platform.application) managedApplication(context, platform.application).windows.delete(id);
  platform.set(owner, '$active', false);
  platform.command({op: 'close', id});
}

export function exitManagedApplication(context) {
  const application = context.platform.application
    ? managedApplication(context, context.platform.application) : context.controlServices.application;
  application.exit();
}

export function initializeExistingFrameworkReceiver(context, descriptor, args) {
  if (descriptor.kind !== 'constructor' || args.length !== descriptor.parameters?.length + 1) return false;
  if (!context.isAlive(args[0]) || !descriptor.owner.startsWith(XAML)) return false;
  return context.properties.assignable(descriptor.owner, context.typeOf(args[0]));
}
