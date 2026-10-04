/**
 * "A write is a use" (SF-A02-T34): whether storing `value` in a local counts as using the local, which decides
 * between CS0219 (assigned but its value is never used) and no warning for a local that is never read.
 *
 * Roslyn's rule (DefiniteAssignment.WriteConsideredUse, kept from the native compiler): a local that is only written
 * is reported when what is written says nothing - a constant, `default`, or `new S()` of a struct without a declared
 * constructor - also behind implicit conversions (`int? none = null;`). A local of a reference type other than string
 * is reported only when the constant null is stored: any other object it holds is kept alive by it.
 */
import { TypeKind } from '../symbols/types.js';

const isPointer = type => type?.typeKind === TypeKind.Pointer || type?.typeKind === TypeKind.FunctionPointer;
const isNullConstant = value => value.literal === 'null' || value.constantValue?.isNull === true;

/**
 * @param type the type of the local, or null when only the value matters
 * @param value the bound expression stored (null: nothing is known, the write is a use)
 */
export function isWriteAUse(type, value) {
  if (!value) return true;
  // A value in error is a use - except a constant that only does not fit its target (`(byte)300`, CS0221): Roslyn
  // reports the conversion and still sees a constant.
  const isNumeric = /Numeric|Constant/.test(String(value.conversion?.kind ?? '')),
    isConstantOutOfRange = value.kind === 'Conversion' && isNumeric && !!value.operand?.constantValue && !value.operand.hasErrors;
  if (value.hasErrors && !isConstantOutOfRange) return true;
  if (value.hasErrors) return false;
  if (type?.isReferenceType === true && type.specialType !== 'System_String') return !isNullConstant(value);
  if (isPointer(type)) return true;
  if (value.constantValue || value.literal || value.isCompileTimeValue) return false;
  switch (value.kind) {
    case 'Conversion':
      return value.conversion?.isUserDefined || !value.operand ? true : isWriteAUse(null, value.operand);
    case 'Default':
      return false;
    case 'ObjectCreation': {
      const constructor = value.constructor,
        hasInitializer = !!(value.initializers?.length || value.collectionInitializers?.length);
      return hasInitializer || !constructor || typeof constructor !== 'object' || !constructor.isImplicitlyDeclared;
    }
    default:
      return true;
  }
}
