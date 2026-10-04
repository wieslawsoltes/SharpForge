/**
 * C# 12 inline-array uses (SF-A02-T80): int/Index element access, Range slicing and span conversions.
 * Elements and views alias their receiver; readonly receivers produce readonly references and spans. Bound nodes
 * retain the receiver so escape analysis and emission never confuse the original storage with a struct copy.
 */
import { DiagnosticId } from '../diagnostics/codes.js';
import { ConversionKind } from '../conversions/classify.js';
import { inlineArrayShape } from '../symbols/inline-arrays.js';
import { RefKind } from '../symbols/types.js';
import { classifyVariable } from './ref-kinds.js';

export { inlineArrayShape } from '../symbols/inline-arrays.js';

/** A constant offset and its diagnostic location; null means that the index needs runtime evaluation. */
function constantIndex(index, length, core) {
  const result = (offset, syntax) => ({ offset, syntax });
  if (index.kind === 'FromEndIndex') {
    const value = index.operand.constantValue?.value;
    return typeof value === 'number' ? result(length - value, index.syntax) : null;
  }
  if (index.kind === 'Conversion' && index.type?.equals(core.index)) return constantIndex(index.operand, length, core);
  if (index.kind === 'ObjectCreation' && index.type?.equals(core.index) && !index.initializer &&
    index.args.length >= 1 && index.args.length <= 2 &&
    (!index.mapping?.parameterOf || index.mapping.parameterOf.every((value, i) => value === i))) {
    const argument = index.args[0].expression;
    const value = argument.constantValue?.value;
    const fromEnd = index.args[1]?.expression.constantValue?.value ?? index.constructor?.parameters[1]?.explicitDefaultValue;
    if (typeof value === 'number' && typeof fromEnd === 'boolean') return result(fromEnd ? length - value : value, argument.syntax);
  }
  const value = index.constantValue?.value;
  return typeof value === 'number' ? result(value, index.syntax) : null;
}

/** Class mixin of the body binder; all inline-array use sites share the existing language gate. */
export const InlineArrayBinding = Base =>
  class extends Base {
    elementAccessOn(target, args, syntax) {
      const shape = target.hasErrors ? null : inlineArrayShape(target.type);
      if (!shape) return super.elementAccessOn(target, args, syntax);
      if (args.some(argument => argument.hasErrors)) return this.bad(syntax);
      this.d.gate(this.c.uri, syntax, 'InlineArrays');
      if (target.kind === 'FieldAccess') this.markWrite(target, null);
      const named = syntax.argumentList?.arguments?.find(argument => argument.nameColon);
      if (named) {
        this.report(syntax, DiagnosticId.CS9173);
        return this.bad(syntax);
      }
      const byReference = args.findIndex(argument => argument.refKind && argument.refKind !== RefKind.None);
      if (byReference !== -1) {
        this.report(args[byReference].syntax, DiagnosticId.CS1615, [byReference + 1, args[byReference].refKind]);
        return this.bad(syntax);
      }
      const selected = args.length === 1 ? this.inlineArrayIndex(args[0]) : null;
      if (!selected) {
        this.report(syntax, DiagnosticId.CS9172);
        return this.bad(syntax);
      }
      const { index, indexKind } = selected;
      if (indexKind === 'range') return this.inlineArraySlice(target, index, shape, syntax);
      const constant = constantIndex(index, shape.length, this.core);
      if (constant && (constant.offset < 0 || constant.offset >= shape.length)) {
        this.report(constant.syntax, DiagnosticId.CS9166);
        return this.bad(syntax);
      }
      return this.node('InlineArrayAccess', syntax, shape.elementType, {
        receiver: target, index, indexKind, length: shape.length, constantOffset: constant?.offset ?? null,
      });
    }
    /** The language tries implicit conversion to int, Index and Range, in that order. */
    inlineArrayIndex(argument) {
      for (const [type, indexKind] of [[this.core.int, 'int'], [this.core.index, 'index'], [this.core.range, 'range']]) {
        const conversion = this.conversions.classifyFromExpression(argument, type);
        if (conversion.exists && conversion.isImplicit) {
          return { index: this.applyConversion(argument, type, conversion), indexKind };
        }
      }
      return null;
    }
    inlineArraySlice(receiver, range, shape, syntax) {
      const variable = classifyVariable(receiver, this.variableContext);
      const type = (variable.isWritable ? this.core.span : this.core.readOnlySpan).construct(shape.elementType);
      if (!variable.isVariable) {
        this.report(receiver.syntax, DiagnosticId.CS8156);
        return this.bad(syntax, { receiver, range });
      }
      if (range.kind === 'Range') {
        let invalid = false;
        for (const endpoint of [range.left, range.right]) {
          const constant = endpoint && constantIndex(endpoint, shape.length, this.core);
          if (!constant || (constant.offset >= 0 && constant.offset <= shape.length)) continue;
          this.report(constant.syntax, DiagnosticId.CS9166);
          invalid = true;
        }
        if (invalid) return this.bad(syntax, { receiver, range });
      }
      return this.node('InlineArraySlice', syntax, type, { receiver, range, length: shape.length });
    }
    applyConversion(operand, type, conversion, syntax = operand.syntax, isExplicit = false) {
      if (conversion.kind !== ConversionKind.InlineArray) return super.applyConversion(operand, type, conversion, syntax, isExplicit);
      this.d.gate(this.c.uri, syntax, 'InlineArrays');
      const variable = classifyVariable(operand, this.variableContext);
      const writable = type.originalDefinition === this.core.span;
      if (!variable.isVariable || (writable && !variable.isWritable)) {
        this.report(syntax, writable ? DiagnosticId.CS9164 : DiagnosticId.CS9165, [this.display(type)]);
        return this.bad(syntax, { operand });
      }
      if (operand.kind === 'FieldAccess') this.markWrite(operand, null);
      const shape = inlineArrayShape(operand.type);
      return this.node('InlineArrayConversion', syntax, type, { operand, length: shape.length, isExplicit, conversion });
    }
  };
