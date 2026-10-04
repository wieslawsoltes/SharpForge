/**
 * Storage locations as the CIL emitter reads and writes them (SF-A02-T30): a local or argument, a field, an array
 * element, a property or an indexer. Every location answers the same protocol, so assignment, compound assignment
 * and increment are written once:
 *
 *   load()                        pushes the value
 *   beginStore() value endStore() stores the value that was pushed in between
 *   address()                     pushes a managed pointer to the location (variables only)
 *   capture()                     evaluates the operands (receiver, index) into temporaries now, once; needed before
 *                                 a location is both read and written
 */
import { isReference, primitiveOf } from './type-facts.js';

/** Bound nodes that can be evaluated again without repeating a side effect. */
const repeatable = new Set(['Local', 'Parameter', 'This', 'Base']);

/** An operand that is evaluated once and pushed any number of times. */
class Operand {
  /** @param {() => void} push emits the operand  @param type its type  @param {boolean} isAddress it is a managed pointer */
  constructor(emitter, push, type, { isAddress = false, isRepeatable = false } = {}) {
    this.emitter = emitter;
    this.emit = push;
    this.type = type;
    this.isAddress = isAddress;
    this.isRepeatable = isRepeatable;
    this.slot = null;
  }
  capture() {
    if (this.isRepeatable || this.slot !== null) return;
    this.emit();
    this.slot = this.emitter.temp(this.type, { isByReference: this.isAddress });
    this.emitter.il.emit('stloc', this.slot);
  }
  push() {
    if (this.slot === null) this.emit();
    else this.emitter.il.emit('ldloc', this.slot);
  }
}

/** A local variable or an argument; `isByReference` when the slot holds a managed pointer to the variable. */
export class VariableLocation {
  constructor(emitter, { type, isArgument, index, isByReference }) {
    this.emitter = emitter;
    this.type = type;
    this.loadOp = isArgument ? 'ldarg' : 'ldloc';
    this.storeOp = isArgument ? 'starg' : 'stloc';
    this.addressOp = isArgument ? 'ldarga' : 'ldloca';
    this.index = index;
    this.isByReference = isByReference;
  }
  capture() {}
  load() {
    this.emitter.il.emit(this.loadOp, this.index);
    if (this.isByReference) this.emitter.loadIndirect(this.type);
  }
  beginStore() {
    if (this.isByReference) this.emitter.il.emit(this.loadOp, this.index);
  }
  endStore() {
    if (this.isByReference) this.emitter.storeIndirect(this.type);
    else this.emitter.il.emit(this.storeOp, this.index);
  }
  address() {
    this.emitter.il.emit(this.isByReference ? this.loadOp : this.addressOp, this.index);
  }
}

export class FieldLocation {
  /**
   * @param {{token: number, isStatic: boolean}} field the Field or MemberRef token and whether the field is static
   * @param receiver the bound receiver, or null for a static field
   */
  constructor(emitter, field, receiver, type) {
    this.emitter = emitter;
    this.type = type;
    this.token = field.token;
    this.receiver = field.isStatic ? null : receiverOperand(emitter, receiver);
  }
  capture() {
    this.receiver?.capture();
  }
  load() {
    this.receiver?.push();
    this.emitter.il.emit(this.receiver ? 'ldfld' : 'ldsfld', this.token);
  }
  beginStore() {
    this.receiver?.push();
  }
  endStore() {
    this.emitter.il.emit(this.receiver ? 'stfld' : 'stsfld', this.token);
  }
  address() {
    this.receiver?.push();
    this.emitter.il.emit(this.receiver ? 'ldflda' : 'ldsflda', this.token);
  }
}

/** A captured variable: the `Value` field of its heap cell (emit-closures.js). */
export class CellLocation {
  /** @param {() => void} pushCell pushes the cell object  @param {number} token the token of its `Value` field */
  constructor(emitter, pushCell, token, type) {
    this.emitter = emitter;
    this.pushCell = pushCell;
    this.token = token;
    this.type = type;
  }
  capture() {}
  load() {
    this.pushCell();
    this.emitter.il.emit('ldfld', this.token);
  }
  beginStore() {
    this.pushCell();
  }
  endStore() {
    this.emitter.il.emit('stfld', this.token);
  }
  address() {
    this.pushCell();
    this.emitter.il.emit('ldflda', this.token);
  }
}

export class ElementLocation {
  /** @param array, index bound nodes of a one-dimensional array access */
  constructor(emitter, array, index, type) {
    this.emitter = emitter;
    this.type = type;
    this.array = valueOperand(emitter, array);
    this.indexOperand = valueOperand(emitter, index);
  }
  capture() {
    this.array.capture();
    this.indexOperand.capture();
  }
  pushOperands() {
    this.array.push();
    this.indexOperand.push();
  }
  load() {
    this.pushOperands();
    this.emitter.loadElement(this.type);
  }
  beginStore() {
    this.pushOperands();
  }
  endStore() {
    this.emitter.storeElement(this.type);
  }
  address() {
    this.pushOperands();
    this.emitter.il.emit('ldelema', this.emitter.tokens.type(this.type));
  }
}

/** A property or an indexer: reads call the get accessor, writes the set accessor. */
export class PropertyLocation {
  /** @param {{property, receiver, args: (() => void)[], argumentTypes: object[]}} access `args` push the index arguments */
  constructor(emitter, access, type) {
    this.emitter = emitter;
    this.type = type;
    this.property = access.property;
    this.receiverNode = access.receiver;
    /** The type parameter a static abstract property is read on (`T.Zero`), or null. */
    this.constrainedTo = access.constrainedTo ?? null;
    this.receiver = access.property.isStatic || !access.receiver ? null : receiverOperand(emitter, access.receiver);
    this.args = access.args.map((push, index) => new Operand(emitter, push, access.argumentTypes[index]));
  }
  capture() {
    this.receiver?.capture();
    for (const argument of this.args) argument.capture();
  }
  pushOperands() {
    this.receiver?.push();
    for (const argument of this.args) argument.push();
  }
  load() {
    this.pushOperands();
    this.emitter.callAccessor(this.property.getMethod, this.receiverNode, this.constrainedTo);
  }
  beginStore() {
    this.pushOperands();
  }
  endStore() {
    this.emitter.callAccessor(this.property.setMethod, this.receiverNode, this.constrainedTo);
  }
  address() {
    this.emitter.unsupported('the address of a property');
  }
}

function valueOperand(emitter, node) {
  return new Operand(emitter, () => emitter.expression(node), node.type, { isRepeatable: repeatable.has(node.kind) || !!node.constantValue });
}

/** The receiver of an instance member: an object reference, or a managed pointer to a value-type variable. */
function receiverOperand(emitter, node) {
  const isAddress = !isReference(node.type) || !!primitiveOf(node.type);
  return new Operand(emitter, () => emitter.receiver(node), node.type, { isAddress, isRepeatable: repeatable.has(node.kind) });
}
