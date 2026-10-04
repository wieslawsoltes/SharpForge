/**
 * Indices and ranges (SF-A02-T67; C# 8): `^n` is a `System.Index`, `a..b` is a `System.Range`, and an element
 * access whose single argument is an Index or a Range works on every type the language can count and index.
 *
 * `receiver[index]` and `receiver[range]` bind in this order (C# spec "implicit Index/Range support"):
 *   1. an indexer of the receiver's type that takes an Index or a Range is an ordinary indexer access;
 *   2. otherwise the receiver must be countable - an array, or a type with an accessible `int Length` or
 *      `int Count` property - and
 *        - for an Index, indexable with one `int` (the access becomes `receiver[offset]`);
 *        - for a Range, an array (a copy of the elements), a string (`Substring`) or a type with an accessible
 *          `Slice(int, int)` method (the access becomes `receiver.Slice(start, end - start)`);
 *   3. otherwise the ordinary binding reports why the argument does not fit (CS1503, CS0029, CS0021).
 *
 * The implicit forms are bound once, over placeholders: the bound `ImplicitIndexerAccess` carries
 *   receiver      the receiver expression, evaluated once
 *   args          the single Index or Range argument
 *   length        `receiver.Length` / `.Count` / the array length, over `receiverPlaceholder`
 *   access        the int-indexed access or the `Slice` call, over `receiverPlaceholder` and `offsetPlaceholders`
 *                 (null for the slice of an array, which has no member to call)
 * so overload resolution, accessibility and conversions of the underlying members are the ordinary ones, and
 * lowering (lowering/index-range.js) only supplies the offsets.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, RefKind, ArrayTypeSymbol } from '../symbols/types.js';
import { lookupMembers } from './inheritance.js';

/** 'index', 'range' or null for the type of an argument. */
export function indexOrRangeKind(type, core) {
  if (!type || core.index.isErrorType()) return null;
  if (type.equals(core.index)) return 'index';
  if (type.equals(core.range)) return 'range';
  return null;
}

