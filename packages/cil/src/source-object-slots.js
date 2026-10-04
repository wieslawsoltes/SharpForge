import {sourceObjectSlot} from '@sharpforge/bytecode';

/** Flags are real CLI override metadata; the debug stream does not grant virtual dispatch. */
export function sourceMethodFlags(method) {
  if (method.isVirtual) return 0x80 | (method.isStatic ? 0x10 : 0) | 0x40 | (method.isAbstract ? 0x400 : 0) |
    (method.isFinal ? 0x20 : 0) | (method.isNewSlot ? 0x100 : 0) | (method.accessor ? 0x800 : 0) |
    ({public: 6, private: 1, protected: 4, internal: 3}[method.access] ?? 6);
  if (method.objectSlot && method.objectSlot === sourceObjectSlot(method)) return 0xc6;
  if (method.implementsDispose) return 0x1e6;
  if (method.accessor) return 0x880 | (method.isStatic ? 0x10 : 0) |
    ({public: 6, private: 1, protected: 4, internal: 3}[method.accessor.access] ?? 1);
  if (method.name === '.cctor') return 0x1891;
  if (method.name === '.ctor') return 0x83;
  return method.isStatic ? 0x96 : 0x86;
}

export function loadObjectSlot(name, signature, flags) {
  if ((flags & 0x140) !== 0x40 || (flags & 7) !== 6 || signature.genericArity || signature.callingConvention ||
      signature.explicitThis || signature.sentinel != null) return {};
  const slot = sourceObjectSlot({name, ...signature});
  return slot ? {objectSlot: slot} : {};
}
