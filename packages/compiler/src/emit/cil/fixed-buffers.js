/**
 * Fixed-size buffers (unsafe code, SF-A02-T30), declared as Roslyn declares them. For `public fixed int Data[4];`:
 *
 *   [StructLayout(Sequential, Size = 16)] public struct <Data>e__FixedBuffer { public int FixedElementField; }
 *   [FixedBuffer(typeof(int), 4)] public <Data>e__FixedBuffer Data;
 *
 * The buffer struct is nested in the struct that declares the field; its size is the element size times the length
 * (a ClassLayout row), so the enclosing struct has room for every element. Code reaches element 0 through
 * `FixedElementField` and the others by pointer arithmetic from it (emit-pointers.js).
 */
import { FieldAttributes } from '@sharpforge/cil';
import { NamedTypeSymbol, SymbolKind, TypeKind, Accessibility } from '../../symbols/types.js';
import { allTypeParameters } from '../../codegen/generics.js';
import { primitiveOf } from './type-facts.js';

const BITS_PER_BYTE = 8;
const ELEMENT_FIELD = 'FixedElementField';

/**
 * The buffer struct of every fixed-size buffer field of the given types.
 * @param {object[]} types source type definitions  @param core the core types
 * @returns {{types: object[], byField: Map<object, object>}} the structs in declaration order and, by field symbol,
 *   `{type, elementType, length, elementField}`
 */
export function planFixedBuffers(types, core) {
  const plan = { types: [], byField: new Map() };
  for (const owner of types) {
    // A buffer of a generic struct would need a generic buffer struct; it is left undeclared and its use is refused.
    if (allTypeParameters(owner).length) continue;
    for (const field of owner.getMembers()) {
      if (field.kind !== SymbolKind.Field || !field.isFixedSizeBuffer) continue;
      const elementType = field.type.pointedAtType,
        type = new NamedTypeSymbol({
          name: `<${field.name}>e__FixedBuffer`,
          typeKind: TypeKind.Struct,
          containingSymbol: owner,
          declaredAccessibility: Accessibility.Public,
          baseType: () => core.valueType,
          isImplicitlyDeclared: true,
        });
      type.isSource = true;
      type.isFixedBufferType = true;
      const elementField = { symbol: null, name: ELEMENT_FIELD, flags: FieldAttributes.Public, type: elementType, constant: null };
      plan.types.push(type);
      plan.byField.set(field, { type, elementType, length: field.fixedBufferLength ?? null, elementField });
    }
  }
  return plan;
}

/** The size in bytes of a buffer: every element type of a fixed-size buffer is a primitive of a known size. */
function bufferSize(buffer) {
  return (primitiveOf(buffer.elementType).bits / BITS_PER_BYTE) * buffer.length;
}

/**
 * Adds the rows of fixed-size buffers to the member plan of one type: a declaring struct gets its buffer fields
 * typed as their buffer structs, a buffer struct its element field and its size.
 */
export function extendWithFixedBuffers(buffers, type, plan) {
  for (const field of plan.fields) {
    const buffer = field.symbol ? buffers.byField.get(field.symbol) : null;
    if (!buffer) continue;
    field.type = buffer.type;
    field.fixedBuffer = { elementType: buffer.elementType, length: buffer.length };
  }
  if (!type.isFixedBufferType) return;
  const buffer = [...buffers.byField.values()].find(entry => entry.type === type);
  plan.fields.push(buffer.elementField);
  plan.classSize = bufferSize(buffer);
}
