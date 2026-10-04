import {canonicalType, frameworkType, XAML} from '@sharpforge/framework';
import {nullableElementType} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {primitiveTypeName} from '../execution/method-table.js';

/** UI property adapters exchange Nullable<T> as null or its underlying T value, without a nullable heap object. */
export function managedPropertyType(type) { return nullableElementType(type) ?? primitiveTypeName(type); }

/** Recover a canonical name from a managed System.Type or the released string overload. */
export function managedTypeName(platform, value) {
  if (isReference(value)) {
    const record = platform.heap.get(value);
    if (record.kind === 'runtime-type') return canonicalType(record.data[0]?.table?.name);
  }
  const name = platform.native(value);
  if (typeof name !== 'string' || !name) throw new ManagedFault('ArgumentException', 'A managed type is required');
  return canonicalType(name);
}

/** Normalize ABI primitives without converting managed object references into host objects. */
export function nativePropertyValue(platform, value, type) {
  type = managedPropertyType(type);
  if (value === null || value === undefined) return null;
  const unset = platform.singletons.get('UnsetValue');
  if (isReference(value) && unset && value.h === unset.h && value.g === unset.g) return platform.ui.unsetValue;
  if (type === XAML + 'DependencyProperty' && value !== null) return platform.ui.properties.resolve(value);
  const boxed = isReference(value) && platform.heap.get(value).kind === 'box' ? platform.heap.get(value) : null;
  if (boxed) {
    const expected = type ? platform.heap.methodTables.get(type) : null;
    if (expected?.flags.valueType && boxed.methodTable !== expected) {
      throw new ManagedFault('ArgumentException', 'The boxed value does not match the dependency-property type');
    }
    value = boxed.data[0];
  }
  const native = platform.native(value);
  if (type === 'bool' && platform.vm.inspector && (native === 0 || native === 1) &&
    (!boxed || boxed.methodTable === platform.heap.methodTables.get('bool'))) return native === 1;
  if (type === 'uint' && platform.vm.inspector && typeof native === 'number') return native >>> 0;
  if (isReference(value) && frameworkType(type)?.kind === 'value') return platform.exportValue(value);
  return native;
}

/** Materialize ABI scalars, preserving reference identity and property-token ownership. */
export function managedPropertyValue(platform, value, type, {box = false} = {}) {
  type = managedPropertyType(type);
  if (value === null || value === undefined) return null;
  if (value?.kind === 'DependencyProperty') return platform.ui.properties.wrap(value);
  const managed = isReference(value) ? value : value?.valueType
    ? platform.ui.allocate(type, value) : platform.managed(value, type);
  const definition = frameworkType(type);
  const boxed = definition?.kind === 'value' || definition?.kind === 'enum'
    || ['int', 'uint', 'long', 'ulong', 'double', 'float', 'bool', 'char'].includes(type);
  if (box && boxed) {
    return platform.heap.withRoots([managed], () => platform.heap.allocate('box', type, [managed]));
  }
  return managed;
}

/** Convert a native change notification to the registered managed event-argument type. */
export function managedPropertyChange(platform, change) {
  const type = change.property.propertyType;
  const values = {};
  return platform.heap.withRoots([], () => {
    values.Property = platform.ui.properties.wrap(change.property);
    values.OldValue = managedPropertyValue(platform, change.oldValue, type, {box: true});
    platform.heap.pins.push(values.OldValue);
    values.NewValue = managedPropertyValue(platform, change.newValue, type, {box: true});
    platform.heap.pins.push(values.NewValue);
    return platform.make(XAML + 'DependencyPropertyChangedEventArgs', values);
  });
}
