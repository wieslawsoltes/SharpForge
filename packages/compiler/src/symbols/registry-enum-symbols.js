import {ConstantValue} from '../constants/constant-value.js';
import {FieldSymbol, DeclarationModifiers} from './members.js';
import {Accessibility} from './types.js';

/** Keep the public raw field value while supplying the semantic binder's typed enum constant. */
export function registryEnumFields(owner, values) {
  return Object.entries(values ?? {}).map(([name, value]) => {
    const field = new FieldSymbol({
      name, type: owner, containingSymbol: owner, declaredAccessibility: Accessibility.Public,
      modifiers: DeclarationModifiers.Const | DeclarationModifiers.Static, constantValue: {value}
    });
    field.isEnumMember = true;
    field.enumValue = BigInt(value);
    field.constantValueObject = ConstantValue.enum(owner, value);
    return field;
  });
}
