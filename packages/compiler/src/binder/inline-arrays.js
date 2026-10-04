/**
 * C# 12 inline-array uses (SF-A02-T80): int/Index element access, Range slicing and span conversions.
 * Elements and views alias their receiver; readonly receivers produce readonly references and spans. Bound nodes
 * retain the receiver so escape analysis and emission never confuse the original storage with a struct copy.
 */
import { DiagnosticId } from '../diagnostics/codes.js';
import { ConversionKind } from '../conversions/classify.js';
import { inlineArrayShape } from '../symbols/inline-arrays.js';
import { classifyVariable } from './ref-kinds.js';

export { inlineArrayShape } from '../symbols/inline-arrays.js';

/** The constant offset of an int or Index expression in an inline array, null when it requires runtime evaluation. */
function constantOffset(index, length) {
  if (index.kind === 'FromEndIndex') {
    const value = index.operand.constantValue?.value;
    return typeof value === 'number' ? length - value : null;
  }
  if (index.kind === 'Conversion' && index.type?.specialType === 'System_Index') return constantOffset(index.operand, length);
  const value = index.constantValue?.value;
  return typeof value === 'number' ? value : null;
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
        this.report(named.nameColon, DiagnosticId.CS9173);
        return this.bad(syntax);
      }
      const selected = args.length === 1 ? this.inlineArrayIndex(args[0]) : null;
      if (!selected) {
        this.report(syntax, DiagnosticId.CS9172);
        return this.bad(syntax);
      }
      const { index, indexKind } = selected;
      if (indexKind === 'range') return this.inlineArraySlice(target, index, shape, syntax);
      const offset = constantOffset(index, shape.length);
      if (offset !== null && (offset < 0 || offset >= shape.length)) {
        this.report(args[0].syntax, DiagnosticId.CS9166);
        return this.bad(syntax);
      }
      return this.node('InlineArrayAccess', syntax, shape.elementType, {
        receiver: target, index, indexKind, length: shape.length, constantOffset: offset,
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
        this.report(receiver.syntax, DiagnosticId.CS9165, [this.display(type)]);
        return this.bad(syntax, { receiver, range });
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
