import {frameworkAssignable, frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';

/** Source images store declared fields with absolute offsets; CLI metadata stores each field on its declaring type. */
export class ImageTypeLayout {
  constructor(image) { this.types = new Map(image.types.map(type => [type.name, type])); }

  *ancestry(name) {
    const seen = new Set();
    for (let current = name; current; current = this.types.get(current)?.base ?? frameworkType(current)?.base) {
      if (seen.has(current) || seen.size >= 256) throw new CilError('Cyclic or excessive source type ancestry');
      seen.add(current);
      yield current;
    }
  }

  field(name, offset) {
    for (const owner of this.ancestry(name)) {
      const fields = this.types.get(owner)?.fields ?? [];
      const field = fields.find((value, index) => (value.index ?? index) === offset);
      if (field) return {...field, owner};
    }
    return null;
  }

  *fields(name) {
    const offsets = new Set();
    for (const owner of this.ancestry(name)) {
      const fields = this.types.get(owner)?.fields ?? [];
      for (let index = 0; index < fields.length; index++) {
        const field = fields[index], offset = field.index ?? index;
        if (offsets.has(offset)) throw new CilError('Source inheritance has overlapping field offsets');
        offsets.add(offset);
        yield {...field, index: offset, owner};
      }
    }
  }

  assignable(target, source) {
    if (target === source || source === 'null' || target === 'object' || frameworkAssignable(target, source)) return true;
    for (const current of this.ancestry(source)) {
      if (current === target || this.types.get(current)?.interfaces?.includes(target)) return true;
    }
    return false;
  }
}

export function imageMethodFlags(method, fallback) {
  if (!method.isVirtual) return fallback;
  const access = {private: 1, protected: 4, internal: 3, public: 6}[method.access] ?? 6;
  return access | 0x80 | 0x40 | (method.isOverride ? 0 : 0x100) | (method.isFinal ? 0x20 : 0) | (method.accessor ? 0x800 : 0);
}
