import { managedPane } from '../navigation/pane-adapters.js';
import { registerItemsAdapters, managedSelectionModel, managedTreeModel } from '../items/adapters.js';
import { registerTextAdapters, managedTextModel, managedRichTextDocument } from '../text/adapters.js';
import { registerNavigationAdapters, managedNavigationFrame } from '../navigation/adapters.js';
import { registerCommandAdapters } from '../commands/adapters.js';
import { registerValueAdapters, managedRange, managedCalendar } from '../values/adapters.js';
import { registerApplicationAdapters } from '../app/adapters.js';
import { registerMediaAdapters } from '../media/adapters.js';

/** Pure model operations execute synchronously in VM and JS; async host operations return managed tasks. */
export function registerControlFamilyAdapters(registry) {
  for (const register of [registerItemsAdapters, registerTextAdapters, registerNavigationAdapters,
    registerCommandAdapters, registerValueAdapters, registerApplicationAdapters, registerMediaAdapters]) register(registry);
  return registry;
}

const modelKinds = Object.freeze({ selection: managedSelectionModel, tree: managedTreeModel, text: managedTextModel,
  richText: managedRichTextDocument, range: managedRange, calendar: managedCalendar, navigation: managedNavigationFrame, pane: managedPane });

/** Shares authoritative model state between managed members, input transport and automation. */
export function getControlFamilyModel(context, receiver, kind) {
  if (context.typeOf(receiver).endsWith('PasswordBox')) return null;
  const create = modelKinds[kind];
  if (!create) throw new TypeError('Unknown control model kind: ' + kind);
  return create(context, receiver);
}

export { managedSelectionModel, managedTreeModel } from '../items/adapters.js';
export { managedTextModel, managedRichTextDocument } from '../text/adapters.js';
export { managedNavigationFrame } from '../navigation/adapters.js';
export { managedCommand, invokeManagedCommand, invokeManagedButton } from '../commands/adapters.js';
export { managedRange, managedCalendar } from '../values/adapters.js';
export { managedApplication, managedWindow } from '../app/adapters.js';
export { managedWebView } from '../media/adapters.js';
export { applyControlFamilyInput } from './family-input.js';

export { managedPane } from '../navigation/pane-adapters.js';
