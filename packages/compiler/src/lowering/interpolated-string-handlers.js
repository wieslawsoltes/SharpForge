/**
 * Lowering of the interpolated string handler pattern (SF-A02-T75, C# 10). The binder resolved the constructor and
 * every `Append...` call (binder/interpolated-string-handlers.js); here they become, for `Handler h = $"a {x}"`:
 *
 *   $handler = new Handler(2, 1);                         void appends
 *   $handler.AppendLiteral("a "); $handler.AppendFormatted(x);
 *
 *   $handler.AppendLiteral("a ") && $handler.AppendFormatted(x);          appends that return bool stop at false
 *
 *   $handler = new Handler(2, 1, out $enabled);           a constructor with a trailing `out bool`
 *   if ($enabled) { ...appends... }
 *
 * and the value of the conversion is `$handler`. The holes are evaluated inside their append calls, left to right,
 * so a hole after a call that returned false - or all holes when the handler is not enabled - is not evaluated,
 * as in .NET. The handler is a class instance: a handler declared as a struct is refused with the other structs.
 */
import { n } from '../codegen/semantic/node-factory.js';

const handlerConversion = 'InterpolatedStringHandler';

/** Class mixin for the body translator. */
export const InterpolatedStringHandlerLowering = Base =>
  class extends Base {
    exprConversion(node) {
      if (node.conversion?.kind !== handlerConversion) return super.exprConversion(node);
      const pattern = node.conversion.handler;
      if (!pattern) return this.unsupported('an interpolated string handler that did not bind', node.syntax);
      const handler = this.temp(this.imageType(node.type, node.syntax), 'handler'),
        locals = [handler],
        outer = this.handlerPlaceholders;
      this.handlerPlaceholders = new Map([...(outer ?? []), [pattern.placeholder, () => n.local(handler)]]);
      try {
        let enabled = null;
        if (pattern.enabled) {
          // The `out bool` argument is a cell, like every by-reference argument (lowering/by-reference.js).
          const cell = this.g.cellClass('bool'),
            holder = this.temp(cell.record.name, 'enabled');
          locals.push(holder);
          this.handlerPlaceholders.set(pattern.enabled, () => n.local(holder));
          enabled = { allocate: n.assign(n.local(holder), n.allocate(cell.record)), read: () => n.field(n.local(holder), cell.value) };
        }
        const creation = n.assign(n.local(handler), this.expression(pattern.creation)),
          appends = pattern.appends.map(call => this.expression(call)),
          effects = enabled ? [enabled.allocate, creation] : [creation];
        if (pattern.appendsReturnBool || enabled) {
          // One short-circuit chain; a void append counts as true.
          const asCondition = call => (pattern.appendsReturnBool ? call : n.sequence([], [call], n.literal(true, 'bool')));
          const chain = [...(enabled ? [enabled.read()] : []), ...appends.map(asCondition)];
          if (chain.length) effects.push(chain.reduce((left, right) => n.logicalAnd(left, right)));
        } else effects.push(...appends);
        return n.sequence(locals, effects, n.local(handler));
      } finally {
        this.handlerPlaceholders = outer;
      }
    }
    /** The handler being built, where an append call names its receiver. */
    exprInterpolatedStringHandlerPlaceholder(node) {
      const read = this.handlerPlaceholders?.get(node);
      return read ? read() : this.unsupported('an interpolated string handler outside its conversion', node.syntax);
    }
    /** The cell of the constructor's `out bool` argument. */
    cellArgument(argument, parameter) {
      const read = argument.expression?.isEnabledFlag ? this.handlerPlaceholders?.get(argument.expression) : null;
      return read ? read() : super.cellArgument(argument, parameter);
    }
  };
