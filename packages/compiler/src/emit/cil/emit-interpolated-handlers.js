/**
 * Interpolated string handlers (C# 10, SF-A02-T30): the conversion of `$"a {x,5:F2} b"` to a type marked
 * `[InterpolatedStringHandler]`, emitted as the pattern the binder bound (binder/interpolated-string-handlers.js):
 *
 *   var handler = new Handler(literalLength, formattedCount [, out bool enabled]);
 *   [if (enabled)]  handler.AppendLiteral("a ") [&&] handler.AppendFormatted(x, 5, "F2") [&&] handler.AppendLiteral(" b");
 *
 * The handler lives in a temporary: the calls are made on it (on its address for a struct) and its value is the
 * result. With an `out bool` constructor nothing is appended - and no hole is evaluated - unless the flag is true;
 * when the appending calls return `bool`, the first that returns false ends the appending.
 */
import { ConversionKind } from '../../conversions/classify.js';
import { RefKind } from '../../symbols/types.js';
import { isReference } from './type-facts.js';

const isByReference = refKind => !!refKind && refKind !== RefKind.None;

/** The bound handler pattern of an argument that is an interpolated string converted to a handler type, or null. */
const handlerOf = expression => (expression?.conversion?.kind === ConversionKind.InterpolatedStringHandler ? expression.conversion.handler : null);

/** Class mixin: interpolated string handler conversions. */
export const InterpolatedHandlerEmission = Base =>
  class extends Base {
    /**
     * A call with a handler argument that takes the receiver or earlier arguments (`[InterpolatedStringHandlerArgument]`):
     * the receiver and the arguments before the handler are evaluated once, into temporaries, and read again by
     * the handler's constructor.
     */
    exprCall(node, isUsed) {
      const handlerAt = (node.args ?? []).findIndex(argument => handlerOf(argument.expression)?.argumentPlaceholders?.length > 0);
      if (handlerAt < 0) return super.exprCall(node, isUsed);
      const il = this.il,
        saved = new Map(),
        parameters = node.method.parameters,
        save = (expression, byReference) => {
          if (byReference) this.address(expression);
          else this.expression(expression);
          const slot = this.temp(expression.type, { isByReference: byReference }),
            load = () => il.emit('ldloc', slot);
          il.emit('stloc', slot);
          const unreadable = () => this.unsupported('a by-reference handler argument', expression.syntax);
          this.substitutions.set(expression, byReference ? { value: unreadable, address: load } : { value: load });
          return load;
        };
      const receiver = node.method.isStatic ? null : node.receiver;
      if (receiver && !isReference(receiver.type)) return this.unsupported('a handler argument that is a value receiver', node.syntax);
      if (receiver) saved.set(-1, save(receiver, false));
      for (let index = 0; index < handlerAt; index++) {
        const parameter = parameters[node.mapping?.parameterOf?.[index] ?? index];
        saved.set(index, save(node.args[index].expression, isByReference(parameter?.refKind ?? node.args[index].refKind)));
      }
      const placeholders = handlerOf(node.args[handlerAt].expression).argumentPlaceholders;
      for (const placeholder of placeholders) this.substitutions.set(placeholder, { value: saved.get(placeholder.argumentIndex) });
      try {
        return super.exprCall(node, isUsed);
      } finally {
        if (receiver) this.substitutions.delete(receiver);
        for (let index = 0; index < handlerAt; index++) this.substitutions.delete(node.args[index].expression);
        for (const placeholder of placeholders) this.substitutions.delete(placeholder);
      }
    }
    exprConversion(node) {
      const handler = node.conversion?.kind === ConversionKind.InterpolatedStringHandler ? node.conversion.handler : null;
      if (!handler) return super.exprConversion(node);
      const il = this.il,
        type = node.type,
        slot = this.temp(type),
        flag = handler.enabled ? this.temp(this.core.bool) : null,
        end = il.newLabel(),
        scoped = [handler.placeholder, handler.enabled].filter(Boolean);
      this.substitutions.set(handler.placeholder, { value: () => il.emit('ldloc', slot), address: () => il.emit('ldloca', slot) });
      if (flag !== null) this.substitutions.set(handler.enabled, { value: () => il.emit('ldloc', flag), address: () => il.emit('ldloca', flag) });
      try {
        this.expression(handler.creation);
        il.emit('stloc', slot);
        if (flag !== null) il.emit('ldloc', flag).emit('brfalse', end);
        for (const call of handler.appends) {
          if (!handler.appendsReturnBool) this.effect(call);
          else {
            this.expression(call);
            il.emit('brfalse', end);
          }
        }
      } finally {
        for (const key of scoped) this.substitutions.delete(key);
      }
      il.mark(end);
      return il.emit('ldloc', slot);
    }
  };
