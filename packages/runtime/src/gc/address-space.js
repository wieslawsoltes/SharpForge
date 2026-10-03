import {ManagedFault} from './fault.js';
import {liveReference, sameReference} from './lifetime-state.js';

function offsetValue(value) {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new RangeError('Address offsets must be exact integer byte counts');
  return BigInt(value);
}

/** Session-scoped virtual byte address. It never contains a JavaScript/native pointer. */
export class ManagedAddress {
  constructor(owner, value) {
    this.kind = 'managed-address';
    this.owner = owner;
    this.value = value;
    Object.freeze(this);
  }

  add(byteOffset) {
    return new ManagedAddress(this.owner, this.value + offsetValue(byteOffset));
  }

  valueOf() { return this.value; }
  toString() { return `0x${this.value.toString(16)}`; }
}

/** Monotonic virtual ranges; lookup is O(log live ranges), with amortized tombstone removal. */
export class VirtualAddressSpace {
  constructor(heap, {maxVirtualAddress = (1n << 63n) - 1n} = {}) {
    if (typeof maxVirtualAddress !== 'bigint' || maxVirtualAddress < 0x10000n) {
      throw new RangeError('The virtual address ceiling must be a BigInt of at least 65536');
    }
    this.heap = heap;
    this.owner = Object.freeze({});
    this.maximum = maxVirtualAddress;
    this.nextAddress = 0x10000n;
    this.ranges = [];
    this.active = new Map();
    this.deadRanges = 0;
  }

  activate(reference) {
    const record = this.heap.get(reference);
    const existing = this.active.get(reference.h);
    if (existing && sameReference(existing.reference, reference)) return existing.token;
    const extent = BigInt(Math.max(1, record.size));
    const start = this.nextAddress;
    const next = ((start + extent + 15n) & ~15n) + 16n;
    if (next > this.maximum) {
      throw new ManagedFault('OutOfMemoryException', 'The managed virtual address space is exhausted');
    }
    const token = new ManagedAddress(this.owner, start);
    const range = {start, extent, reference, token, active: true};
    this.nextAddress = next;
    this.ranges.push(range);
    this.active.set(reference.h, range);
    return token;
  }

  deactivate(reference) {
    const range = this.active.get(reference.h);
    if (!range || !sameReference(range.reference, reference)) return false;
    range.active = false;
    this.active.delete(reference.h);
    this.deadRanges++;
    if (this.ranges.length > 128 && this.deadRanges * 2 > this.ranges.length) {
      this.ranges = this.ranges.filter(item => item.active);
      this.deadRanges = 0;
    }
    return true;
  }

  addressOf(reference, byteOffset = 0) {
    const record = this.heap.get(reference);
    let range = this.active.get(reference.h);
    if ((!range || !sameReference(range.reference, reference)) && record.space === 'pinned') {
      this.activate(reference);
      range = this.active.get(reference.h);
    }
    if (!range || !sameReference(range.reference, reference)) {
      throw new ManagedFault('InvalidOperationException', 'The object has no active pin');
    }
    const offset = offsetValue(byteOffset);
    if (offset < 0n || offset >= range.extent) throw new RangeError('Address offset is outside the pinned object');
    return offset === 0n ? range.token : range.token.add(offset);
  }

  /** Resolve a live token to its current record and byte offset; stale/foreign tokens fault. */
  resolve(token, {byteLength = 1} = {}) {
    if (token?.kind !== 'managed-address' || token.owner !== this.owner || typeof token.value !== 'bigint') {
      throw new ManagedFault('InvalidAddressException', 'A virtual address from this heap session is required');
    }
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new RangeError('Invalid address read length');
    let low = 0;
    let high = this.ranges.length - 1;
    let range = null;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (this.ranges[middle].start <= token.value) {
        range = this.ranges[middle];
        low = middle + 1;
      } else high = middle - 1;
    }
    const offset = range ? token.value - range.start : -1n;
    if (!range?.active || offset < 0n || offset >= range.extent || offset + BigInt(byteLength) > range.extent ||
        !liveReference(this.heap, range.reference)) {
      throw new ManagedFault('InvalidAddressException', 'The virtual address is stale, unpinned, or outside its object');
    }
    return {reference: range.reference, record: this.heap.get(range.reference), byteOffset: Number(offset)};
  }

  snapshot() {
    return {owner: this.owner, nextAddress: this.nextAddress, deadRanges: this.deadRanges, ranges: this.ranges.map(range => ({...range}))};
  }

  restore(state) {
    if (state.owner !== this.owner) throw new TypeError('Virtual address snapshot belongs to another heap');
    this.nextAddress = this.nextAddress > state.nextAddress ? this.nextAddress : state.nextAddress;
    this.ranges = state.ranges.map(range => ({...range}));
    this.deadRanges = state.deadRanges;
    this.active.clear();
    for (const range of this.ranges) if (range.active) this.active.set(range.reference.h, range);
  }
}
