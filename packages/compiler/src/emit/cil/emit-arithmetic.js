/**
 * Arithmetic (SF-A02-T30): predefined unary and binary operators over the integer widths, `char`, `bool`, enums and
 * the floating-point types, with their checked variants, and calls of user-defined operators.
 *
 * The instruction is chosen from the operand type, as ECMA-335 III.1.5 tabulates it: unsigned operands take the
 * `.un` forms of division, remainder, shift and comparison, and a checked context takes the `.ovf` forms.
 */
import { primitiveOf, isReference } from './type-facts.js';

const plain = Object.freeze({ '+': 'add', '-': 'sub', '*': 'mul', '&': 'and', '|': 'or', '^': 'xor' });
const overflowChecked = new Set(['+', '-', '*']);
const signSensitive = Object.freeze({ '/': 'div', '%': 'rem', '>>': 'shr' });
const INT_FACTS = Object.freeze({ stack: 'i4', bits: 32, isSigned: true, suffix: 'i4', store: 'i4' });

/** Class mixin: operators. */
export const ArithmeticEmission = Base =>
  class extends Base {
    exprUnary(node) {
      if (node.method) return this.operatorCall(node.method, [node.operand], node);
      if (node.isLifted) return this.liftedUnary(node);
      const facts = primitiveOf(node.operand.type),
        il = this.il;
      if (!facts) return this.unsupported(`'${node.operator}' on '${node.operand.type?.toDisplayString()}'`, node.syntax);
      if (node.operator === '-' && node.isChecked && !facts.isFloat) {
        // Checked negation is `0 - x`: `neg` does not trap on the minimum value.
        this.defaultValue(node.operand.type);
        this.expression(node.operand);
        return il.emit('sub.ovf');
      }
      this.expression(node.operand);
      if (node.operator === '-') il.emit('neg');
      else if (node.operator === '!') il.emit('ldc.i4', 0).emit('ceq');
      else if (node.operator === '~') {
        il.emit('not');
        this.truncate(primitiveOf(node.type));
      } else if (node.operator !== '+') return this.unsupported(`the unary operator '${node.operator}'`, node.syntax);
      return undefined;
    }
    /** Narrows an int32 result to a smaller storage type (`~` and `++` on `byte`, `short`, `char` or a small enum). */
    truncate(facts) {
      if (facts && facts.stack === 'i4' && facts.bits < 32) this.il.emit('conv.' + facts.suffix);
    }
    exprBinary(node) {
      const operator = node.operator;
      if (node.method) {
        if (node.isLogical) return this.unsupported('user-defined conditional logical operators', node.syntax);
        if (node.isLifted) return this.liftedBinary(node);
        return this.operatorCall(node.method, [node.left, node.right], node);
      }
      if (operator === '&&' || operator === '||') return this.shortCircuit(node);
      if (node.family === 'string') return this.stringOperator(node);
      if (node.family === 'delegate') return this.delegateOperator(node);
      if (node.isLifted) return this.liftedBinary(node);
      if (node.family === 'tuple' || node.family === 'pointer' || node.family === 'dynamic')
        return this.unsupported(`${node.family} operators`, node.syntax);
      this.expression(node.left);
      if (signSensitive[operator] === 'shr' || operator === '<<' || operator === '>>>') this.shiftCount(node);
      else this.expression(node.right);
      return this.binaryInstruction(node);
    }
    /** The shift count: C# uses its low five (or six) bits, the CLI leaves a larger count undefined. */
    shiftCount(node) {
      const mask = (primitiveOf(node.left.type) ?? INT_FACTS).bits === 64 ? 63 : 31,
        count = node.right.constantValue;
      if (count) return this.il.emit('ldc.i4', Number(count.value) & mask);
      this.expression(node.right);
      return this.il.emit('ldc.i4', mask).emit('and');
    }
    /** The instruction (or pair) for a predefined binary operator whose operands are on the stack. */
    binaryInstruction(node) {
      const operator = node.operator,
        il = this.il,
        operandType = node.left.type ?? node.right.type,
        facts = primitiveOf(operandType);
      if (!facts) {
        // Reference equality: objects, `null`, type parameters known to be references.
        if ((operator === '==' || operator === '!=') && (!operandType || isReference(operandType))) return this.equality(operator);
        return this.unsupported(`'${operator}' on '${operandType?.toDisplayString()}'`, node.syntax);
      }
      const unsigned = !facts.isSigned && !facts.isFloat ? '.un' : '';
      if (plain[operator]) {
        const checked = node.isChecked && overflowChecked.has(operator) && !facts.isFloat;
        return il.emit(plain[operator] + (checked ? '.ovf' + unsigned : ''));
      }
      if (signSensitive[operator]) return il.emit(signSensitive[operator] + unsigned);
      if (operator === '<<') return il.emit('shl');
      if (operator === '>>>') return il.emit('shr.un');
      if (operator === '==' || operator === '!=') return this.equality(operator);
      // An unordered floating-point comparison is false: `<=` is "not greater, ordered", so the negated test is unordered.
      const negatedUnsigned = facts.isFloat ? '.un' : unsigned;
      if (operator === '<') return il.emit('clt' + unsigned);
      if (operator === '>') return il.emit('cgt' + unsigned);
      if (operator === '<=') return il.emit('cgt' + negatedUnsigned).emit('ldc.i4', 0).emit('ceq');
      if (operator === '>=') return il.emit('clt' + negatedUnsigned).emit('ldc.i4', 0).emit('ceq');
      return this.unsupported(`the operator '${operator}'`, node.syntax);
    }
    equality(operator) {
      this.il.emit('ceq');
      if (operator === '!=') this.il.emit('ldc.i4', 0).emit('ceq');
    }
    /** `a && b` and `a || b`: the right operand is evaluated only when the left one does not decide the result. */
    shortCircuit(node) {
      const il = this.il,
        decided = il.newLabel(),
        end = il.newLabel(),
        isAnd = node.operator === '&&';
      this.expression(node.left);
      il.emit(isAnd ? 'brfalse' : 'brtrue', decided);
      this.expression(node.right);
      il.emit('br', end);
      il.mark(decided);
      il.emit('ldc.i4', isAnd ? 0 : 1);
      il.mark(end);
    }
    /** A user-defined operator or conversion is a static call. */
    operatorCall(method, operands, node) {
      for (const operand of operands) this.expression(operand);
      this.callMethod(method, { isStatic: true, syntax: node.syntax });
    }
    liftedUnary(node) {
      return this.unsupported('lifted operators on nullable value types', node.syntax);
    }
    liftedBinary(node) {
      return this.unsupported('lifted operators on nullable value types', node.syntax);
    }
    delegateOperator(node) {
      return this.unsupported('delegate combination', node.syntax);
    }
  };
