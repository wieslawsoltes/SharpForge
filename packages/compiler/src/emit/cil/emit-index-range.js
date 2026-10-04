/**
 * Index and range access (SF-A02-T30): `a[^1]`, `text[^2]`, `text[1..^1]`.
 *
 * The binder states the lowering as a template: `receiverPlaceholder` stands for the receiver evaluated once,
 * `offsetPlaceholders` for the computed offsets (the index; or the start and the length of a range), `length` reads
 * the receiver's length and `access` is the element access or the slicing call over the placeholders. An index from
 * the end is `length - value`.
 */

/** The `int` an `Index`-typed operand is made from, when it is `^value` or an `int` converted implicitly; else null. */
function indexOperand(node) {
  if (!node) return null;
  if (node.kind === 'FromEndIndex') return { fromEnd: true, value: node.operand };
  if (node.kind === 'Conversion' && node.operand?.type?.specialType === 'System_Int32') return { fromEnd: false, value: node.operand };
  if (node.type?.specialType === 'System_Int32') return { fromEnd: false, value: node };
  return null;
}

/** Class mixin: index and range access. */
export const IndexRangeEmission = Base =>
  class extends Base {
    exprImplicitIndexerAccess(node) {
      this.expression(this.indexedAccess(node));
    }
    location(node) {
      return node.kind === 'ImplicitIndexerAccess' ? super.location(this.indexedAccess(node)) : super.location(node);
    }
    /**
     * Evaluates the receiver and the offsets into temporaries, binds the placeholders to them and returns the
     * `access` node, which can then be read or assigned like any element access or call.
     */
    indexedAccess(node) {
      const il = this.il,
        argument = node.args?.[0]?.expression,
        receiver = this.temp(node.receiver.type),
        bind = (placeholder, slot) => this.substitutions.set(placeholder, { value: () => il.emit('ldloc', slot) });
      if (!node.access) return this.unsupported('a range over this type (no slicing member)', node.syntax);
      this.expression(node.receiver);
      il.emit('stloc', receiver);
      bind(node.receiverPlaceholder, receiver);
      const offsets = node.offsetPlaceholders.map(placeholder => {
        const slot = this.temp(this.core.int);
        bind(placeholder, slot);
        return slot;
      });
      if (node.accessKind === 'index') {
        this.offset(indexOperand(argument), node, () => this.unsupported('an index that is not a constant form', node.syntax));
        il.emit('stloc', offsets[0]);
      } else if (node.accessKind === 'range' && argument?.kind === 'Range') {
        // The start (0 when omitted), then the length: the end (the receiver's length when omitted) minus the start.
        this.offset(argument.left ? indexOperand(argument.left) : null, node, () => il.emit('ldc.i4', 0), !argument.left);
        il.emit('stloc', offsets[0]);
        this.offset(argument.right ? indexOperand(argument.right) : null, node, () => this.expression(node.length), !argument.right);
        il.emit('ldloc', offsets[0]).emit('sub').emit('stloc', offsets[1]);
      } else return this.unsupported('this index or range form', node.syntax);
      return node.access;
    }
    /** Pushes one offset: `value`, or `length - value` from the end; `whenAbsent` when the bound is omitted. */
    offset(operand, node, whenAbsent, isOmitted = false) {
      if (!operand) {
        if (!isOmitted && node.accessKind === 'range') return this.unsupported('a range bound that is not a constant form', node.syntax);
        return whenAbsent();
      }
      if (!operand.fromEnd) return this.expression(operand.value);
      this.expression(node.length);
      this.expression(operand.value);
      return this.il.emit('sub');
    }
  };
