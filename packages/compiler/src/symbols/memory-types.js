import {arrayType, spanType} from '@sharpforge/bytecode';
import {ArrayTypeSymbol, NamedTypeSymbol, TypeKind, ErrorTypeSymbol} from './types.js';

export function memoryTypeSymbol(adapter, name) {
  const array = arrayType(name);
  if (array) return new ArrayTypeSymbol(adapter.symbol(array.element) ?? ErrorTypeSymbol.unknown, array.rank, {
    baseType: () => adapter.bridge.typeProvider.getCoreTypeQuiet('System_Array'),
  });
  const span = spanType(name);
  if (span) {
    const type = new NamedTypeSymbol({name, typeKind: TypeKind.Struct, isSealed: true, isRefLikeType: true,
      isReadOnly: span.readonly, baseType: () => adapter.bridge.typeProvider.getCoreTypeQuiet('System_ValueType')});
    type.legacyName = name;
    return type;
  }
  return null;
}