/** Class mixin: index and range expressions and the element accesses that take them. */
export const IndexRangeBinding = Base =>
  class extends Base {
    expression(syntax, options = {}) {
      if (syntax.kind === 'IndexExpression') return this.fromEndIndex(syntax);
      if (syntax.kind === 'RangeExpression') return this.rangeExpression(syntax);
      return super.expression(syntax, options);
    }
    /** `^operand`: the operand converts implicitly to int. */
    fromEndIndex(syntax) {
      const value = this.value(syntax.operand);
      if (this.core.index.isErrorType()) return this.lenient(syntax);
      if (value.hasErrors) return this.bad(syntax);
      const conversion = this.conversions.classifyFromExpression(value, this.core.int);
      if (!conversion.exists || !conversion.isImplicit) {
        // Roslyn reports the whole `^e`, and an explicit conversion does not change the code.
        this.report(syntax, DiagnosticId.CS0029, [this.operandDisplay(value), 'int']);
        return this.bad(syntax);
      }
      return this.node('FromEndIndex', syntax, this.core.index, { operand: this.applyConversion(value, this.core.int, conversion) });
    }
    /** `left..right`, either side optional: each operand converts implicitly to System.Index. */
    rangeExpression(syntax) {
      const operand = side => (side ? this.convert(this.value(side), this.core.index, side) : null);
      if (this.core.range.isErrorType()) {
        for (const side of [syntax.leftOperand, syntax.rightOperand]) if (side) this.value(side);
        return this.lenient(syntax);
      }
      const left = operand(syntax.leftOperand),
        right = operand(syntax.rightOperand);
      if (left?.hasErrors || right?.hasErrors) return this.bad(syntax);
      return this.node('Range', syntax, this.core.range, { left, right });
    }
    elementAccessOn(target, args, syntax) {
      if (target.hasErrors || args.some(argument => argument.hasErrors)) return this.bad(syntax);
      const kinds = args.map(argument => indexOrRangeKind(argument.type, this.core)),
        type = target.type;
      if (!type || !kinds.some(Boolean)) return super.elementAccessOn(target, args, syntax);
      if (type instanceof ArrayTypeSymbol && type.rank !== 1) {
        // Only a single-dimensional array takes an Index or a Range: each such argument fails to convert to int.
        args.forEach((argument, i) => kinds[i] && this.convert(argument, this.core.int, argument.syntax));
        return this.bad(syntax);
      }
      if (args.length === 1 && !this.hasIndexerTaking(type, args[0].type)) {
        const implicit = this.implicitIndexerAccess(target, args[0], kinds[0], syntax);
        if (implicit) return implicit;
      }
      return super.elementAccessOn(target, args, syntax);
    }
    /** True when the type declares an indexer whose single parameter is exactly `argumentType` (an Index or a Range). */
    hasIndexerTaking(type, argumentType) {
      if (type instanceof ArrayTypeSymbol) return false;
      const within = this.c.containingType;
      return ['this[]', 'Item'].some(name =>
        lookupMembers(type, name, this.core, { within }).members.some(
          member => member.kind === SymbolKind.Property && member.parameters.length === 1 && member.parameters[0].type.equals(argumentType),
        ),
      );
    }
    /** The implicit Index or Range access of a countable receiver, or null when the type does not support it. */
    implicitIndexerAccess(target, argument, kind, syntax) {
      const type = target.type,
        receiverPlaceholder = this.placeholder(target.syntax, type),
        length = this.lengthOf(receiverPlaceholder, syntax);
      if (!length) return null;
      const offsetPlaceholders = (kind === 'index' ? [argument] : [argument, argument]).map(of => this.placeholder(of.syntax, this.core.int));
      let access = null,
        resultType = type;
      if (kind === 'index') access = this.quietly(() => super.elementAccessOn(receiverPlaceholder, offsetPlaceholders, syntax));
      else if (!(type instanceof ArrayTypeSymbol)) access = this.sliceCall(receiverPlaceholder, offsetPlaceholders, syntax);
      if (access) {
        if (access.hasErrors) return null;
        resultType = access.type;
      } else if (!(type instanceof ArrayTypeSymbol)) return null;
      return this.node('ImplicitIndexerAccess', syntax, resultType, {
        receiver: target,
        args: [{ expression: argument }],
        accessKind: kind,
        receiverPlaceholder,
        offsetPlaceholders,
        length,
        access,
      });
    }
    /** A bound node that stands for a value supplied by lowering. */
    placeholder(syntax, type) {
      return this.node('Placeholder', syntax, type, {});
    }
    /** `receiver.Length`, else `receiver.Count`: an accessible instance property of type int with a getter. */
    lengthOf(receiver, syntax) {
      const type = receiver.type;
      if (type instanceof ArrayTypeSymbol) return this.node('ArrayLength', syntax, this.core.int, { operand: receiver });
      for (const name of ['Length', 'Count']) {
        const property = lookupMembers(type, name, this.core, { within: this.c.containingType }).members.find(
          member => member.kind === SymbolKind.Property && !member.isStatic && member.getMethod && member.type.equals(this.core.int),
        );
        if (property) return this.node('PropertyAccess', syntax, this.core.int, { property, receiver });
      }
      return null;
    }
    /** `receiver.Slice(start, length)` (`Substring` on a string): the accessible instance method with two int parameters. */
    sliceCall(receiver, offsets, syntax) {
      const name = receiver.type.specialType === 'System_String' ? 'Substring' : 'Slice',
        isInt = parameter => parameter.type.equals(this.core.int) && (!parameter.refKind || parameter.refKind === RefKind.None),
        method = lookupMembers(receiver.type, name, this.core, { within: this.c.containingType }).members.find(
          member => member.kind === SymbolKind.Method && !member.isStatic && !member.arity && member.parameters.length === 2 && member.parameters.every(isInt),
        );
      if (!method) return null;
      const resolution = this.d.overloads.resolve([method], offsets, { name });
      if (!resolution.succeeded) return null;
      return this.quietly(() => this.finishCall(resolution, receiver, offsets, syntax, {}));
    }
  };
