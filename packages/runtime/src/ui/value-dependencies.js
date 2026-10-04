import {EffectiveValueEmitter} from '@sharpforge/winui-properties';
import {serializeRenderingValue, typeOfRenderingModel} from '@sharpforge/rendering';
import {frameworkType} from '@sharpforge/framework';
import {isReference} from '../heap.js';

function nativeModel(context, reference) {
  if (!isReference(reference)) return reference;
  const states = context.modelState.owners.get(`${reference.h}:${reference.g}`)?.states;
  return states?.get('nativeModel')?.value ?? states?.get('model')?.value;
}

/** Public scene descriptors never expose a native resource graph, callback or managed field layout. */
export function exportManagedRenderingValue(context, reference) {
  const model = nativeModel(context, reference);
  const type = typeOfRenderingModel(model);
  return type ? {handled: true, value: serializeRenderingValue(model, type)} : {handled: false};
}

export function createManagedValueDependencies(context) {
  const emitter = new EffectiveValueEmitter({
    isMutableValue: value => {
      if (!isReference(value)) return !!typeOfRenderingModel(value) || Array.isArray(value);
      if (!context.isAlive(value)) return false;
      const kind = frameworkType(context.typeOf(value))?.kind;
      return !!nativeModel(context, value) || ['value', 'brush', 'rendering'].includes(kind);
    },
    valuesOf: value => {
      if (!isReference(value)) return value.data ?? value.items ?? value;
      const model = nativeModel(context, value);
      return model ? {model} : Object.fromEntries(context.platform.propertyEntries(value));
    },
    emit: (owner, property) => {
      if (!context.isAlive(owner)) { emitter.remove(owner); return; }
      const value = context.storeFor(owner).getValue(property);
      emitter.track(owner, property, value);
      context.platform.command({op: 'set', id: context.id(owner), property: property.name,
        value: context.platform.exportValue(context.properties.toManaged(value, property.propertyType))});
    }
  });
  return {
    changed(change) { emitter.track(change.owner, change.property, change.newValue); },
    mutated(reference) {
      emitter.mutated(reference);
      const model = nativeModel(context, reference);
      if (model) emitter.mutated(model);
    },
    remove: owner => emitter.remove(owner),
    restore() {
      for (const store of context.properties.stores.values()) {
        for (const entry of store.entries.values()) emitter.track(store.owner, entry.property, entry.value);
      }
    }
  };
}
