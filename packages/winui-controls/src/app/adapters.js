import { ApplicationSession } from './application.js';
import { WindowSession } from './window.js';
import { DataPackage } from './data-transfer.js';
import { ResourceLoader } from './resources.js';
import { registerResourceManagerAdapters } from './resource-adapters.js';
import { XAML as X, CONTROLS as C, DATA as D, read, registerMethod, registerGet, registerSet,
  requireService, invokeHost, retain, unsupported } from '../policy/adapter-helpers.js';

const W = 'Microsoft.UI.Windowing.', A = 'Microsoft.Windows.AppLifecycle.';
const resourceTypes = ['Microsoft.Windows.ApplicationModel.Resources.ResourceLoader', 'Windows.ApplicationModel.Resources.ResourceLoader'];

export function managedWindow(context, receiver) {
  const model = context.state(receiver, 'family.window', () => {
    const value = new WindowSession({ title: read(context, receiver, 'Title', ''), platform: context.services.windowPlatform ?? {} });
    value.owner = receiver;
    for (const name of ['Activated', 'VisibilityChanged', 'SizeChanged', 'Closing', 'Closed']) {
      value.on(name, args => {
        if (name === 'VisibilityChanged') context.write(receiver, 'Visible', args.Visible);
        context.emit(receiver, name, args);
        const appWindow = context.read(receiver, 'AppWindow');
        if (context.native(appWindow) && name === 'Closing') context.emit(appWindow, 'Closing', args);
      });
    }
    value.on('CloseCommitted', args => {
      try {
        const appWindow = context.read(receiver, 'AppWindow');
        if (context.native(appWindow)) context.emit(appWindow, 'Destroying', args);
      } finally { context.windowClosed?.(value.owner); }
    });
    value.on('Changed', args => {
      const appWindow = context.read(receiver, 'AppWindow');
      if (context.native(appWindow)) context.emit(appWindow, 'Changed', args);
    });
    return value;
  });
  const owner = model.owner ?? receiver;
  model.title = read(context, owner, 'Title', model.title);
  model.content = context.read(owner, 'Content') ?? model.content;
  return model;
}

function windowPart(context, receiver, property, type) {
  let part = context.read(receiver, property);
  if (!context.native(part)) {
    part = context.allocate(type, {}); context.write(receiver, property, part);
    context.state(part, 'family.window', () => retain(managedWindow(context, receiver), receiver));
  }
  return part;
}

export function managedApplication(context, receiver) {
  return context.state(receiver, 'family.application', () => {
    const model = new ApplicationSession({ resources: context.read(receiver, 'Resources'), saveState: context.services.saveApplicationState });
    model.state = 'running';
    for (const name of ['Suspending', 'Resuming', 'LeavingBackground', 'EnteredBackground', 'UnhandledException', 'Launched', 'Activated']) {
      model.on(name, args => context.emit(receiver, name, args));
    }
    model.on('Exiting', () => context.applicationExited?.());
    return model;
  });
}

function packageModel(context, receiver) { return context.state(receiver, 'family.dataPackage', () => new DataPackage()); }

export { packageModel as managedDataPackage, packageView as createDataPackageView };

function packageView(context, model) {
  const reference = context.allocate(D + 'DataPackageView', {}), view = new DataPackage();
  view.restore(model.snapshot()); context.state(reference, 'family.dataPackage', () => view); return reference;
}

function resources(context, receiver) {
  return context.state(receiver, 'family.resources', () => {
    const service = requireService(context, 'resources');
    const dictionaries = context.services.resourceDictionaries ?? Object.fromEntries([...service.resources]
      .map(([language, values]) => [language, Object.fromEntries(values)]));
    return new ResourceLoader({ resources: dictionaries, language: read(context, receiver, 'Language', service.language),
      fallbackLanguage: service.fallbackLanguage });
  });
}

