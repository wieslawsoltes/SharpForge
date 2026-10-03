import {ManagedFault} from './fault.js';

function arrayIndex(property) {
  if (typeof property !== 'string' || property === '') return -1;
  const index = Number(property);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === property ? index : -1;
}

function assertActive(binding) {
  if (binding.block.released) {
    throw new ManagedFault('InvalidReferenceException', 'The managed array backing store has been reclaimed');
  }
}

function read(binding, index) {
  assertActive(binding);
  return binding.codec
    ? binding.codec.read(binding.arena.view, binding.block.offset + index * binding.codec.size)
    : binding.arena.read(binding.block, index);
}

function write(binding, index, value) {
  assertActive(binding);
  if (binding.readOnly) throw new ManagedFault('InvalidOperationException', 'Frozen managed data is read-only');
  if (index >= binding.length) throw new ManagedFault('IndexOutOfRangeException', 'Managed array index exceeds its length');
  if (binding.codec) binding.codec.write(binding.arena.view, binding.block.offset + index * binding.codec.size, value);
  else binding.arena.write(binding.block, index, value);
  return true;
}

function createHandler(bindings) {
  return Object.freeze({
    get(array, property, receiver) {
      const index = arrayIndex(property);
      if (index >= 0) {
        const binding = bindings.get(array);
        return index < binding.length ? read(binding, index) : undefined;
      }
      return Reflect.get(array, property, receiver);
    },
    set(array, property, value, receiver) {
      const binding = bindings.get(array);
      const index = arrayIndex(property);
      if (index >= 0) return write(binding, index, value);
      if (property === 'length') {
        if (value === binding.length) return true;
        throw new ManagedFault('NotSupportedException', 'Managed array length is fixed');
      }
      return Reflect.set(array, property, value, receiver);
    },
    has(array, property) {
      const index = arrayIndex(property);
      return index >= 0 ? index < bindings.get(array).length : Reflect.has(array, property);
    },
    ownKeys(array) {
      const binding = bindings.get(array);
      const keys = Array.from({length: binding.length}, (_, index) => String(index));
      return keys.concat(Reflect.ownKeys(array));
    },
    getOwnPropertyDescriptor(array, property) {
      const index = arrayIndex(property);
      const binding = bindings.get(array);
      if (index >= 0 && index < binding.length) {
        return {value: read(binding, index), writable: !binding.readOnly, enumerable: true, configurable: true};
      }
      return Reflect.getOwnPropertyDescriptor(array, property);
    },
    defineProperty(array, property, descriptor) {
      const binding = bindings.get(array);
      const index = arrayIndex(property);
      if (index >= 0) {
        if (!Object.hasOwn(descriptor, 'value') || descriptor.configurable === false || descriptor.writable === false) {
          throw new ManagedFault('NotSupportedException', 'Managed element descriptors cannot be reconfigured');
        }
        return write(binding, index, descriptor.value);
      }
      if (property === 'length' && descriptor.value !== undefined && descriptor.value !== binding.length) {
        throw new ManagedFault('NotSupportedException', 'Managed array length is fixed');
      }
      return Reflect.defineProperty(array, property, descriptor);
    },
    deleteProperty(array, property) {
      if (arrayIndex(property) >= 0) throw new ManagedFault('NotSupportedException', 'Managed elements cannot be deleted');
      return Reflect.deleteProperty(array, property);
    },
    preventExtensions() {
      throw new ManagedFault('NotSupportedException', 'Managed array views cannot be sealed by the host');
    }
  });
}

/** Per-heap owner: every Proxy shares one handler, with no per-allocation closures. */
export class SpatialArrayViews {
  constructor() {
    this.bindings = new WeakMap();
    this.handler = createHandler(this.bindings);
  }

  create(binding) {
    const target = new Array(binding.length);
    this.bindings.set(target, binding);
    return new Proxy(target, this.handler);
  }
}

/** Standalone compatible view; callers allocating many views pass their explicit owner. */
export function createSpatialArrayView(binding, owner = new SpatialArrayViews()) {
  return owner.create(binding);
}
