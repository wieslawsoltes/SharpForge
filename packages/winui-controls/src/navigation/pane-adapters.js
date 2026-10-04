import { PaneState } from './pane.js';
import { CONTROLS as C, read, registerGet, registerSet, registerMethod } from '../policy/adapter-helpers.js';

/** Managed pane state uses the same synchronous cancellation semantics as the browser model. */
export function managedPane(context, receiver) {
  return context.state(receiver, 'family.pane', () => {
    const pane = new PaneState({ open: read(context, receiver, 'IsPaneOpen', false),
      displayMode: read(context, receiver, 'DisplayMode', null) });
    for (const name of ['PaneOpening', 'PaneClosing', 'PaneOpened', 'PaneClosed', 'DisplayModeChanged']) {
      pane.on(name, payload => {
        if (name === 'PaneOpened' || name === 'PaneClosed') context.write(receiver, 'IsPaneOpen', pane.open);
        if (name === 'DisplayModeChanged') context.write(receiver, 'DisplayMode', pane.displayMode);
        context.emit(receiver, name, payload);
      });
    }
    return pane;
  });
}

export function registerPaneAdapters(registry) {
  registerMethod(registry, C + 'NavigationView', '.ctor', context => {
    const owner = context.allocate(C + 'NavigationView');
    context.write(owner, 'SettingsItem', context.allocate(C + 'NavigationViewItem', { Content: 'Settings',
      Icon: context.allocate(C + 'SymbolIcon', { Symbol: 0xe115 }) }));
    return owner;
  }, { kind: 'constructor' });
  for (const type of ['NavigationView', 'SplitView']) {
    registerGet(registry, C + type, 'IsPaneOpen', (context, receiver) => managedPane(context, receiver).open);
    registerSet(registry, C + type, 'IsPaneOpen', (context, receiver, value) => {
      managedPane(context, receiver).setOpen(context.native(value));
    });
  }
  registerGet(registry, C + 'NavigationView', 'SettingsItem', (context, receiver) => {
    let item = context.read(receiver, 'SettingsItem');
    if (!item) {
      item = context.allocate(C + 'NavigationViewItem', { Content: 'Settings',
        Icon: context.allocate(C + 'SymbolIcon', { Symbol: 0xe115 }) });
      context.write(receiver, 'SettingsItem', item);
    }
    return item;
  });
}

/** Synchronizes structural input before the caller dispatches the typed event once. */
export function applyNavigationInput(context, receiver, type, event, payload) {
  if (['NavigationView', 'SplitView'].includes(type)) {
    if (event === 'PaneOpened' || event === 'PaneClosed') {
      const model = managedPane(context, receiver);
      model.open = event === 'PaneOpened';
      context.write(receiver, 'IsPaneOpen', model.open);
      return true;
    }
    if (event === 'DisplayModeChanged' && type === 'NavigationView') {
      const model = managedPane(context, receiver);
      model.displayMode = payload.DisplayMode;
      context.write(receiver, 'DisplayMode', model.displayMode);
      return true;
    }
    if (event === 'ItemExpanding' || event === 'ItemCollapsed') {
      if (payload.ExpandingItemContainer) context.write(payload.ExpandingItemContainer, 'IsExpanded', event === 'ItemExpanding');
      return true;
    }
  }
  if (event !== 'SelectionChanged' || !['NavigationView', 'TabView', 'Pivot'].includes(type)) return false;
  const item = payload.SelectedItem ?? payload.AddedItems?.[0] ?? null;
  context.write(receiver, 'SelectedItem', item);
  context.write(receiver, 'SelectedIndex', payload.SelectedIndex ?? payload.value ?? -1);
  if (payload.PreviousItemContainer) context.write(payload.PreviousItemContainer, 'IsSelected', false);
  if (payload.SelectedItemContainer) context.write(payload.SelectedItemContainer, 'IsSelected', true);
  return true;
}
