import {number} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {isReference} from '../heap.js';
import {enumValue} from './enums.js';

/** Primitive source values need no object lookup; references still pass through heap validation. */
export function sourceValue(heap, value) {
  if (value === null || typeof value !== 'object') return value;
  if (value.enumType) return value.value;
  if (value.float || value.nativeInt) return number(value);
  if (!isReference(value)) return value;
  const record = heap.get(value);
  return record.kind === 'string' ? record.data : value;
}

/**
 * Source contracts use the closed framework enum registry, not a CIL inspector.
 * The owning VM keeps only return-type metadata, never a managed result or receiver.
 */
export class SourceBuiltinResults {
  constructor(enums = enumTypes) {
    this.enums = Object.isFrozen(enums) ? enums : Object.freeze([...enums]);
    this.classifications = new Map();
  }

  convert(vm, entry, value) {
    let type = this.classifications.get(entry);
    if (type === undefined) {
      const declared = entry.contract.result;
      type = this.enums.includes(declared) ? declared : null;
      this.classifications.set(entry, type);
    }
    return type === null ? value : enumValue(vm, type, value);
  }
}
