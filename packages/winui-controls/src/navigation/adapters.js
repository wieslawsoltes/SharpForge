import { registerPaneAdapters } from './pane-adapters.js';
import { NavigationFrame } from './frame.js';
import { XAML as X, CONTROLS as C, read, registerMethod, registerGet, registerSet, invokeHost } from '../policy/adapter-helpers.js';
import { ControlError } from '../policy/events.js';

const navigationNamespace = X + 'Navigation.';
const modes = { New: 0, Back: 1, Forward: 2, Refresh: 3 };

function pageEvent(context, page, method, args, cancellable = false) {
  if (!page) return;
  const type = navigationNamespace + (cancellable ? 'NavigationCancelEventArgs' : 'NavigationEventArgs');
  const managed = context.managed({ ...args, NavigationMode: modes[args.NavigationMode] ?? args.NavigationMode }, type);
  context.invokeVirtual(page, method, [managed]);
  if (cancellable && read(context, managed, 'Cancel', false)) args.Cancel = true;
}

export function managedNavigationFrame(context, receiver) {
  const frame = context.state(receiver, 'family.frame', () => {
    const value = new NavigationFrame({
      factory(type, parameter) {
        if (context.services.navigationFactories) return context.services.navigationFactories(type, parameter, context);
        const native = context.native(type);
        const typeName = typeof native === 'string' ? native : native?.FullName ?? native?.name ?? native?.typeName;
        if (!typeName) throw new ControlError('SFUI1671', 'Page type has no resolvable managed type name');
        return context.make(typeName, []);
      }, cacheMode: page => read(context, page, 'NavigationCacheMode', 0),
      hooks: {
        setFrame: page => context.write(page, 'Frame', receiver),
        navigating: (page, args) => pageEvent(context, page, 'OnNavigatingFrom', args, true),
        navigatedFrom: (page, args) => pageEvent(context, page, 'OnNavigatedFrom', args),
        navigated(page, args) {
          pageEvent(context, page, 'OnNavigatedTo', args);
          context.services.themeTransitions?.contentChanged?.(receiver, args.NavigationTransitionInfo);
        }, cancelled: () => context.services.connectedAnimations?.cancelNavigation?.(),
        failed: () => context.services.connectedAnimations?.cancelNavigation?.()
      }
    });
    for (const name of ['Navigating', 'Navigated', 'NavigationStopped', 'NavigationFailed']) value.on(name, args => {
      if (name === 'Navigated') publishFrame(context, receiver, value);
      const payload = { ...args, NavigationMode: modes[args.NavigationMode] ?? args.NavigationMode };
      context.emit(receiver, name, payload);
      args.Cancel ||= payload.Cancel;
      args.Handled ||= payload.Handled;
    });
    return value;
  });
  frame.setCacheSize(read(context, receiver, 'CacheSize', 10));
  frame.stackEnabled = read(context, receiver, 'IsNavigationStackEnabled', true);
  return frame;
}

function publishFrame(context, receiver, frame) {
  context.write(receiver, 'Content', frame.content);
  context.write(receiver, 'CanGoBack', frame.canGoBack); context.write(receiver, 'CanGoForward', frame.canGoForward);
  context.write(receiver, 'BackStackDepth', frame.backStackDepth);
  context.write(receiver, 'CurrentSourcePageType', frame.current?.type ?? null);
  for (const [name, entries] of [['BackStack', frame.backStack], ['ForwardStack', frame.forwardStack]]) {
    const values = entries.map(entry => context.allocate(navigationNamespace + 'PageStackEntry',
      { SourcePageType: entry.type, Parameter: entry.parameter, NavigationTransitionInfo: entry.transition }));
    context.write(receiver, name, context.collection(values, C + 'ItemCollection'));
  }
}

export function registerNavigationAdapters(registry) {
  registerPaneAdapters(registry);
  registerMethod(registry, C + 'Frame', 'Navigate', (c, r, args) =>
    c.managed(managedNavigationFrame(c, r).navigate(args[0], args[1] ?? null, args[2] ?? null), 'bool'));
  registerMethod(registry, C + 'Frame', 'GoBack', (c, r) => { managedNavigationFrame(c, r).goBack(); });
  registerMethod(registry, C + 'Frame', 'GoForward', (c, r) => { managedNavigationFrame(c, r).goForward(); });
  for (const [property, field] of [['CanGoBack', 'canGoBack'], ['CanGoForward', 'canGoForward'],
    ['BackStackDepth', 'backStackDepth']]) registerGet(registry, C + 'Frame', property, (c, r) => managedNavigationFrame(c, r)[field]);
  registerSet(registry, C + 'Frame', 'CacheSize', (c, r, value) => {
    const frame = managedNavigationFrame(c, r); frame.setCacheSize(Number(c.native(value))); c.write(r, 'CacheSize', frame.cacheSize);
  });
  for (const name of ['OnNavigatingFrom', 'OnNavigatedFrom', 'OnNavigatedTo']) {
    registerMethod(registry, C + 'Page', name, () => undefined);
  }
  for (const name of ['Flyout', 'MenuFlyout', 'ToolTip', 'TeachingTip', 'ContentDialog', 'CommandBarFlyout',
    'TextCommandBarFlyout', 'DatePickerFlyout', 'TimePickerFlyout']) {
    const owner = C + name;
    registerMethod(registry, owner, 'ShowAt', (c, r, args) => { invokeHost(c, r, 'ShowAt', args); });
    registerMethod(registry, owner, 'Show', (c, r) => { invokeHost(c, r, 'Show', []); });
    registerMethod(registry, owner, 'Hide', (c, r) => { invokeHost(c, r, 'Hide', []); });
  }
  registerMethod(registry, C + 'ContentDialog', 'ShowAsync', (c, r) =>
    c.task(Promise.resolve(invokeHost(c, r, 'ShowAsync', [])), { resultType: C + 'ContentDialogResult' }));
}
