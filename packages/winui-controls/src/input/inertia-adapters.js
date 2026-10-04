const input = 'Microsoft.UI.Xaml.Input.';
const desiredProperties = { Translation: 'DesiredDisplacement', Rotation: 'DesiredRotation', Expansion: 'DesiredExpansion' };

class InertiaBehavior {
  constructor(values = {}) { this.values = values; }
  snapshot() { return { ...this.values }; }
  restore(value) { for (const key of Object.keys(this.values)) delete this.values[key]; Object.assign(this.values, value); }
}

class InertiaBinding {
  constructor(reference) { this.reference = reference; }
  snapshot() { return { reference: this.reference }; }
  restore(value) { this.reference = value.reference; }
  retainedValues() { return this.reference ? [this.reference] : []; }
}

/** Behavior objects retain a direct link to the event payload so setters affect the active inertia calculation. */
export function registerInertiaAdapters(registry, payloadFor) {
  for (const [kind, desired] of Object.entries(desiredProperties)) {
    const type = input + 'Inertia' + kind + 'Behavior';
    registry.register({ owner: type, name: '.ctor', kind: 'constructor' }, ({ context }) => context.wrapModel(new InertiaBehavior(), type));
    for (const property of ['DesiredDeceleration', desired]) {
      registry.register({ owner: type, name: 'get_' + property, kind: 'get' }, ({ context, receiver }) => {
        return context.unwrapModel(receiver).values[property] ?? NaN;
      });
      registry.register({ owner: type, name: 'set_' + property, kind: 'set' }, ({ context, receiver, args }) => {
        const value = context.native(args[0]);
        if (!Number.isNaN(value) && (!Number.isFinite(value) || value < 0)) throw new RangeError('Invalid manipulation inertia behavior');
        const values = context.unwrapModel(receiver).values;
        if (Number.isNaN(value)) delete values[property];
        else values[property] = value;
      });
    }
    const property = kind + 'Behavior';
    registry.register({ owner: input + 'ManipulationInertiaStartingRoutedEventArgs', name: 'get_' + property, kind: 'get' },
      ({ context, receiver }) => {
        const payload = payloadFor(context, receiver);
        const binding = context.state(receiver, 'inertia:' + kind,
          () => new InertiaBinding(context.wrapModel(new InertiaBehavior(payload[property] ??= {}), type)));
        payload[property] = context.unwrapModel(binding.reference).values;
        return binding.reference;
      });
    registry.register({ owner: input + 'ManipulationInertiaStartingRoutedEventArgs', name: 'set_' + property, kind: 'set' },
      ({ context, receiver, args }) => {
        const payload = payloadFor(context, receiver);
        const model = context.unwrapModel(args[0]);
        if (!(model instanceof InertiaBehavior)) throw new TypeError('Expected a manipulation inertia behavior');
        const binding = context.state(receiver, 'inertia:' + kind, () => new InertiaBinding(args[0]));
        binding.reference = args[0];
        context.syncOwner?.(receiver);
        payload[property] = model.values;
        context.write(receiver, property, args[0]);
      });
  }
}
