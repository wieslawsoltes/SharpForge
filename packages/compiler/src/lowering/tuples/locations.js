/**
 * Assignable locations whose parts are evaluated once (SF-A02-T08.4).
 *
 * A tuple object is never changed after creation (lowering/tuples/tuple-classes.js), so `t.Item1 = v` cannot store
 * into the object `t` holds: it stores a new tuple into the variable that holds it. For a nested element
 * (`a.pairs[i].Item2.Item1 = v`) that rebuilds every tuple on the path and stores the outermost one into the first
 * location that is not a tuple element. A location is `{locals, effects, read(), write(value)}`: `effects` evaluate
 * the receivers and indices once, `read()` and `write(value)` then use them any number of times.
 */
import { tupleElementIndex, isWideTuple, maxTupleElements } from '../../binder/tuples.js';
import { n } from '../../codegen/semantic/node-factory.js';

/** True when a bound expression is an element of a tuple (`t.Item1`, `t.name`). */
/** `tuple.Rest` of a tuple of more than seven elements: the tuple of the elements from the eighth on. */
export const isTupleRest = node => node?.kind === 'FieldAccess' && node.field?.name === 'Rest' && isWideTuple(node.receiver?.type);
export const isTupleElement = node => node?.kind === 'FieldAccess' && (tupleElementIndex(node.field) >= 0 || isTupleRest(node));

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
          if (isTupleRest(node)) return this.restLocation(node);
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
      if (node.indices.length !== 1) return this.unsupported('multi-dimensional arrays', node.syntax);
      const array = this.once(this.expression(node.array), 'array'),
        index = this.once(this.expression(node.indices[0]), 'index');
      const slot = () => n.arrayElement(array.read(), index.read());
      return {
        locals: [...array.locals, ...index.locals],
        effects: [...array.effects, ...index.effects],
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
    /** `Rest` of a long tuple held in another location: a read builds it, a store replaces the elements it stands for. */
    restLocation(node) {
      const owner = this.location(node.receiver),
        tuples = this.g.tuples,
        info = tuples.classOf(node.receiver.type, node.syntax),
        rest = tuples.classOf(node.type, node.syntax),
        tuple = () => this.tupleOrDefault(owner.read(), info),
        head = info.fields.slice(0, maxTupleElements),
        tail = info.fields.slice(maxTupleElements);
      const write = value => {
        const stored = this.temp(rest.record.name, 'rest'),
          elements = [...head.map(field => n.field(tuple(), field)), ...rest.fields.map(field => n.field(n.local(stored), field))];
        return n.sequence([stored], [n.assign(n.local(stored), value)], owner.write(tuples.create(info, elements)));
      };
      return { locals: owner.locals, effects: owner.effects, read: () => tuples.create(rest, tail.map(field => n.field(tuple(), field))), write };
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
