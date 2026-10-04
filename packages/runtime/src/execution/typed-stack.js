import {float} from '@sharpforge/bytecode';
import {smallLongNumber} from './int64-fast.js';

export const FloatSlotTag = Object.freeze({r4: 1, r8: 2});
export const SmallLongSlotTag = 3;
const adapters = new WeakMap();

function indexOf(key) {
  if (typeof key !== 'string' || key === '') return -1;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key ? index : -1;
}

function floatTag(value) {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value) || Reflect.ownKeys(value).length !== 2) return 0;
  const payload = Object.getOwnPropertyDescriptor(value, 'value');
  const kind = Object.getOwnPropertyDescriptor(value, 'float');
  if (typeof payload?.value !== 'number') return 0;
  return kind?.value === 'r4' ? FloatSlotTag.r4 : kind?.value === 'r8' ? FloatSlotTag.r8 : 0;
}

/** Private numeric planes behind an ordinary Array proxy; boundary reads retain existing CLI carriers. */
class NumericSlots {
  constructor(values, capacity, smallLongs) {
    this.values = values;
    this.capacity = capacity;
    this.numbers = new Float64Array(capacity);
    this.tags = new Uint8Array(capacity);
    this.materialized = [];
    this.materializations = 0;
    this.enabled = true;
    this.smallLongs = smallLongs;
    for (let index = 0; index < values.length; index++) {
      if (Object.hasOwn(values, index)) this.set(index, values[index]);
    }
    this.array = new Proxy(values, {
      get: (target, key, receiver) => {
        const index = indexOf(key);
        return index < 0 ? Reflect.get(target, key, receiver) : this.get(index);
      },
      set: (target, key, value) => {
        if (!this.enabled) return Reflect.set(target, key, value);
        const index = indexOf(key);
        if (index >= 0) this.set(index, value);
        else if (key === 'length') this.resize(value);
        else {
          this.disable();
          return Reflect.set(target, key, value);
        }
        return true;
      },
      deleteProperty: (target, key) => {
        const deleted = Reflect.deleteProperty(target, key);
        if (deleted && indexOf(key) >= 0) this.clear(Number(key));
        return deleted;
      },
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        const index = indexOf(key);
        if (descriptor && this.enabled && index >= 0 && this.tags[index]) descriptor.value = this.get(index);
        return descriptor;
      },
      defineProperty: (target, key, descriptor) => {
        // Host descriptors can become accessors or non-writable; preserve native Array invariants.
        this.disable();
        return Reflect.defineProperty(target, key, descriptor);
      },
      preventExtensions: target => {
        this.disable();
        return Reflect.preventExtensions(target);
      },
      setPrototypeOf: (target, prototype) => {
        this.disable();
        return Reflect.setPrototypeOf(target, prototype);
      }
    });
    adapters.set(this.array, this);
  }

  get(index) {
    if (!this.enabled || !this.tags[index]) return this.values[index];
    if (this.materialized[index] === undefined) {
      this.materialized[index] = this.tags[index] === SmallLongSlotTag ? BigInt(this.numbers[index]) :
        float(this.numbers[index], this.tags[index] === FloatSlotTag.r4 ? 'r4' : 'r8');
      this.materializations++;
    }
    return this.materialized[index];
  }

  set(index, value) {
    if (this.smallLongs && typeof value === 'bigint') {
      this.setLong(index, value);
      return;
    }
    const tag = index < this.capacity ? floatTag(value) : 0;
    if (tag) {
      this.setFloat(index, value.value, tag);
      this.materialized[index] = value;
    } else {
      this.clear(index);
      this.values[index] = value;
    }
  }

  setFloat(index, value, tag) {
    this.numbers[index] = tag === FloatSlotTag.r4 ? Math.fround(value) : value;
    this.tags[index] = tag;
    this.materialized[index] = undefined;
    this.values[index] = undefined;
  }

  setLong(index, value) {
    const small = typeof value === 'bigint' ? smallLongNumber(value) : value;
    if (small !== undefined && !Number.isSafeInteger(small)) throw new TypeError('Exact Int64 lane value required');
    if (small !== undefined && index < this.capacity) {
      this.numbers[index] = small || 0;
      this.tags[index] = SmallLongSlotTag;
      this.materialized[index] = undefined;
      this.values[index] = undefined;
    } else {
      this.clear(index);
      this.values[index] = typeof value === 'bigint' ? value : BigInt(value);
    }
  }

  enableSmallLongs() {
    if (!this.enabled || this.smallLongs) return;
    this.smallLongs = true;
    for (let index = 0; index < this.values.length; index++) {
      if (typeof this.values[index] === 'bigint') this.setLong(index, this.values[index]);
    }
  }

  clear(index) {
    if (index < this.capacity) {
      this.tags[index] = 0;
      this.numbers[index] = 0;
    }
    if (index < this.materialized.length) this.materialized[index] = undefined;
  }

  resize(length) {
    const previous = this.values.length;
    this.values.length = length; // Array validates the host-supplied length first.
    for (let index = this.values.length; index < Math.min(previous, this.capacity); index++) this.clear(index);
    if (this.materialized.length > this.values.length) this.materialized.length = this.values.length;
  }

  popNumber() {
    const index = this.values.length - 1;
    const value = this.numbers[index];
    this.clear(index);
    this.values.length = index;
    return value;
  }

  pushFloat(value, tag) {
    this.setFloat(this.values.length, value, tag);
  }

  pushLong(value) {
    this.setLong(this.values.length, value);
  }

  disable() {
    if (!this.enabled) return;
    for (let index = 0; index < this.values.length; index++) {
      if (this.tags[index]) this.values[index] = this.get(index);
    }
    this.tags.fill(0);
    this.numbers.fill(0);
    this.materialized.length = 0;
    this.enabled = false;
  }
}

/** Wrap only runtime-owned arrays before publication; host replacement arrays retain the reference path. */
export function typedFloatArray(values, capacity = values.length, smallLongs = false) {
  const previous = adapters.get(values);
  if (previous) {
    if (smallLongs) previous.enableSmallLongs();
    return values;
  }
  return new NumericSlots(values, capacity, smallLongs).array;
}

/** Null means an ordinary or host-customized Array; callers must use their original handler. */
export function floatSlots(values) {
  const slots = adapters.get(values);
  return slots?.enabled ? slots : null;
}

/** Disabled/frozen proxies still require ordinary Array copies at snapshot boundaries. */
export function isTypedFloatArray(values) {
  return adapters.has(values);
}

/** Collection reads the reference plane, without materializing numeric boundary values. */
export function floatSlotRoot(values, index) {
  const slots = floatSlots(values);
  return slots ? slots.values[index] : values[index];
}