export function registerApplicationAdapters(registry) {
  registerResourceManagerAdapters(registry);
  registerWindowAdapters(registry);
  registerMethod(registry, X + 'Application', 'SuspendAsync', (c, r) => c.task(managedApplication(c, r).suspend(), { resultType: 'bool' }));
  registerMethod(registry, X + 'Application', 'Resume', (c, r) => managedApplication(c, r).resume());
  registerDataAdapters(registry);
  for (const owner of resourceTypes) {
    registerMethod(registry, owner, 'GetString', (c, r, args) => c.managed(resources(c, r).getString(String(c.native(args[0]))), 'string'));
    registerSet(registry, owner, 'Language', (c, r, value) => {
      const model = resources(c, r); model.setLanguage(String(c.native(value))); c.write(r, 'Language', model.language);
    });
    registerGet(registry, owner, 'Language', (c, r) => resources(c, r).language);
    for (const name of ['GetForCurrentView', 'GetForViewIndependentUse']) registerMethod(registry, owner, name,
      c => c.singleton('family.resources.' + owner, () => c.allocate(owner, { Language: c.services.resources?.language ?? 'en-US' })));
  }
  registerMethod(registry, A + 'AppInstance', 'GetCurrent', c => c.singleton('family.appInstance', () => c.allocate(A + 'AppInstance', {})));
  registerMethod(registry, A + 'AppInstance', 'GetActivatedEventArgs', c => {
    const args = requireService(c, 'activation').getActivatedEventArgs();
    const kind = { Launch: 0, File: 3, Protocol: 4 }[args.Kind];
    return c.allocate(A + 'AppActivationArguments', { Kind: kind ?? -1,
      Data: c.allocate('SharpForge.UI.ActivationData', { Arguments: args.Data?.Arguments ?? '', Uri: args.Data?.Uri ?? '',
        Files: args.Data?.Files ?? [] }) });
  });
  registerMethod(registry, A + 'AppInstance', 'FindOrRegisterForKey', () => unsupported('Cross-process AppInstance registration'));
  registerMethod(registry, A + 'AppInstance', 'RedirectActivationToAsync', () => unsupported('Cross-process activation redirection'));
}

