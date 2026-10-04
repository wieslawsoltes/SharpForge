import {ResourceDictionary} from '../resources/resource-dictionary.js';
import {ResourceScope} from '../resources/resource-scope.js';
import {FluentResources} from '../resources/fluent-resources.js';
import {dictionaryModel} from '../object-model/resource-adapter-models.js';
import {EnvironmentResourceScope} from '../resources/environment-scope.js';

const x = 'Microsoft.UI.Xaml.';

/** Resource ancestry is derived from each execution target's explicit object tree. */
export function initializeResourceContext(context, templateHostAdapter) {
  context.templateHostAdapter = templateHostAdapter;
  context.resourceScopeFor = owner => resourceScopeFor(context, owner);
  context.templateBindings = owner => {
    const encoded = context.native(context.read(owner, '$bindings'));
    return encoded ? Object.entries(JSON.parse(encoded)) : [];
  };
  context.findName = (owner, name) => findVisualName(context, owner, name);
  context.resourceParentChanged = owner => {
    const scope = context.state(owner, 'resourceScope');
    // Template teardown may detach nodes after their enclosing resource scope has already been disposed.
    if (scope && !scope.disposed) scope.setParent(parentScope(context, owner));
  };
  Object.defineProperty(context, 'applicationResources', {get: () => resourceScopeFor(context, context.getApplication())});
}

function rootScope(context) {
  return context.state(null, 'fluentResourceScope', () => {
    const resources = new FluentResources(context.services.fluentResources);
    return new EnvironmentResourceScope({resources, environment: context.services.environment, theme: context.services.theme});
  });
}

function parentScope(context, owner) {
  const parent = context.parentOf(owner);
  if (parent) return resourceScopeFor(context, parent);
  const application = context.getApplication();
  if (application && context.id(application) !== context.id(owner)) return resourceScopeFor(context, application);
  return rootScope(context);
}

function resourceScopeFor(context, owner) {
  if (!owner) return rootScope(context);
  return context.state(owner, 'resourceScope', () => {
    const reference = context.read(owner, 'Resources');
    const requested = Number(context.native(context.read(owner, 'RequestedTheme')) ?? 0);
    const application = context.typeOf(owner) === x + 'Application';
    const theme = (application ? ['Light', 'Dark'] : ['Default', 'Light', 'Dark'])[requested];
    const scope = new ResourceScope({owner, theme: theme ?? 'Default', parent: parentScope(context, owner),
      resources: reference ? dictionaryModel(context, reference) : new ResourceDictionary()});
    scope.onThemeChanged(change => {
      if (!application) context.emit(owner, 'ActualThemeChanged', {OldTheme: change.oldTheme, NewTheme: change.newTheme});
      context.services.themeChanged?.(owner, change.newTheme);
    });
    return scope;
  });
}

/** Namescope boundaries are respected; duplicate names in another template are never exposed. */
export function findVisualName(context, owner, name) {
  const explicit = context.read(owner, '$nameScope');
  if (explicit) return context.unwrapModel(explicit).findName(name);
  const visited = new Set();
  const queue = [owner];
  while (queue.length) {
    const value = queue.pop();
    const id = context.id(value);
    if (visited.has(id)) continue;
    if (visited.size >= 100000) throw new RangeError('Visual namescope traversal limit');
    visited.add(id);
    if (context.native(context.read(value, 'Name')) === name) return value;
    for (const child of context.templateHostAdapter.children(value)) {
      if (!context.read(child, '$templateOwner')) queue.push(child);
    }
  }
  return null;
}
