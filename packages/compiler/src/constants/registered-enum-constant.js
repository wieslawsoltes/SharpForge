import {frameworkType} from '@sharpforge/framework';
import {SymbolKind, TypeKind} from '../symbols/types.js';
import {ConstantValue} from './constant-value.js';

/** Adapt a registered named enum field to a typed constant without changing its public FieldSymbol value. */
export function registeredEnumConstant(field, registry) {
  if (field?.kind !== SymbolKind.Field || !field.isConst || field.type?.typeKind !== TypeKind.Enum ||
      field.containingType !== field.type) return null;
  const name = registry.registryName(field.type);
  if (!name) return null;
  const metadata = frameworkType(name);
  const underlying = metadata?.underlyingType ?? 'int';
  if (metadata?.kind !== 'enum' || underlying !== 'int' && underlying !== 'System.Int32' ||
      !Object.hasOwn(metadata.values, field.name)) return null;
  const value = metadata.values[field.name];
  // Op.ENUM stores its value in an Int32 instruction operand; other carriers remain outside this lowering.
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647 || field.constantValue !== value) return null;
  return ConstantValue.integral('int', value, field.type);
}