function registerWindowAdapters(registry) {
  registerGet(registry, X + 'Window', 'AppWindow', (c, r) => windowPart(c, r, 'AppWindow', W + 'AppWindow'));
  registerGet(registry, X + 'Window', 'Bounds', (c, r) => managedWindow(c, r).bounds);
  registerGet(registry, X + 'Window', 'Visible', (c, r) => managedWindow(c, r).visible);
  registerMethod(registry, X + 'Window', 'SetTitleBar', (c, r, args) => {
    const platform = c.services.windowPlatform;
    if (!platform?.setTitleBar) return unsupported('Window title-bar customization');
    const model = managedWindow(c, r);
    platform.setTitleBar(args[0]);
    model.titleBar = args[0];
  });
  registerMethod(registry, X + 'Window', 'CloseAsync', (c, r) => c.task(managedWindow(c, r).close(), { resultType: 'bool' }));
  registerMethod(registry, W + 'AppWindow', 'Resize', (c, r, args) => {
    const size = c.native(args[0]), model = managedWindow(c, r); model.resize(size.Width, size.Height);
    c.services.windowPlatform?.resize?.(model.bounds);
  });
  registerMethod(registry, W + 'AppWindow', 'Move', (c, r, args) => {
    const point = c.native(args[0]), model = managedWindow(c, r); model.move(point.X, point.Y);
    c.services.windowPlatform?.move?.(model.bounds);
  });
  for (const [name, visible] of [['Show', true], ['Hide', false]]) registerMethod(registry, W + 'AppWindow', name,
    (c, r) => { managedWindow(c, r).setVisible(visible); c.services.windowPlatform?.visibility?.(visible); });
  registerGet(registry, W + 'AppWindow', 'IsVisible', (c, r) => managedWindow(c, r).visible);
  registerGet(registry, W + 'AppWindow', 'Title', (c, r) => managedWindow(c, r).title);
  registerSet(registry, W + 'AppWindow', 'Title', (c, r, value) => {
    const model = managedWindow(c, r);
    model.title = String(c.native(value));
    c.write(r, 'Title', model.title);
    if (model.owner) c.write(model.owner, 'Title', model.title);
  });
  registerGet(registry, W + 'AppWindow', 'Size', (c, r) => {
    const bounds = managedWindow(c, r).bounds; return { Width: bounds.Width, Height: bounds.Height };
  });
  registerGet(registry, W + 'AppWindow', 'Position', (c, r) => {
    const bounds = managedWindow(c, r).bounds; return { X: bounds.X, Y: bounds.Y };
  });
  registerGet(registry, W + 'AppWindow', 'TitleBar', (c, r) => windowPart(c, r, 'TitleBar', W + 'AppWindowTitleBar'));
  registerMethod(registry, W + 'AppWindow', 'DestroyAsync', (c, r) => c.task(managedWindow(c, r).close(), { resultType: 'bool' }));
  registerMethod(registry, W + 'AppWindow', 'SetPresenterAsync', (c, r, args) =>
    c.task(managedWindow(c, r).setPresenter(['Overlapped', 'CompactOverlay', 'FullScreen', 'Overlapped'][Number(c.native(args[0]))]),
      { resultType: 'void' }));
  registerMethod(registry, W + 'AppWindowTitleBar', 'IsCustomizationSupported', c => c.managed(!!c.services.windowPlatform?.setTitleBar, 'bool'));
  for (const name of ['OverlappedPresenter', 'FullScreenPresenter', 'CompactOverlayPresenter']) registerMethod(registry, W + name, 'Create',
    c => c.allocate(W + name, {}));
}

function registerDataAdapters(registry) {
  registerGet(registry, D + 'DataPackage', 'RequestedOperation', (c, r) => packageModel(c, r).RequestedOperation);
  registerSet(registry, D + 'DataPackage', 'RequestedOperation', (c, r, value) => {
    const model = packageModel(c, r);
    model.RequestedOperation = Number(c.native(value));
    c.write(r, 'RequestedOperation', model.RequestedOperation);
  });
  for (const name of ['Text', 'Html', 'Uri']) {
    registerMethod(registry, D + 'DataPackage', 'Set' + name, (c, r, args) => packageModel(c, r).set(name, String(c.native(args[0]))));
    registerMethod(registry, D + 'DataPackageView', 'Get' + name + 'Async', (c, r) =>
      c.task(Promise.resolve(packageModel(c, r).get(name)), { resultType: 'string' }));
  }
  registerMethod(registry, D + 'DataPackage', 'GetView', (c, r) => packageView(c, packageModel(c, r)));
  registerMethod(registry, D + 'DataPackageView', 'Contains', (c, r, args) => c.managed(packageModel(c, r).contains(String(c.native(args[0]))), 'bool'));
  registerGet(registry, D + 'DataPackageView', 'AvailableFormats', (c, r) => packageModel(c, r).availableFormats);
  registerMethod(registry, D + 'Clipboard', 'SetContentAsync', (c, r, args) => c.task(
    requireService(c, 'clipboard').setContent(packageModel(c, args[0])).then(result => result.ok), { resultType: 'bool' }));
  registerMethod(registry, D + 'Clipboard', 'GetContentAsync', c => c.task(requireService(c, 'clipboard').getContent()
    .then(result => result.ok ? packageView(c, result.data) : null), { resultType: D + 'DataPackageView' }));
  registerMethod(registry, 'Windows.System.Launcher', 'LaunchUriAsync', (c, r, args) =>
    c.task(requireService(c, 'launcher').launchUri(String(c.native(args[0]))), { resultType: 'bool' }));
}
