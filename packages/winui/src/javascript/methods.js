import {XAML, CONTROLS} from '@sharpforge/framework';
import {managedWindow, managedApplication} from '@sharpforge/winui-controls';
import {prepareJavaScriptVisuals} from './services.js';
import {invokeFacadeCollection} from './collections.js';

function findName(context, receiver, args) {
  const queue = [receiver];
  const seen = new Set();
  while (queue.length) {
    const object = queue.pop();
    if (!object?.$node || seen.has(object)) continue;
    if (seen.size >= 10000) throw new RangeError('Name lookup visual tree limit');
    seen.add(object);
    if (object.Name === args[0]) return object;
    for (const value of Object.values(object.$values)) if (value?.$node) queue.push(value);
    for (const values of Object.values(object.$collections)) queue.push(...values);
  }
  return null;
}

function drawing(context, receiver, args, descriptor) {
  if (descriptor.name === 'Clear') receiver.$drawing = [];
  else {
    if ((receiver.$drawing?.length ?? 0) >= 10000) throw new RangeError('Drawing command limit');
    (receiver.$drawing ??= []).push({op: descriptor.name, args: args.map(value => context.value(value))});
  }
  context.send({op: 'draw', id: receiver.$node.id, commands: [...(receiver.$drawing ?? [])]});
}

/** Released facade operations remain a separate fallback table beneath registered service adapters. */
export function createReleasedMethods(context) {
  const methods = new Map();
  const register = (owner, name, handler) => methods.set(owner + '::' + name, handler);
  register(XAML + 'Window', 'Activate', receiver => {
    const window = managedWindow(context, receiver);
    const application = context.application ? managedApplication(context, context.application) : context.controlServices.application;
    const id = context.id(receiver);
    if (!application.windows.has(id)) application.registerWindow(id, window);
    window.activate();
    prepareJavaScriptVisuals(context, receiver);
    context.sceneJournal?.captureModel(context.objectTree);
    context.objectTree.roots.add(receiver.$node.id);
    context.send({op: 'activate', id: receiver.$node.id});
  });
  register(XAML + 'Window', 'Close', receiver => {
    managedWindow(context, receiver).close().catch(error => {
      if (context.options.onError) return context.options.onError(error);
      const application = context.application ? managedApplication(context, context.application) : context.controlServices.application;
      application.unhandled(error);
    });
  });
  register(XAML + 'Application', 'Exit', receiver => {
    const owner = receiver?.$node ? receiver : context.application;
    const application = owner ? managedApplication(context, owner) : context.controlServices.application;
    application.exit();
  });
  register(XAML + 'UIElement', 'Focus', receiver => { context.send({op: 'focus', id: receiver.$node.id}); return true; });
  register(CONTROLS + 'Control', 'Focus', receiver => { context.send({op: 'focus', id: receiver.$node.id}); return true; });
  register(XAML + 'FrameworkElement', 'FindName', (receiver, args) => findName(context, receiver, args));
  for (const name of ['Show', 'Hide']) register(CONTROLS + 'ContentDialog', name, receiver => { receiver.IsOpen = name === 'Show'; });
  for (const name of ['ShowAt', 'Hide']) register(CONTROLS + 'MenuFlyout', name, (receiver, args) => {
    context.send({op: 'flyout', id: receiver.$node.id, anchor: args[0]?.$node.id, show: name === 'ShowAt'});
  });
  for (const name of ['Clear', 'FillRectangle', 'DrawLine', 'FillEllipse']) {
    register('SharpForge.UI.DrawingSurface', name, (receiver, args, descriptor) => drawing(context, receiver, args, descriptor));
  }
  register('Windows.UI.Color', 'FromArgb', (receiver, args) => context.values.create('Windows.UI.Color', args));
  for (const [name, scale] of [['FromMilliseconds', 1], ['FromSeconds', 1000], ['FromMinutes', 60000]]) {
    register('System.TimeSpan', name, (receiver, args) => context.values.create('System.TimeSpan', [args[0] * scale]));
  }
  return methods;
}

export function invokeFacadeMethod(context, receiver, descriptor, args) {
  const extension = context.invoke(descriptor, receiver, args);
  if (extension.handled) return extension.value;
  const animated = context.animations.invoke(receiver, descriptor, args);
  if (animated.handled) return animated.value;
  const styled = context.styles.invoke(receiver, descriptor.name, args);
  if (styled.handled) return styled.value;
  if (descriptor.kind === 'attachedGet' || descriptor.kind === 'attachedSet') {
    const property = context.styles.registry.lookup(descriptor.owner, descriptor.name.slice(3));
    const object = args[0];
    context.id(object);
    if (!property) throw new TypeError('Unregistered attached property');
    if (descriptor.kind === 'attachedGet') return context.styles.storeFor(object).getValue(property);
    context.styles.storeFor(object).setValue(property, args[1]);
    return undefined;
  }
  const collection = invokeFacadeCollection(context, receiver, descriptor, args);
  if (collection.handled) return collection.value;
  let owner = descriptor.owner;
  const seen = new Set();
  while (owner && !seen.has(owner)) {
    seen.add(owner);
    const handler = context.releasedMethods.get(owner + '::' + descriptor.name);
    if (handler) return handler(receiver, args, descriptor);
    owner = context.baseType(owner);
  }
  throw new TypeError('Unsupported JavaScript method ' + descriptor.owner + '::' + descriptor.name);
}
