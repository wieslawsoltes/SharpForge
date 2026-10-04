/**
 * The interpolated string handler pattern (SF-A02-T75, C# 10): what the conversion of `$"a {x,5:F2} b"` to a type
 * marked `[InterpolatedStringHandler]` means.
 *
 *   var handler = new Handler(literalLength, formattedCount [, out bool enabled]);
 *   handler.AppendLiteral("a ");
 *   handler.AppendFormatted(x, alignment: 5, format: "F2");
 *   handler.AppendLiteral(" b");
 *
 * The constructor is tried with a trailing `out bool` first; when it has one, nothing is appended unless it reports
 * true. Each `Append...` call is an ordinary invocation on the handler, bound by overload resolution with the hole's
 * value and - when the hole has them - the named arguments `alignment` and `format`. The calls return `void`, or all
 * of them `bool`: then a call that returns false ends the appending.
 *
 *   CS1061  the handler has no AppendLiteral / AppendFormatted          CS8941  a call returns neither void nor bool
 *   CS1729, CS7036, CS1503 ...  no usable constructor or overload       CS8942  the calls do not all return the same
 *
 * The bound pattern is carried by the conversion (`conversion.handler`), so generic traversals of the bound tree see
 * the interpolated string and its holes once, as the operand.
 *
 * A handler parameter marked `[InterpolatedStringHandlerArgument]` passes the receiver or other arguments of its
 * call to the constructor, after the counts (./handler-arguments.js).
 *
 * Not bound here: a `+` of interpolated strings converted as one handler.
 */
