/**
 * Lowering of indices and ranges (SF-A02-T67) onto what the IR already has: int arithmetic, element and indexer
 * accesses, calls and `Array.Copy`.
 *
 *   a[^n]        ->  $a = a; $n = n; $a[$a.Length - $n]                      (also as an assignment target)
 *   a[x..y]      ->  $a = a; $s = x; $e = y; $r = new T[$e - $s]; Array.Copy($a, $s, $r, 0, $e - $s); $r
 *   s[x..^y]     ->  $s = s; $x = x; $y = y; $s.Substring($x, ($s.Length - $y) - $x)
 *   c[^n]        ->  $c = c; $n = n; $c[$c.Length - $n]                      (`Length` or `Count` plus an int indexer)
 *   c[x..y]      ->  $c = c; $x = x; $y = y; $c.Slice($x, $y - $x)
 *
 * The receiver is evaluated once, then the operands of the index or range in source order, then the length - and
 * the length only when an operand counts from the end or the range has no end, as .NET does. A range that does not
 * fit is rejected by the member that takes it: `Array.Copy` and `Substring` throw ArgumentOutOfRangeException, an
 * element access throws IndexOutOfRangeException.
 *
 * The runtime has no `System.Index` or `System.Range`: an Index or Range that is stored, passed or returned as a
 * value (`Index i = ^1;`, a `this[Index]` indexer) is reported as not executable, never miscompiled.
 */
import { findContracts } from '@sharpforge/framework';
import { n } from '../codegen/semantic/node-factory.js';
import { substitute } from './members/operators.js';

const indexValues = 'System.Index values (the runtime has no Index type)';
const rangeValues = 'System.Range values (the runtime has no Range type)';

/** The operand of an implicit conversion to `Index` (`int` counts from the start), or null. */
function fromStartOperand(node) {
  return node.kind === 'Conversion' && node.conversion?.isUserDefined ? node.operand : null;
}

/** `Array.Copy(source, sourceIndex, destination, destinationIndex, length)` for an image array type, or null. */
function arrayCopyContract(arrayType) {
  const wanted = [arrayType, 'int', arrayType, 'int', 'int'];
  return findContracts('System.Array', 'Copy', true).find(c => c.parameters.length === 5 && c.parameters.every((p, i) => p === wanted[i])) ?? null;
}
/** Arrays of the value types the runtime has; every other array holds references and is copied as `object[]`. */
const valueArrays = new Set(['int[]', 'double[]', 'bool[]']);

/** Class mixin for the body translator: implicit Index and Range accesses. */
export const IndexRangeLowering = Base =>
  class extends Base {
    exprPlaceholder(node) {
      const read = this.placeholders?.get(node);
      return read ? read() : this.unsupported('a placeholder outside its access', node.syntax);
    }
    exprFromEndIndex(node) {
      return this.unsupported(indexValues, node.syntax);
    }
    exprRange(node) {
      return this.unsupported(rangeValues, node.syntax);
    }
    exprImplicitIndexerAccess(node) {
      const sink = { locals: [], effects: [] },
        access = this.implicitAccess(node, sink);
      return n.sequence(sink.locals, sink.effects, this.expression(access));
    }
    exprAssignment(node) {
      return this.throughImplicitAccess(node, 'left', rewritten => super.exprAssignment(rewritten));
    }
    exprCompoundAssignment(node) {
      return this.throughImplicitAccess(node, 'left', rewritten => super.exprCompoundAssignment(rewritten));
    }
    exprIncrement(node) {
      return this.throughImplicitAccess(node, 'operand', rewritten => super.exprIncrement(rewritten));
    }
    /** Lowers a store whose target is `receiver[^n]` as the store into the element or indexer it stands for. */
    throughImplicitAccess(node, field, lower) {
      if (node[field].kind !== 'ImplicitIndexerAccess') return lower(node);
      const sink = { locals: [], effects: [] },
        original = node[field],
        target = this.implicitAccess(original, sink),
        rewritten = { ...node, [field]: target };
      // The operator of a compound assignment was bound over the same target: it reads the rewritten one.
      if (node.operation) rewritten.operation = { ...node.operation, left: substitute(node.operation.left, original, target) };
      return n.sequence(sink.locals, sink.effects, lower(rewritten));
    }
    /**
     * Evaluates the receiver and the operands into temporaries of `sink` and returns the bound access that reads
     * them: the int-indexed access or the `Slice` call the binder prepared, or the lowered copy of an array slice.
     */
    implicitAccess(node, sink) {
      const receiver = this.spill(node.receiver, sink, 'target'),
        read = bound => () => this.expression(bound),
        argument = node.args[0].expression;
      this.placeholders ??= new Map();
      this.placeholders.set(node.receiverPlaceholder, read(receiver));
      let length = null;
      const lengthOnce = () => (length ??= this.spill(node.length, sink, 'length'));
      /** The offset from the start that one side of the argument denotes, as a function that reads it. */
      const offset = (side, whenOmitted) => {
        if (!side) return whenOmitted;
        const fromStart = fromStartOperand(side);
        if (fromStart) return read(this.spill(fromStart, sink, 'index'));
        if (side.kind !== 'FromEndIndex') return this.unsupported(indexValues, side.syntax);
        const operand = this.spill(side.operand, sink, 'index');
        return () => n.binary('-', this.expression(lengthOnce()), this.expression(operand), 'int');
      };
      if (node.accessKind === 'index') {
        const position = offset(argument, null);
        this.placeholders.set(node.offsetPlaceholders[0], position);
        // The length is read after the operand and before the access uses it.
        if (argument.kind === 'FromEndIndex') lengthOnce();
        return node.access;
      }
      if (argument.kind !== 'Range') return this.unsupported(rangeValues, argument.syntax);
      const start = offset(argument.left, () => n.literal(0, 'int'));
      const end = offset(argument.right, () => this.expression(lengthOnce()));
      if (!argument.right || argument.left?.kind === 'FromEndIndex' || argument.right.kind === 'FromEndIndex') lengthOnce();
      const count = () => n.binary('-', end(), start(), 'int');
      if (!node.access) return this.arraySlice(node, read(receiver), start, count, sink);
      this.placeholders.set(node.offsetPlaceholders[0], start);
      this.placeholders.set(node.offsetPlaceholders[1], count);
      return node.access;
    }
    /** A new array holding `count` elements of the receiver from `start` (RuntimeHelpers.GetSubArray). */
    arraySlice(node, array, start, count, sink) {
      const type = this.imageType(node.type, node.syntax),
        copy = arrayCopyContract(type) ?? (valueArrays.has(type) ? null : arrayCopyContract('object[]'));
      if (!copy) return this.unsupported(`a range of '${node.type.toDisplayString()}' (Array.Copy is not registered for this element type)`, node.syntax);
      const length = this.temp('int', 'count'),
        result = this.temp(type, 'slice');
      sink.locals.push(length, result);
      // A negative count must reach Array.Copy, which rejects the range; the array is then created empty.
      const size = n.conditional(n.binary('<', n.local(length), n.literal(0, 'int'), 'bool'), n.literal(0, 'int'), n.local(length), 'int');
      sink.effects.push(
        n.assign(n.local(length), count()),
        n.assign(n.local(result), n.newArray(type.slice(0, -2), size)),
        n.frameworkCall({ contract: copy }, null, [array(), start(), n.local(result), n.literal(0, 'int'), n.local(length)], 'void'),
      );
      return this.lowered(node, () => n.local(result));
    }
  };
