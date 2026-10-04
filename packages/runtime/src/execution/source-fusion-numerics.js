import {BinaryName, decodeNumericMode, isNumericMode} from '@sharpforge/bytecode';
import {int32Comparison, int32Operation} from './handlers/arith-specialized.js';

export const sourceIntegerFallback = Symbol('source integer fallback');

const operations = Object.freeze({
  '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'rem', '&': 'and', '|': 'or',
  '^': 'xor', '<<': 'shl', '>>': 'shr', '>>>': 'shr.un'
});
const comparisons = Object.freeze({'==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge'});

/** Cache only normalization-free i4 operations; carriers and other modes retain their ordinary evaluator. */
export function prepareSourceInteger(operator, mode) {
  let unsigned = false;
  if (isNumericMode(mode)) {
    const type = decodeNumericMode(mode);
    if (type.checked || type.type !== 'int' && type.type !== 'uint') return null;
    unsigned = type.type === 'uint';
  } else if (mode !== 1 || BinaryName[operator] === '>>>') return null;
  const name = BinaryName[operator];
  const comparison = comparisons[name];
  let operation = operations[name];
  if (!comparison && !operation) return null;
  if (unsigned && (name === '/' || name === '%' || name === '>>')) operation += '.un';
  const execute = comparison ? int32Comparison(comparison, unsigned) : int32Operation(operation);
  return execute ? Object.freeze({execute}) : null;
}

function int32(value) {
  return typeof value === 'number' && (value | 0) === value && !Object.is(value, -0);
}

/** Canonical operands share the CIL Int32 primitives without decoding their opcode again at execution time. */
export function executeSourceInteger(vm, prepared, left, right) {
  if (!int32(left) || !int32(right)) return sourceIntegerFallback;
  return prepared.execute(left, right);
}