import { DiagnosticId } from '../diagnostics/codes.js';
import { SymbolKind, RefKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { Conversion, ConversionKind } from '../conversions/classify.js';
import { ConstantValue } from '../constants/constant-value.js';
import { lookupMembers } from './inheritance.js';
import { isAccessible } from './accessibility.js';
import { interpolatedText } from './csharp6.js';
import { handlerArgumentsOf } from './handler-arguments.js';

const feature = 'ImprovedInterpolatedStrings';

const isBool = type => type?.specialType === 'System_Boolean';
const isVoid = type => type?.specialType === 'System_Void';
/** A bound expression as an argument; `at` is where an error about a named argument is reported. */
const asArgument = (expression, name = null, at = null) =>
  Object.assign(expression.hasErrors ? { ...expression } : expression, {
    refKind: null,
    name,
    argumentSyntax: { expression: expression.syntax, nameColon: at ? { name: at } : null },
  });

/** Class mixin of the body binder: the conversion of an interpolated string to a handler type. */
export const InterpolatedStringHandlerBinding = Base =>
  class extends Base {
    applyConversion(e, type, c, node = e.syntax, isExplicit = false) {
      if (c.kind !== ConversionKind.InterpolatedStringHandler) return super.applyConversion(e, type, c, node, isExplicit);
      this.d.gate(this.c.uri, e.syntax, feature);
      const handler = this.interpolatedStringHandler(e, type),
        conversion = new Conversion(ConversionKind.InterpolatedStringHandler, { handler });
      return this.node('Conversion', node, type, { operand: e, conversion, isExplicit, hasErrors: !handler });
    }
    /** A literal argument the pattern supplies: a length, a count, an alignment, a text, a format. */
    handlerLiteral(syntax, value, name = null) {
      const isText = typeof value === 'string',
        node = this.node('Literal', syntax, isText ? this.core.string : this.core.int, { isCompilerGenerated: true });
      node.constantValue = isText ? ConstantValue.string(value) : ConstantValue.int(value);
      return asArgument(node, name, name ? syntax : null);
    }
    /**
     * Binds the handler pattern of the interpolated string `e` for the handler type `type`.
     * @returns {null|{placeholder, creation, enabled, appends, appendsReturnBool}} null after reporting why it does not bind
     */
    interpolatedStringHandler(e, type) {
      const syntax = e.syntax,
        contents = syntax.contents,
        placeholder = this.node('InterpolatedStringHandlerPlaceholder', syntax, type, {}),
        texts = contents.map(content => (content.kind === 'Interpolation' ? null : interpolatedText(content))),
        literalLength = texts.reduce((sum, text) => sum + (text?.length ?? 0), 0),
        creation = this.handlerCreation(syntax, type, { literalLength, formattedCount: e.parts.length, expression: e });
      if (!creation) return null;
      const appends = [];
      let hole = 0,
        failed = false;
      contents.forEach((content, position) => {
        const isHole = content.kind === 'Interpolation',
          args = isHole ? this.holeArguments(content, e, hole++) : [this.handlerLiteral(content, texts[position])],
          call = args.some(a => a.hasErrors) ? null : this.handlerCall(placeholder, type, isHole ? 'AppendFormatted' : 'AppendLiteral', args, content);
        if (call) appends.push(call);
        else failed = true;
      });
      if (failed || !this.checkAppendReturns(appends)) return null;
      return { placeholder, ...creation, appends, appendsReturnBool: appends.length > 0 && isBool(appends[0].method.returnType) };
    }
    /** `AppendFormatted(value [, alignment: n] [, format: "f"])` arguments of one hole. */
    holeArguments(content, e, index) {
      const args = [asArgument(e.parts[index])],
        alignment = e.alignments[index];
      if (content.alignmentClause) {
        // An alignment that is not a constant was reported where the string was bound.
        if (alignment === null) return [{ hasErrors: true }];
        args.push(this.handlerLiteral(content.alignmentClause.value, alignment, 'alignment'));
      }
      if (content.formatClause) args.push(this.handlerLiteral(content.formatClause, content.formatClause.formatStringToken.valueText, 'format'));
      return args;
    }
    /** The constructor call: `(literalLength, formattedCount, out bool)` when the type has one, else without the flag. */
    handlerCreation(syntax, type, { literalLength, formattedCount, expression }) {
      const within = this.c.containingType?.originalDefinition ?? null,
        all = type.getMembers('.ctor').filter(m => m.methodKind === MethodKind.Constructor && !m.isStatic),
        constructors = all.filter(c => isAccessible(c.originalDefinition ?? c, within, { throughType: type.originalDefinition })),
        placeholders = this.handlerArgumentPlaceholders(syntax, expression);
      // What the parameter asks for is not bound (see ./handler-arguments.js): nothing is reported about it.
      if (!placeholders) {
        this.lenient(syntax);
        return null;
      }
      const counts = () => [this.handlerLiteral(syntax, literalLength), this.handlerLiteral(syntax, formattedCount), ...placeholders];
      // The flag is passed like a discard: any `out bool` parameter takes it.
      const flag = this.node('Discard', syntax, this.core.bool, { isOutVarOrDiscard: true, isEnabledFlag: true }),
        enabled = Object.assign(flag, { refKind: RefKind.Out, name: null });
      let args = [...counts(), enabled],
        result = this.d.overloads.resolve(constructors, args, { isConstructor: true });
      const usesFlag = result.succeeded;
      if (!usesFlag) {
        args = counts();
        result = this.d.overloads.resolve(constructors, args, { isConstructor: true });
      }
      if (!result.succeeded) {
        const error = result.error;
        this.report(syntax, error.code, error.code === DiagnosticId.CS1729 ? [this.display(type), args.length] : error.args);
        return null;
      }
      const call = this.finishCall(result, null, args, syntax, {}),
        node = { constructor: result.method, args: call.args, expanded: result.expanded, mapping: call.mapping, callerInfo: call.callerInfo };
      return { creation: this.node('ObjectCreation', syntax, type, node), enabled: usesFlag ? enabled : null, argumentPlaceholders: placeholders };
    }
    /**
     * The constructor arguments a `[InterpolatedStringHandlerArgument]` parameter adds for the interpolated string
     * `expression`: placeholders for the receiver and arguments of the call being finished.
     * @returns {object[]|null} an empty list when the string is not such an argument, null when it cannot be bound
     */
    handlerArgumentPlaceholders(syntax, expression) {
      const call = this.handlerContext,
        index = call ? call.args.indexOf(expression) : -1,
        wanted = index < 0 ? null : handlerArgumentsOf(call, index);
      if (wanted === false) return null;
      return (wanted ?? []).map(({ argumentIndex, type }) =>
        asArgument(this.node('InterpolatedStringHandlerArgumentPlaceholder', syntax, type, { argumentIndex, isCompilerGenerated: true })),
      );
    }
    /** A call with an interpolated string among its arguments is remembered while its arguments are converted. */
    finishCall(result, receiver, args, syntax, options = {}) {
      if (!args.some(argument => argument.form === 'interpolatedString')) return super.finishCall(result, receiver, args, syntax, options);
      const outer = this.handlerContext;
      this.handlerContext = { method: result.method, mapping: result.mapping, parameterTypes: result.parameterTypes, receiver, args };
      try {
        return super.finishCall(result, receiver, args, syntax, options);
      } finally {
        this.handlerContext = outer;
      }
    }
    /** One `handler.Append...(args)` call, or null after reporting why it does not bind. */
    handlerCall(placeholder, type, name, args, at) {
      const found = lookupMembers(type, name, this.core, { within: this.c.containingType }),
        methods = found.members.filter(m => m.kind === SymbolKind.Method);
      if (!methods.length) {
        // Roslyn reports the missing method and, as it has no return type, the malformed pattern.
        this.report(at, DiagnosticId.CS1061, [this.display(type), name]);
        this.report(at, DiagnosticId.CS8941, ['?.()']);
        return null;
      }
      const result = this.d.overloads.resolve(methods, args, { name });
      if (!result.succeeded) {
        const error = result.error;
        this.report(this.errorNode(error, args, at), error.code, error.args);
        return null;
      }
      const call = this.finishCall(result, placeholder, args, at, {});
      return call.hasErrors ? null : call;
    }
    /** Every call returns void or bool (CS8941), and all the same (CS8942, with the type of the first call). */
    checkAppendReturns(appends) {
      let expected = null,
        consistent = true;
      for (const call of appends) {
        const returned = call.method.returnType;
        if (!isVoid(returned) && !isBool(returned)) {
          this.report(call.syntax, DiagnosticId.CS8941, [call.method.toDisplayString()]);
          consistent = false;
          continue;
        }
        if (expected && !expected.equals(returned)) {
          this.report(call.syntax, DiagnosticId.CS8942, [call.method.toDisplayString(), this.display(expected)]);
          consistent = false;
        }
        expected ??= returned;
      }
      return consistent;
    }
  };
