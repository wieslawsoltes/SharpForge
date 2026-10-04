import {float} from '@sharpforge/bytecode';
import {smallLongNumber} from './int64-fast.js';
import {numericArrayView} from './typed-stack-proxy.js';

export const FloatSlotTag = Object.freeze({r4: 1, r8: 2});
export const SmallLongSlotTag = 3;
const adapters = new WeakMap();

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
    this.length = values.length;
    this.capacity = capacity;
    this.numbers = new Float64Array(capacity);
    this.tags = new Uint8Array(capacity);
    this.present = new Uint8Array(capacity);
    this.materialized = [];
    this.materializations = 0;
    this.enabled = values.length <= capacity;
    this.smallLongs = smallLongs;
    for (let index = 0; this.enabled && index < values.length; index++) {
      if (Object.hasOwn(values, index)) this.set(index, values[index]);
    }
    this.array = numericArrayView(this);
    adapters.set(this.array, this);
  }

  get(index) {
    if (!this.enabled) return this.values[index];
    if (index >= this.length || !this.present[index]) return Reflect.get(Object.getPrototypeOf(this.values), String(index), this.array);
    if (!this.tags[index]) return this.values[index];
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
      this.setPlain(index, value);
    }
  }

  setFloat(index, value, tag) {
    this.numbers[index] = tag === FloatSlotTag.r4 ? Math.fround(value) : value;
    this.tags[index] = tag;
    this.materialized[index] = undefined;
    this.values[index] = undefined;
    this.present[index] = 1;
    if (index >= this.length) this.length = index + 1;
  }

  setPlain(index, value) {
    this.clear(index);
    this.values[index] = value;
    this.present[index] = 1;
    if (index >= this.length) this.length = index + 1;
  }

  setLong(index, value) {
    const small = typeof value === 'bigint' ? smallLongNumber(value) : value;
    if (small !== undefined && !Number.isSafeInteger(small)) throw new TypeError('Exact Int64 lane value required');
    if (small !== undefined && index < this.capacity) {
      this.numbers[index] = small || 0;
      this.tags[index] = SmallLongSlotTag;
      this.materialized[index] = undefined;
      this.values[index] = undefined;
      this.present[index] = 1;
      if (index >= this.length) this.length = index + 1;
    } else {
      this.setPlain(index, typeof value === 'bigint' ? value : BigInt(value));
    }
  }

  enableSmallLongs() {
    if (!this.enabled || this.smallLongs) return;
    this.smallLongs = true;
    for (let index = 0; index < this.length; index++) {
      if (typeof this.values[index] === 'bigint') this.setLong(index, this.values[index]);
    }
  }

  clear(index) {
    if (index < this.capacity) {
      this.tags[index] = 0;
      this.numbers[index] = 0;
      this.present[index] = 0;
    }
    if (index < this.values.length) this.values[index] = undefined;
    if (index < this.materialized.length) this.materialized[index] = undefined;
  }

  resize(length) {
    if (typeof length !== 'number') {
      this.disable();
      this.values.length = length;
      return;
    }
    const next = length >>> 0;
    if (next !== length) throw new RangeError('Invalid array length');
    if (!this.enabled || next > this.capacity) {
      this.disable();
      this.values.length = next;
      return;
    }
    for (let index = next; index < this.length; index++) this.clear(index);
    this.length = next;
  }

  popNumber() {
    const index = this.length - 1;
    const value = this.numbers[index];
    this.clear(index);
    this.length = index;
    return value;
  }

  pushFloat(value, tag) {
    this.setFloat(this.length, value, tag);
  }

  pushLong(value) {
    this.setLong(this.length, value);
  }

  disable() {
    if (!this.enabled) return;
    for (let index = 0; index < this.length; index++) {
      if (!this.present[index]) delete this.values[index];
      else if (this.tags[index]) this.values[index] = this.get(index);
    }
    this.values.length = this.length;
    this.tags.fill(0);
    this.numbers.fill(0);
    this.present.fill(0);
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
  return slots?.present[index] ? slots.values[index] : values[index];
}
