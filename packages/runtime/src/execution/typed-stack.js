import {float, smallInt64} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';

export const NumericSlotTag = Object.freeze({value: 0, r4: 1, r8: 2, smallLong: 3});
const adapters = new WeakMap();

function arrayIndex(key) {
  if (typeof key !== 'string' || key === '') return -1;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key ? index : -1;
}

/**
 * Array-shaped execution storage. Numeric handlers access the raw plane; ordinary
 * array readers materialize immutable CLI values at debugger/call/snapshot edges.
 * The adapter is private execution state and never enters a snapshot graph.
 */
export class TypedNumericSlots {
  constructor(values, capacity = values.length, maxLength = 0xffffffff, smallLongs = false) {
    this.values = values;
    this.maxLength = maxLength;
    this.smallLongs = smallLongs;
    this.numbers = new Float64Array(Math.max(8, capacity, values.length));
    this.tags = new Uint8Array(this.numbers.length);
    this.materialized = [];
    this.materializations = 0;
    for (let index = 0; index < values.length; index++) this.set(index, values[index]);
    this.array = new Proxy(values, this.traps());
    adapters.set(values, this);
    adapters.set(this.array, this);
  }

  traps() {
    return {
      get: (target, key, receiver) => {
        const index = arrayIndex(key);
        return index < 0 ? Reflect.get(target, key, receiver) : this.get(index);
      },
      set: (target, key, value) => {
        const index = arrayIndex(key);
        if (index >= 0) this.set(index, value);
        else if (key === 'length') this.resize(value);
        else return Reflect.set(target, key, value);
        return true;
      },
      deleteProperty: (target, key) => {
        const index = arrayIndex(key);
        if (index >= 0) this.clear(index);
        return Reflect.deleteProperty(target, key);
      },
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        const index = arrayIndex(key);
        if (descriptor && index >= 0 && this.tags[index]) descriptor.value = this.get(index);
        return descriptor;
      },
    };
  }

  reserve(length) {
    if (length <= this.tags.length) return;
    const capacity = Math.max(length, Math.min(this.maxLength, this.tags.length * 2));
    const numbers = new Float64Array(capacity);
    const tags = new Uint8Array(capacity);
    numbers.set(this.numbers);
    tags.set(this.tags);
    this.numbers = numbers;
    this.tags = tags;
  }

  get(index) {
    const tag = this.tags[index];
    if (!tag) return this.values[index];
    if (this.materialized[index] === undefined) {
      this.materialized[index] = tag === NumericSlotTag.smallLong ? BigInt(this.numbers[index]) :
        float(this.numbers[index], tag === NumericSlotTag.r4 ? 'r4' : 'r8');
      this.materializations++;
    }
    return this.materialized[index];
  }

  set(index, value) {
    if (this.smallLongs && typeof value === 'bigint') this.setLong(index, value);
    else if (value?.float === 'r4' || value?.float === 'r8') {
      this.setFloat(index, value.value, value.float === 'r4' ? NumericSlotTag.r4 : NumericSlotTag.r8);
      this.materialized[index] = value;
    } else {
      this.clear(index);
      this.values[index] = value;
    }
  }

  setLong(index, value) {
    const exact = smallInt64(value);
    if (typeof exact === 'number') {
      this.reserve(index + 1);
      this.numbers[index] = exact;
      this.tags[index] = NumericSlotTag.smallLong;
      this.materialized[index] = undefined;
      this.values[index] = undefined;
    } else {
      this.clear(index);
      this.values[index] = exact;
    }
  }

  readLong(index) {
    return this.tags[index] === NumericSlotTag.smallLong ? this.numbers[index] : this.values[index];
  }

  pushLong(value) {
    if (this.values.length >= this.maxLength) {
      throw new ManagedFault('ExecutionLimitException', 'Evaluation stack budget exceeded');
    }
    this.setLong(this.values.length, value);
  }

  popLong() {
    const index = this.values.length - 1;
    if (index < 0) throw new ManagedFault('InvalidProgramException', 'Evaluation stack underflow');
    const value = this.readLong(index);
    this.clear(index);
    this.values.length = index;
    return value;
  }

  setFloat(index, value, tag) {
    this.reserve(index + 1);
    this.numbers[index] = tag === NumericSlotTag.r4 ? Math.fround(value) : value;
    this.tags[index] = tag;
    this.materialized[index] = undefined;
    // The actual Array retains dense own slots and its normal length semantics.
    this.values[index] = undefined;
  }

  clear(index) {
    if (index < this.tags.length) {
      this.tags[index] = NumericSlotTag.value;
      this.numbers[index] = 0;
    }
    this.materialized[index] = undefined;
  }

  resize(length) {
    const previous = this.values.length;
    // Let Array validate the length before mutating any numeric state.
    this.values.length = length;
    for (let index = length; index < previous; index++) this.clear(index);
    if (length < this.materialized.length) this.materialized.length = length;
  }

  pushFloat(value, tag) {
    if (this.values.length >= this.maxLength) {
      throw new ManagedFault('ExecutionLimitException', 'Evaluation stack budget exceeded');
    }
    this.setFloat(this.values.length, value, tag);
  }

  popNumber() {
    const index = this.values.length - 1;
    if (index < 0) throw new ManagedFault('InvalidProgramException', 'Evaluation stack underflow');
    const value = this.numbers[index];
    this.clear(index);
    this.values.length = index;
    return value;
  }

  discard() {
    const index = this.values.length - 1;
    if (index < 0) throw new ManagedFault('InvalidProgramException', 'Evaluation stack underflow');
    this.clear(index);
    this.values.length = index;
  }
}

/** Return an existing raw-plane adapter without allocating or reading any slot. */
export function numericSlots(values) {
  return adapters.get(values);
}

/** Root scanners read this slot without materializing scalar wrapper values. */
export function numericSlotRoot(values, index) {
  const adapter = adapters.get(values);
  return adapter ? adapter.values[index] : values[index];
}

/** Preserve sharing when filter frames or argument adapters refer to one array. */
export function typedNumericSlots(values, capacity, maxLength, smallLongs, verified = false) {
  const Constructor = verified ? VerifiedNumericSlots : TypedNumericSlots;
  return adapters.get(values) ?? new Constructor(values, capacity, maxLength, smallLongs);
}

/** Admission has proved every incoming and outgoing height against method.maxStack. */
class VerifiedNumericSlots extends TypedNumericSlots {
  pushFloat(value, tag) {
    this.setFloat(this.values.length, value, tag);
  }

  pushLong(value) {
    this.setLong(this.values.length, value);
  }
}
