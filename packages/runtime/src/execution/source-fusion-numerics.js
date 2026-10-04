import {BinaryName, decodeNumericMode, isNumericMode, uint32Binary} from '@sharpforge/bytecode';
import {compare} from './numeric-ops.js';
import {sourceNumericContext} from './scalar-ops.js';

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
  return Object.freeze({comparison, operation, unsigned});
}

function int32(value) {
  return typeof value === 'number' && (value | 0) === value && !Object.is(value, -0);
}

/** The same numeric primitives own faults, overflow, unsigned ordering and shift masking in both engines. */
export function executeSourceInteger(vm, prepared, left, right) {
  if (!int32(left) || !int32(right)) return sourceIntegerFallback;
  const context = sourceNumericContext(vm);
  return prepared.comparison ? compare(left, right, prepared.comparison, prepared.unsigned, context)
    : uint32Binary(prepared.operation, left, right, context);
}
