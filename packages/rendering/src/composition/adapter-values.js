const components = Object.freeze({
  'Windows.Foundation.Point': ['X', 'Y'], 'Windows.UI.Color': ['R', 'G', 'B', 'A'],
  'System.Numerics.Vector2': ['X', 'Y'], 'System.Numerics.Vector3': ['X', 'Y', 'Z'],
  'System.Numerics.Vector4': ['X', 'Y', 'Z', 'W'], 'System.Numerics.Quaternion': ['X', 'Y', 'Z', 'W'],
  'System.Numerics.Matrix4x4': Array.from({length: 16}, (_, index) => `M${Math.floor(index / 4) + 1}${index % 4 + 1}`)
});

export function fromCompositionArgument(context, value, type) {
  if (value === null || value === undefined) return null;
  const native = context.unwrapModel(value);
  if (components[type]) {
    if (Array.isArray(value)) return value;
    const result = {valueType: type};
    for (const field of components[type]) result[field] = context.native(native?.get?.(field) ?? value[field] ?? context.read(value, field));
    return result;
  }
  if (native !== value || native?.Compositor || native?.kind === 'Compositor') return native;
  if (type === 'System.TimeSpan') return context.native(value.TotalMilliseconds ?? context.read(value, 'TotalMilliseconds'));
  const result = context.native(value);
  return type === 'bool' ? !!result : result;
}

export function toCompositionResult(context, value, type) {
  if (type === 'void') return null;
  if (value === undefined || value === null) return null;
  if (components[type] && Array.isArray(value)) {
    const entries = components[type].map((field, index) => [field, type === 'Windows.UI.Color' ? Math.round(value[index] * 255) : value[index]]);
    return context.allocate(type, Object.fromEntries(entries));
  }
  if (type === 'System.TimeSpan' && typeof value === 'number') return context.allocate(type, {TotalMilliseconds: value, TotalSeconds: value / 1000});
  if (typeof value === 'object' && value.kind) {
    const actual = value.kind.includes('.') ? value.kind : 'Microsoft.UI.Composition.' + value.kind;
    return context.wrapModel(value, actual);
  }
  return context.managed(value, type);
}

export function registerNumericsAdapters(registry) {
  for (const [owner, fields] of Object.entries(components)) {
    if (!owner.startsWith('System.Numerics.')) continue;
    registry.register({owner, kind: 'constructor', name: '.ctor'}, ({context, args}) => {
      const values = Object.fromEntries(fields.map((field, index) => [field, context.native(args[index] ?? 0)]));
      if (Object.values(values).some(value => !Number.isFinite(value))) throw new RangeError('Invalid numeric value components');
      return context.allocate(owner, values);
    });
  }
}

export class CompositionEventBindings {
  constructor(model, context, receiver, event) {
    this.model = model;
    this.context = context;
    this.receiver = receiver;
    this.event = event;
    this.entries = new Map();
  }
  add(callback) {
    const key = Number.isInteger(callback?.h) && this.context.id ? this.context.id(callback) : callback;
    if (this.entries.has(key)) return;
    const listener = () => this.context.invokeManaged(callback, [this.receiver, null]);
    this.entries.set(key, {callback, listener});
    this.model['add_' + this.event](listener);
  }
  remove(callback) {
    const key = Number.isInteger(callback?.h) && this.context.id ? this.context.id(callback) : callback;
    const entry = this.entries.get(key);
    if (!entry) return;
    this.model['remove_' + this.event](entry.listener);
    this.entries.delete(key);
  }
  retainedValues() { return [this.receiver, ...[...this.entries.values()].map(entry => entry.callback)]; }
  snapshot() { return [...this.entries]; }
  restore(snapshot) {
    this.dispose();
    this.entries = new Map(snapshot);
    for (const entry of this.entries.values()) this.model['add_' + this.event](entry.listener);
  }
  dispose() {
    for (const entry of this.entries.values()) this.model['remove_' + this.event](entry.listener);
    this.entries.clear();
  }
}
