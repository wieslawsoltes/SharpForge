/**
 * Assignable locations whose parts are evaluated once (SF-A02-T08.4).
 *
 * A tuple object is never changed after creation (lowering/tuples/tuple-classes.js), so `t.Item1 = v` cannot store
 * into the object `t` holds: it stores a new tuple into the variable that holds it. For a nested element
 * (`a.pairs[i].Item2.Item1 = v`) that rebuilds every tuple on the path and stores the outermost one into the first
 * location that is not a tuple element. A location is `{locals, effects, read(), write(value)}`: `effects` evaluate
 * the receivers and indices once, `read()` and `write(value)` then use them any number of times.
 */
import { tupleElementIndex } from '../../binder/tuples.js';
import { n } from '../../codegen/semantic/node-factory.js';

/** True when a bound expression is an element of a tuple (`t.Item1`, `t.name`). */
export const isTupleElement = node => node?.kind === 'FieldAccess' && tupleElementIndex(node.field) >= 0;

/** Class mixin: locations. */
export const Locations = Base =>
  class extends Base {
    /** The location a bound expression denotes; anything that is not a variable is reported as not executable. */
    location(node) {
      switch (node.kind) {
        case 'Local':
        case 'Parameter':
          return {
            locals: [],
            effects: [],
            read: () => this.expression(node),
            write: value => n.assign(this.expression(node), value),
          };
        case 'FieldAccess':
          return isTupleElement(node) ? this.elementLocation(node) : this.fieldLocation(node);
        case 'ArrayAccess':
          return this.arrayElementLocation(node);
        default:
          return this.unsupported('a store into an element of a tuple that is not held in a variable', node.syntax);
      }
    }
    fieldLocation(node) {
      const record = this.g.fieldOf(node.field, node.syntax);
      if (record.isStatic) {
        const slot = () => this.assignStatic(node, n.staticField(record));
        return { locals: [], effects: [], read: slot, write: value => n.assign(slot(), value) };
      }
      const receiver = this.once(this.memberReceiver(node), 'target');
      const slot = () => n.field(receiver.read(), record);
      return { locals: receiver.locals, effects: receiver.effects, read: slot, write: value => n.assign(slot(), value) };
    }
    arrayElementLocation(node) {
      const lowered = this.target(node);
      const rectangular = lowered.kind === 'IndexerAccess' && lowered.indexer?.memory?.kind === 'rect';
      const array = this.once(rectangular ? lowered.receiver : lowered.expression, 'array');
      const indices = (rectangular ? lowered.args : [lowered.index]).map(value => this.once(value, 'index'));
      const slot = () => rectangular ? {...lowered, receiver: array.read(), args: indices.map(index => index.read())} :
        n.arrayElement(array.read(), indices[0].read());
      return {
        locals: [...array.locals, ...indices.flatMap(index => index.locals)],
        effects: [...array.effects, ...indices.flatMap(index => index.effects)],
        read: slot,
        write: value => n.assign(slot(), value),
      };
    }
    /** An element of a tuple held in another location: a store replaces the whole tuple there. */
    elementLocation(node) {
      const owner = this.location(node.receiver),
        tuples = this.g.tuples,
        info = tuples.classOf(node.receiver.type, node.syntax),
        index = tupleElementIndex(node.field),
        tuple = () => this.tupleOrDefault(owner.read(), info);
      return {
        locals: owner.locals,
        effects: owner.effects,
        read: () => n.field(tuple(), info.fields[index]),
        write: value => owner.write(tuples.withElement(info, tuple, index, value)),
      };
    }
    /** `location = value` as an expression whose value is the stored value. */
    storeInto(location, value) {
      const stored = this.temp(value.legacyType, 'value');
      return n.sequence(
        [...location.locals, stored],
        [...location.effects, n.assign(n.local(stored), value), location.write(n.local(stored))],
        n.local(stored),
      );
    }
  };
