import {Op, Binary, Unary, NumericType, numericMode} from '@sharpforge/bytecode';
import {frameworkType, findContracts} from '@sharpforge/framework';
import {numeric, integral, binaryPromotion} from './numeric.js';
import {assignable} from './type-rules.js';

const shifts = new Set(['<<', '>>', '>>>']);
const comparisons = new Set(['==', '!=', '<', '<=', '>', '>=']);
const bitwise = new Set(['&', '|', '^', ...shifts]);

function vectorBinary(compiler, operator, left, right) {
  if (frameworkType(left)?.family !== 'vector' || left !== right) return null;
  const names = {'+': 'Add', '-': 'Subtract', '*': 'Multiply', '/': 'Divide',
    '&': 'BitwiseAnd', '^': 'Xor', '==': 'EqualsAll', '!=': 'EqualsAll'};
  const name = names[operator];
  const contract = name && findContracts('System.Numerics.Vector', name, true).find(item => item.parameters[0] === left);
  if (!contract) return null;
  compiler.emitContract(contract);
  if (operator === '!=') compiler.emit(Op.UNARY, Unary['!']);
  return contract.result;
}

function promoteOperands(compiler, left, right, promoted, operator) {
  const rightType = shifts.has(operator) ? 'int' : promoted;
  if (left !== promoted) {
    const saved = compiler.temp(right);
    compiler.emit(Op.STLOC, saved);
    compiler.emit(Op.POP);
    compiler.emit(Op.CONVERT, NumericType[promoted], numericMode(left, false));
    compiler.emit(Op.LDLOC, saved);
  }
  if (right !== rightType) compiler.emit(Op.CONVERT, NumericType[rightType], numericMode(right, false));
}

/** Bind, promote and lower one binary expression with its declared scalar mode. */
export function compileBinary(compiler, operator, left, right, node) {
  if (operator === '>>>') compiler.c.requireFeature(node, 11, 'Unsigned right shift');
  const vector = vectorBinary(compiler, operator, left, right);
  if (vector !== null) return vector;
  const rightConstant = node?.kind === 'Unary' && ['++', '--'].includes(node.operator) ?
    {type: 'int', value: 1} : compiler.constant(node?.right);
  const promoted = numeric(left) && numeric(right) ?
    binaryPromotion(left, right, operator, compiler.constant(node?.left), rightConstant) : null;
  let result;
  if (operator === '+' && (left === 'string' || right === 'string')) {
    if (numeric(left)) {
      const saved = compiler.temp(right);
      compiler.emit(Op.STLOC, saved);
      compiler.emit(Op.POP);
      compiler.scalarString(left);
      compiler.emit(Op.LDLOC, saved);
    }
    if (numeric(right)) compiler.scalarString(right);
    result = 'string';
  } else if (promoted) {
    if (bitwise.has(operator) && !integral(promoted)) compiler.c.report(node, 'CS0019', 'Bitwise operators require integers');
    result = comparisons.has(operator) ? 'bool' : promoted;
  } else if (operator === '==' || operator === '!=') {
    if (!assignable(left, right) && !assignable(right, left)) {
      compiler.c.report(node, 'CS0019', `Operator '${operator}' cannot compare '${left}' and '${right}'`);
    }
    result = 'bool';
  } else if (['&', '|', '^'].includes(operator) && left === 'bool' && right === 'bool') result = 'bool';
  else {
    compiler.c.report(node, 'CS0019', `Operator '${operator}' cannot be applied to '${left}' and '${right}'`);
    result = 'error';
  }
  if (!(operator in Binary)) {
    compiler.c.report(node, 'SF2006', `Operator '${operator}' is not implemented`);
    compiler.emit(Op.POP);
    return 'error';
  }
  if (promoted) promoteOperands(compiler, left, right, promoted, operator);
  const checked = compiler.overflowChecked(node);
  const mode = promoted ? numericMode(promoted, checked) : result === 'int' ?
    (checked && ['+', '-', '*'].includes(operator) ? 5 : 1) : result === 'string' ? 2 : result === 'bool' && left === 'bool' ? 3 : 0;
  compiler.emit(Op.BINARY, Binary[operator], mode);
  return result;
}
