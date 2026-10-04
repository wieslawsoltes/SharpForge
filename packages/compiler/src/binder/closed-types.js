/**
 * Uses of closed classes and closed enums in bodies (SF-A02-T90). PROVISIONAL: C# 15 preview. The pinned Roslyn does
 * not implement the feature, so every rule is the text of the pinned proposal revisions
 * (packages/syntax/src/preview-revisions.js) and is reported with SF2203, which names the proposal:
 *
 * csharplang/proposals/csharp-15.0/closed-hierarchies.md revision 1
 *   "Exhaustiveness in switches"  a switch expression that handles every subtype of a closed class is exhaustive, and
 *                                 the closed class after all of them cannot be reached (./closed-hierarchy.js and
 *                                 flow/pattern-exhaustiveness.js; CS8509 and CS8510 as for any switch expression).
 *   "Interface convertibility of closed classes"  a closed class with a sealed hierarchy has no explicit reference
 *                                 conversion to an interface none of its subtypes implements (CS0030, the diagnostic
 *                                 of a conversion that does not exist).
 *
 * csharplang/proposals/closed-enums.md revision 1, "Enforcement"
 *   "Explicit enumeration conversions are not allowed to a closed enum type, except from a constant whose value
 *    corresponds to a declared member."
 *   "Operators that return a closed enum type are only allowed over constant operands, and it is an error for them
 *    to produce a value that is not a declared member."
 *
 * The proposals do not say what an explicit conversion to a nullable closed enum is, nor how the interface rule
 * applies to generic hierarchies: the first is reported as not bound (SF2202), the second is not applied.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { TypeKind } from '../symbols/types.js';
import { allInterfacesOf } from '../symbols/substitution.js';
import { ConversionKind } from '../conversions/classify.js';
import { isNullableType, stripNullable } from '../conversions/nullable.js';
import { closedHierarchyOf } from './closed-hierarchy.js';

const isClosedEnum = type => type?.typeKind === TypeKind.Enum && (type.originalDefinition ?? type).isClosedEnum === true;

/** True when the constant is the value of a declared member of the closed enum. */
function isDeclaredMember(enumType, constant) {
  const value = constant?.bigint ?? (constant?.value === undefined ? null : BigInt(constant.value));
  return value !== null && enumType.getMembers().some(member => member.isEnumMember && member.enumValue === value);
}

/** The definitions of a closed class and of every class below it when all of them are sealed or closed, else null. */
function sealedHierarchy(definition, seen = new Set()) {
  if (seen.has(definition) || definition.arity) return null;
  seen.add(definition);
  const types = [definition];
  for (const subtype of definition.closedSubtypes ?? []) {
    if (subtype.arity) return null;
    if (subtype.isClosedClass) {
      const below = sealedHierarchy(subtype, seen);
      if (!below) return null;
      types.push(...below);
    } else if (subtype.isSealed) types.push(subtype);
    else return null;
  }
  return types;
}

/** Binder mixin: the provisional rules for uses of closed types. */
export const ClosedTypeBinding = Base =>
  class extends Base {
    closedRule(node, feature, text) {
      this.report(node, DiagnosticId.SF2203, [text, previewStampText(feature)]);
    }
    reportSwitchArms(type, arms, site) {
      const context = { core: this.core, within: this.c.containingType?.originalDefinition ?? null, withinModule: this.d.assembly.module };
      return super.reportSwitchArms(type, arms, { ...site, closedHierarchyOf: governing => closedHierarchyOf(governing, context) });
    }
    cast(syntax) {
      const result = super.cast(syntax);
      if (result.hasErrors || result.kind !== 'Conversion') return result;
      const kind = result.conversion?.kind,
        from = result.operand?.type;
      if (kind === ConversionKind.ExplicitEnumeration && isClosedEnum(result.type)) {
        if (!result.constantValue) this.closedRule(syntax, 'ClosedEnums', 'an explicit conversion to a closed enum type is only allowed from a constant');
        else if (!isDeclaredMember(result.type, result.constantValue))
          this.closedRule(syntax, 'ClosedEnums', `'${this.display(result.type)}' has no member for the constant ${result.constantValue.bigint}`);
      } else if (isNullableType(result.type) && isClosedEnum(stripNullable(result.type)) && result.conversion?.isImplicit === false) {
        const source = from && isNullableType(from) ? stripNullable(from) : from;
        if (!source?.equals(stripNullable(result.type)))
          this.report(syntax, DiagnosticId.SF2202, ['explicit conversions to a nullable closed enum', previewStampText('ClosedEnums')]);
      } else if (kind === ConversionKind.ExplicitReference && result.type.typeKind === TypeKind.Interface && from?.originalDefinition?.isClosedClass) {
        const hierarchy = sealedHierarchy(from.originalDefinition);
        if (hierarchy && !result.type.arity && !hierarchy.some(type => allInterfacesOf(type, this.core).some(i => i.equals(result.type)))) {
          this.report(syntax, DiagnosticId.CS0030, [this.display(from), this.display(result.type)]);
          return this.bad(syntax);
        }
      }
      return result;
    }
    /** An operator whose result is a closed enum needs constant operands and a declared member as its value. */
    checkClosedEnumOperator(result, syntax) {
      const type = result.type && isNullableType(result.type) ? stripNullable(result.type) : result.type;
      if (result.hasErrors || result.method || !isClosedEnum(type)) return result;
      if (!result.constantValue)
        this.closedRule(syntax, 'ClosedEnums', 'an operator that returns a closed enum type is only allowed over constant operands');
      else if (!isDeclaredMember(type, result.constantValue))
        this.closedRule(syntax, 'ClosedEnums', `the operator produces ${result.constantValue.bigint}, not a declared member of '${this.display(type)}'`);
      return result;
    }
    binaryOperation(syntax, operator, left, right) {
      return this.checkClosedEnumOperator(super.binaryOperation(syntax, operator, left, right), syntax);
    }
    unary(syntax, operator) {
      return this.checkClosedEnumOperator(super.unary(syntax, operator), syntax);
    }
    increment(syntax) {
      return this.checkClosedEnumOperator(super.increment(syntax), syntax);
    }
  };
