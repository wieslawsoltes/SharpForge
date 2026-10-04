/**
 * Conversions (SF-A02-T30): numeric and enumeration conversions with their checked forms, reference conversions,
 * boxing and unboxing, and user-defined conversion operators.
 */
import { TypeKind } from '../../symbols/types.js';
import { primitiveOf } from './type-facts.js';
import { describeKind } from './unsupported.js';

const numericKinds = new Set(['ImplicitNumeric', 'ExplicitNumeric', 'ImplicitConstant', 'ImplicitEnumeration', 'ExplicitEnumeration', 'IntPtr']);

/** Class mixin: conversions. */
export const ConversionEmission = Base =>
  class extends Base {
    exprConversion(node) {
      const kind = node.conversion?.kind,
        operand = node.operand;
      if (numericKinds.has(kind)) {
        this.expression(operand);
        return this.numericConversion(operand.type, node.type, { isChecked: !!node.isChecked, syntax: node.syntax });
      }
      switch (kind) {
        case 'Identity':
          return this.expression(operand);
        case 'ImplicitReference':
          this.expression(operand);
          // A type parameter is not a reference on the stack until it is boxed.
          if (operand.type?.typeKind === TypeKind.TypeParameter) this.il.emit('box', this.tokens.type(operand.type));
          return undefined;
        case 'NullLiteral':
        case 'DefaultLiteral':
          return this.defaultValue(node.type);
        case 'Boxing':
          this.expression(operand);
          return this.il.emit('box', this.tokens.type(operand.type));
        case 'Unboxing':
          this.expression(operand);
          return this.il.emit('unbox.any', this.tokens.type(node.type));
        case 'ExplicitReference':
          this.expression(operand);
          return this.explicitReference(node);
        case 'ImplicitUserDefined':
        case 'ExplicitUserDefined':
          return this.userDefinedConversion(node);
        case 'MethodGroup':
          return this.methodGroupConversion(node);
        case 'AnonymousFunction':
          return this.anonymousFunctionConversion(node);
        case 'ImplicitNullable':
        case 'ExplicitNullable':
          return this.nullableConversion(node);
        case 'ImplicitThrow':
          return this.expression(operand);
        default:
          return this.unsupported(`${describeKind(kind ?? 'unknown')} conversions`, node.syntax);
      }
    }
    /** A cast between reference types is checked at run time; a cast to or from a type parameter goes through a box. */
    explicitReference(node) {
      const from = node.operand.type,
        to = node.type;
      if (from?.typeKind === TypeKind.TypeParameter) this.il.emit('box', this.tokens.type(from));
      if (to.typeKind === TypeKind.TypeParameter) return this.il.emit('unbox.any', this.tokens.type(to));
      return this.il.emit('castclass', this.tokens.type(to));
    }
    /**
     * Converts the number on the stack between two primitive (or enum) types (ECMA-335 III.3.27, III.3.28): an
     * unchecked conversion truncates, a checked one traps, and the source's signedness selects the `.un` forms.
     */
    numericConversion(from, to, { isChecked = false, syntax = null } = {}) {
      const source = primitiveOf(from),
        target = primitiveOf(to);
      if (!source || !target) {
        return this.unsupported(`converting '${from?.toDisplayString()}' to '${to?.toDisplayString()}'`, syntax);
      }
      if (source === target) return undefined;
      // A value narrower than int32 is already extended to int32 on the stack.
      if (source.stack === 'i4' && source.bits < 32 && target.stack === 'i4' && target.bits === 32 && !isChecked) return undefined;
      const il = this.il;
      if (target.isFloat) {
        // An unsigned integer is first converted as unsigned; `conv.r4`/`conv.r8` read the stack value as signed.
        if (!source.isFloat && !source.isSigned) il.emit('conv.r.un');
        return il.emit('conv.' + target.suffix);
      }
      if (isChecked && this.canOverflow(source, target)) {
        return il.emit('conv.ovf.' + target.suffix + (source.isFloat || source.isSigned ? '' : '.un'));
      }
      if (target.stack === 'i8' && !source.isFloat) {
        // Widening follows the source: sign-extend a signed value, zero-extend an unsigned one.
        return source.stack === 'i8' ? undefined : il.emit(source.isSigned ? 'conv.i8' : 'conv.u8');
      }
      return il.emit('conv.' + target.suffix);
    }
    /** False when every value of the source fits the target, so that a checked conversion needs no trap. */
    canOverflow(source, target) {
      if (source.isFloat) return true;
      const sourceBits = source.bits || 64,
        targetBits = target.bits || 64;
      if (source.isSigned === target.isSigned) return sourceBits > targetBits;
      return source.isSigned ? true : sourceBits >= targetBits;
    }
    userDefinedConversion(node) {
      const method = node.conversion.method ?? node.method;
      if (!method) return this.unsupported('this user-defined conversion', node.syntax);
      const parameterType = method.parameters[0].type,
        operand = node.operand;
      this.expression(operand);
      this.implicitStandardConversion(operand.type, parameterType, node.syntax);
      this.callMethod(method, { isStatic: true, syntax: node.syntax });
      return this.implicitStandardConversion(method.returnType, node.type, node.syntax);
    }
    /** The standard conversion around a user-defined operator: numeric, or boxing to a reference type. */
    implicitStandardConversion(from, to, syntax) {
      if (!from || !to || from.equals(to)) return undefined;
      if (primitiveOf(from) && primitiveOf(to)) return this.numericConversion(from, to, { syntax });
      if (from.isValueType && to.isReferenceType) return this.il.emit('box', this.tokens.type(from));
      if (from.isReferenceType && to.isReferenceType) return undefined;
      return this.unsupported(`converting '${from.toDisplayString()}' to '${to.toDisplayString()}' around an operator`, syntax);
    }
    methodGroupConversion(node) {
      return this.unsupported('method group conversions', node.syntax);
    }
    anonymousFunctionConversion(node) {
      return this.unsupported('lambda expressions', node.syntax);
    }
    nullableConversion(node) {
      return this.unsupported('nullable value types', node.syntax);
    }
  };
