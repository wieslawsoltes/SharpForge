/**
 * Single evaluation of the operands of a target that is read and written by one expression (`a[i] += x`, `o.P++`,
 * `[i] = { ... }`): the receiver and the index arguments are evaluated into temporaries, and the target is rebuilt
 * over `SpilledOperand` nodes that read those temporaries, so the ordinary read and store lowering can be used on it.
 */
import { n } from '../../codegen/semantic/node-factory.js';

/** Values that cannot change between the evaluation of the operands and the store: they are read in place. */
const stableKinds = new Set(['ThisReference', 'Literal']);

/** Class mixin for the body translator: targets whose operands are evaluated once. */
export const EvaluateOnce = Base =>
  class extends Base {
    /** A bound node standing for an already lowered value; `read()` yields it any number of times. */
    lowered(bound, read) {
      return { kind: 'SpilledOperand', syntax: bound.syntax, type: bound.type, read };
    }
    exprSpilledOperand(node) {
      return node.read();
    }
    /** Evaluates a bound expression into a temporary of `sink` and returns the `Lowered` node that reads it. */
    spill(bound, sink, hint) {
      if (bound.kind === 'SpilledOperand' || bound.kind === 'ImplicitReceiver') return bound;
      const value = this.expression(bound);
      if (stableKinds.has(value.kind)) return this.lowered(bound, () => value);
      // A local is copied too: the right-hand side may change it before the store reads the operand again.
      const temp = this.temp(value.legacyType, hint);
      sink.locals.push(temp);
      sink.effects.push(n.assign(n.local(temp), value));
      return this.lowered(bound, () => n.local(temp));
    }
    /**
     * The target with its operands held in temporaries of `sink` (`{locals, effects}`): the receiver of a field,
     * property or indexer, the array of an element access, and every index argument, in evaluation order.
     */
    spillOperands(target, sink, { receiver = true } = {}) {
      const reference = this.spillReferenceTarget(target, sink);
      if (reference) return reference;
      switch (target.kind) {
        case 'FieldAccess':
        case 'PropertyAccess':
        case 'EventAccess': {
          const member = target.field ?? target.property ?? target.event;
          if (!receiver || !target.receiver || member.isStatic || target.receiver.kind === 'Base') return target;
          return { ...target, receiver: this.spill(target.receiver, sink, 'target') };
        }
        case 'ArrayAccess':
          return {
            ...target,
            array: receiver ? this.spill(target.array, sink, 'array') : target.array,
            indices: target.indices.map(index => this.spill(index, sink, 'index')),
          };
        case 'IndexerAccess':
          return {
            ...target,
            receiver: receiver ? this.spill(target.receiver, sink, 'target') : target.receiver,
            args: target.args.map(argument => ({ ...argument, expression: this.spill(argument.expression, sink, 'index') })),
          };
        default:
          return target;
      }
    }
    /** Stores a lowered value into a bound target; the result is an expression that yields the stored value. */
    storeIntoTarget(target, value) {
      if (target.kind === 'IndexerAccess' && this.g.isSource(target.property)) return this.sourceIndexerStore(target, value);
      return this.assignStatic(target, n.assign(this.target(target), value));
    }
  };
