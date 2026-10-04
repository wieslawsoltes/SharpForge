import { EnvironmentState } from './environment-state.js';

const X = 'Microsoft.UI.Xaml.', V = 'Windows.UI.ViewManagement.';
const rootFields = new Set(['RootId', 'ContentId', 'Size', 'RasterizationScale', 'IsHostVisible']);

/** Install before layout/resource services so all public projections share the same snapshot owner. */
export function createContextEnvironment(context) {
  if (context.services.environment) return context.services.environment;
  const state = context.state(null, 'environmentService', () => new EnvironmentState());
  context.services.environment = state;
  return state;
}

class EnvironmentSubscription {
  constructor(context, receiver, type) {
    this.context = context;
    this.receiver = receiver;
    this.type = type;
    this.subscribe();
  }
  subscribe() {
    this.unsubscribe?.();
    this.unsubscribe = createContextEnvironment(this.context).subscribe(change => this.changed(change));
  }
  changed(change) {
    const { context, receiver, type } = this;
    if (context.isAlive?.(receiver) === false) { this.dispose(); return; }
    const changed = new Set(change.changed);
    if (type === X + 'XamlRoot' && change.changed.some(field => rootFields.has(field))) context.emit(receiver, 'Changed', {});
    if (type === V + 'UISettings') {
      for (const property of ['TextScaleFactor', 'AnimationsEnabled']) if (changed.has(property)) context.emit(receiver, property + 'Changed', {});
    }
    if (type === V + 'AccessibilitySettings' && changed.has('HighContrast')) context.emit(receiver, 'HighContrastChanged', {});
    if (type === V + 'InputPane' && changed.has('InputPaneOccludedRect')) {
      const bounds = change.current.InputPaneOccludedRect;
      context.emit(receiver, bounds.Width && bounds.Height ? 'Showing' : 'Hiding', change.inputPane);
    }
  }
  snapshot() { return { type: this.type }; }
  restore(snapshot) { this.type = snapshot.type; this.subscribe(); }
  dispose() { this.unsubscribe?.(); this.unsubscribe = null; }
}

function initialize(context, receiver, type) {
  const reference = receiver ?? context.allocate(type, {});
  context.state(reference, 'environmentSubscription', () => new EnvironmentSubscription(context, reference, type));
  return reference;
}
function singleton(context, type) {
  return context.singleton('environment.' + type, () => initialize(context, null, type));
}
function rootContent(context, environment) {
  if (environment.ContentId) return context.reference(environment.ContentId);
  const windows = context.host?.windows ?? context.services.layout?.windows ?? [];
  const window = windows[0];
  if (window == null) return null;
  return context.read(context.reference(window), 'Content');
}
function belongsToRoot(context, receiver) {
  const service = context.services.layout;
  service?.synchronize?.(receiver);
  const content = rootContent(context, createContextEnvironment(context));
  if (content == null) return false;
  const contentId = context.id(content), seen = new Set();
  let current = receiver;
  while (current != null) {
    const id = context.id(current);
    if (id === contentId) return true;
    if (seen.has(id) || seen.size >= 512) throw new Error('SFUI1672: Invalid XamlRoot ancestry');
    seen.add(id);
    const parent = context.parentOf?.(current) ?? service?.engine?.states.get(id)?.parent;
    current = typeof parent === 'string' ? context.reference(parent) : parent;
  }
  return false;
}
function xamlRoot(context, receiver) {
  const explicit = context.read(receiver, 'XamlRoot');
  if (explicit != null) return explicit;
  return belongsToRoot(context, receiver) ? singleton(context, X + 'XamlRoot') : null;
}

function property(registry, owner, name, getter) {
  registry.register({ owner, name: 'get_' + name, kind: 'get' }, ({ context, receiver, descriptor }) => {
    initialize(context, receiver, owner);
    return context.managed(getter(context, createContextEnvironment(context)), descriptor.result);
  });
}

/** Public settings adapters expose real host state; unavailable synchronous keyboard requests return false. */
export function registerEnvironmentAdapters(registry) {
  for (const owner of [V + 'UISettings', V + 'AccessibilitySettings']) {
    registry.register({ owner, name: '.ctor', kind: 'constructor' }, ({ context, receiver }) => initialize(context, receiver, owner));
  }
  for (const [owner, names] of [[V + 'UISettings', ['TextScaleFactor', 'AnimationsEnabled']],
    [V + 'AccessibilitySettings', ['HighContrast', 'HighContrastScheme']],
    [X + 'XamlRoot', ['RasterizationScale', 'IsHostVisible']]]) {
    for (const name of names) property(registry, owner, name, (_context, environment) => environment[name]);
  }
  property(registry, X + 'XamlRoot', 'Size', (_context, environment) => ({ valueType: 'Windows.Foundation.Size', ...environment.Size }));
  property(registry, X + 'XamlRoot', 'Content', rootContent);
  property(registry, V + 'InputPane', 'OccludedRect', (_context, environment) =>
    ({ valueType: 'Windows.Foundation.Rect', ...environment.InputPaneOccludedRect }));
  registry.register({ owner: X + 'UIElement', name: 'get_XamlRoot', kind: 'get' }, ({ context, receiver }) => xamlRoot(context, receiver));
  registry.register({ owner: X + 'UIElement', name: 'set_XamlRoot', kind: 'set' }, ({ context, receiver, args }) => {
    const assigned = args[0];
    if (assigned != null && context.id(assigned) !== context.id(singleton(context, X + 'XamlRoot'))) {
      throw new Error('SFUI1672: XamlRoot belongs to another host');
    }
    if (assigned == null && belongsToRoot(context, receiver)) throw new Error('SFUI1672: Cannot clear an attached element XamlRoot');
    context.write(receiver, 'XamlRoot', assigned);
  });
  registry.register({ owner: V + 'InputPane', name: 'GetForCurrentView' }, ({ context }) => singleton(context, V + 'InputPane'));
  for (const [method, action] of [['TryShow', 'tryShow'], ['TryHide', 'tryHide']]) {
    registry.register({ owner: V + 'InputPane', name: method }, ({ context }) => context.services.inputPane?.[action]?.() === true);
  }
  registry.register({ owner: V + 'InputPaneVisibilityEventArgs', name: 'set_EnsuredFocusedElementInView', kind: 'set' },
    ({ context, receiver, args }) => {
      const value = !!context.native(args[0]);
      context.write(receiver, 'EnsuredFocusedElementInView', value);
      const payload = context.state(receiver, 'uiEventPayload')?.payload;
      if (payload) payload.EnsuredFocusedElementInView = value;
    });
}
