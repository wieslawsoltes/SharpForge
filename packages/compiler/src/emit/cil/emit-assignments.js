/**
 * Assignment (SF-A02-T30): simple assignment, compound assignment and increment/decrement over every location kind
 * (locations.js). The operands of the target are evaluated once; the value of the expression is produced only when
 * it is used.
 */
import { primitiveOf } from './type-facts.js';

/** Class mixin: assignments. */
export const AssignmentEmission = Base =>
  class extends Base {
    exprAssignment(node, isUsed) {
      if (node.left.kind === 'Discard') {
        this.expression(node.right);
        return undefined;
      }
      const outer = this.assignmentTarget;
      this.assignmentTarget = node.left;
      let location;
      try {
        location = this.location(node.left);
      } finally {
        this.assignmentTarget = outer;
      }
      location.beginStore();
      this.expression(node.right);
      return this.finishStore(location, isUsed);
    }
    /** Stores the value on the stack; when the expression's value is used, a copy of it stays on the stack. */
    finishStore(location, isUsed) {
      if (!isUsed) {
        location.endStore();
        return false;
      }
      const copy = this.temp(location.type);
      this.il.emit('dup').emit('stloc', copy);
      location.endStore();
      this.il.emit('ldloc', copy);
      return undefined;
    }
    /** `x op= y` is `x = (T)(x op y)` with the operands of `x` evaluated once. */
    exprCompoundAssignment(node, isUsed) {
      const location = this.location(node.left);
      location.capture();
      location.beginStore();
      this.substitutions.set(node.left, { value: () => location.load() });
      try {
        this.expression(node.operation);
      } finally {
        this.substitutions.delete(node.left);
      }
      this.narrowResult(node.operation.type, node.left.type, node);
      return this.finishStore(location, isUsed);
    }
    /** The conversion back to the target's type: `byte b += 1` computes in `int` and stores a `byte`. */
    narrowResult(from, to, node) {
      if (!from || !to || from.equals(to)) return;
      if (primitiveOf(from) && primitiveOf(to)) this.numericConversion(from, to, { isChecked: !!node.isChecked, syntax: node.syntax });
    }
    exprIncrement(node, isUsed) {
      const il = this.il,
        location = this.location(node.operand),
        type = node.operand.type,
        keepsOld = isUsed && node.isPostfix,
        result = isUsed ? this.temp(type) : null;
      location.capture();
      location.beginStore();
      location.load();
      if (keepsOld) il.emit('dup').emit('stloc', result);
      if (node.method) this.callMethod(node.method, { syntax: node.syntax });
      else this.addOne(node, type);
      if (isUsed && !node.isPostfix) il.emit('dup').emit('stloc', result);
      location.endStore();
      if (isUsed) il.emit('ldloc', result);
      return isUsed ? undefined : false;
    }
    /** Adds or subtracts one in the operand's own type. */
    addOne(node, type) {
      const il = this.il,
        facts = primitiveOf(type);
      if (!facts) return this.unsupported(`'${node.operator}' on '${type?.toDisplayString()}'`, node.syntax);
      if (facts.stack === 'i8') il.emit('ldc.i8', 1n);
      else if (facts.isFloat) il.emit(facts.bits === 32 ? 'ldc.r4' : 'ldc.r8', 1);
      else il.emit('ldc.i4', 1);
      const instruction = node.operator === '++' ? 'add' : 'sub',
        checked = node.isChecked && !facts.isFloat ? '.ovf' + (facts.isSigned ? '' : '.un') : '';
      il.emit(instruction + checked);
      // The sum of a narrow operand is an int32; a checked context traps when it leaves the operand's range.
      if (facts.stack === 'i4' && facts.bits < 32) il.emit((node.isChecked ? 'conv.ovf.' : 'conv.') + facts.suffix);
      return undefined;
    }
  };
