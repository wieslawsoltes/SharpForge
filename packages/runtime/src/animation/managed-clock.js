import {AnimationClock} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {updateBindings} from '../styling.js';
import {animationIdentity, animationNativeValue, animationProperty, animationProperties} from './managed-definition.js';

const nonnegative = new Set(['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight', 'FontSize', 'ItemWidth', 'ItemHeight']);
const valueTypes = Object.freeze({Double: ['double', 'float'], Color: ['Windows.UI.Color'], Point: ['Windows.Foundation.Point'], Object: null});

function read(platform, reference, name) {
  const property = animationProperty(platform, reference, name);
  if (property) return platform.ui.storeFor(reference).getValue(property);
  return animationNativeValue(platform, platform.get(reference, name));
}

function managed(platform, value, type) {
  if (value?.valueType) {
    if (platform.ui) return platform.ui.allocate(type ?? value.valueType, value);
    const fields = {};
    for (const [name, field] of Object.entries(value)) if (name !== 'valueType') fields[name] = platform.managed(field);
    return platform.make(value.valueType, fields);
  }
  return platform.managed(value, type);
}

export function createManagedAnimationClock(platform) {
  return new AnimationClock({
    key: animationIdentity, read: (reference, name) => read(platform, reference, name),
    readBase: (reference, name) => {
      const property = animationProperty(platform, reference, name);
      return property ? platform.ui.storeFor(reference).getBaseValue(property, 8)
        : platform.animations.bases.get(platform.animations.key(reference, name))?.value ?? read(platform, reference, name);
    },
    validate: (reference, name, kind = 'Double') => {
      if (['$Left', '$Top'].includes(name)) {
        if (!platform.isElement(reference) || kind !== 'Double') throw new TypeError('Attached animation requires a numeric UIElement property');
        return;
      }
      const property = animationProperties(platform, reference)[name];
      if (!property || property.readOnly || (valueTypes[kind] && !valueTypes[kind].includes(property.type))) {
        throw new TypeError(`${kind} animation requires a compatible writable property: ${name}`);
      }
    },
    write: (reference, name, input) => {
      let value = input;
      if (name === 'Opacity') value = Math.max(0, Math.min(1, value));
      if (nonnegative.has(name)) value = Math.max(0, value);
      const property = animationProperty(platform, reference, name);
      const type = property?.propertyType ?? animationProperties(platform, reference)[name]?.type ?? 'double';
      const result = managed(platform, value, type);
      if (property) platform.ui.properties.setSource(reference, property, 8, result);
      else {
        platform.set(reference, name, result);
        updateBindings(platform, reference);
        platform.command({op: 'set', id: animationIdentity(reference), property: name.replace(/^\$/, ''), value});
      }
    },
    clear: (reference, name) => {
      const property = animationProperty(platform, reference, name);
      if (property) platform.ui.properties.clearSource(reference, property, 8);
      else {
        const base = platform.animations.bases.get(platform.animations.key(reference, name));
        if (!base) return;
        platform.set(reference, name, managed(platform, base.value, animationProperties(platform, reference)[name]?.type));
        platform.command({op: 'set', id: animationIdentity(reference), property: name.replace(/^\$/, ''), value: base.value});
        updateBindings(platform, reference);
      }
    },
    completed: reference => { if (isReference(reference)) platform.enqueueEvent(reference, 'Completed'); }
  });
}

export function advanceManagedAnimations(platform, delta) {
  return platform.styleMutation(() => {
    try {
      platform.ui?.services?.independentTimelines?.advanceManual(delta);
      platform.animations.advance(delta);
    }
    catch (error) {
      if (error instanceof ManagedFault) throw error;
      throw new ManagedFault('InvalidOperationException', error.message);
    }
    return platform.animations.running;
  });
}
