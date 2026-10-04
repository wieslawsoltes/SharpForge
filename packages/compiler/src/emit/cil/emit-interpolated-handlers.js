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

/** Class mixin: interpolated string handler conversions. */
export const InterpolatedHandlerEmission = Base =>
  class extends Base {
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
