import {normalizeCallType} from '@sharpforge/cil';
import {numericTypeName} from '@sharpforge/bytecode';
import {numericPlanTypes} from './numeric-specialization.js';
import {StackCategory} from './numeric-stack-types.js';
import {smallLongNumber, smallLongOperation, smallLongConversion, compareSmallLong} from './int64-fast.js';
import {int32Operation} from './handlers/arith-specialized.js';

const I4 = StackCategory.i4, I8 = StackCategory.i8;
const compares = Object.freeze({eq: order => order === 0, ne: order => order !== 0,
  lt: order => order < 0, le: order => order <= 0, gt: order => order > 0, ge: order => order >= 0});

function slot(method, instruction, state, smallLongs) {
  const match = /^(ld|st)(loc|arg)(?:\.(s|[0-3]))?$/.exec(instruction.name);
  if (!match) return null;
  const [, action, location, suffix] = match, argument = location === 'arg';
  const index = instruction.operand ?? Number(suffix);
  const parameter = index - Number(!method.signature.isStatic);
  const declared = argument ? method.signature.parameters[parameter] : method.locals[index];
  if (typeof declared !== 'string') return null;
  const type = numericTypeName(normalizeCallType(declared));
  const category = ['int', 'uint'].includes(type) ? I4 : smallLongs && ['long', 'ulong'].includes(type) ? I8 : null;
  if (!category || action === 'st' && state.at(-1) !== category) return null;
  return {kind: action === 'ld' ? 'load' : 'store', argument, index, parameter, declared, category};
}

function comparison(instruction, state, offsets) {
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(instruction.name);
  if (!match || state.at(-1) !== state.at(-2)) return null;
  const [, form, compare, unsigned] = match;
  const predicate = compares[compare];
  const calculate = state.at(-1) === I8
    ? (left, right) => predicate(compareSmallLong(left, right, !!unsigned))
    : (left, right) => {
      if (unsigned) { left >>>= 0; right >>>= 0; }
      return predicate(left < right ? -1 : left > right ? 1 : 0);
    };
  return {kind: form === 'c' ? 'compare' : 'branch', calculate, target: offsets.get(instruction.operand)};
}

function operation(method, instruction, state, offsets, smallLongs) {
  const name = instruction.name;
  const local = slot(method, instruction, state, smallLongs);
  if (local) return local;
  if (/^ldc\.i4(?:\.(s|m1|[0-8]))?$/.test(name)) {
    return {kind: 'constant', category: I4, value: instruction.operand ?? (name.endsWith('.m1') ? -1 : Number(name.at(-1)))};
  }
  if (smallLongs && name === 'ldc.i8') {
    const value = smallLongNumber(instruction.operand);
    return value === undefined ? null : {kind: 'constant', category: I8, value};
  }
  if (name === 'br' || name === 'br.s') return {kind: 'jump', target: offsets.get(instruction.operand)};
  if (!state.length) return null;
  if (name === 'pop' || name === 'dup') return {kind: name, category: state.at(-1)};
  if (smallLongs && state.at(-1) === I4) {
    const calculate = smallLongConversion(name);
    if (calculate) return {kind: 'convert', category: I8, calculate};
  }
  if (name === 'neg' || name === 'not') {
    if (state.at(-1) === I8) return name === 'neg' ? {kind: 'unary', category: I8, calculate: value => -value} : null;
    return {kind: 'unary', category: I4, calculate: name === 'neg' ? value => (-value) | 0 : value => ~value};
  }
  if (state.length < 2) return null;
  if (state.at(-1) !== state.at(-2)) return null;
  const category = state.at(-1);
  const calculate = category === I8 ? smallLongOperation(name) : int32Operation(name);
  return calculate ? {kind: 'binary', category, calculate} : comparison(instruction, state, offsets);
}

/** Only verified closed integer stack states contribute; unsupported operations remain ordinary dispatch boundaries. */
export function buildNumericBlockPlan(vm, method, offsets) {
  if (vm.options.specializeNumericHandlers !== true && vm.options.smallLongs !== true || method.handlers.length) return null;
  const states = numericPlanTypes(vm, method, offsets);
  if (!states) return null;
  const smallLongs = vm.options.smallLongs === true;
  return Object.freeze(method.instructions.map((instruction, index) => {
    const state = states[index];
    if (!state || state.some(type => type !== I4 && (type !== I8 || !smallLongs))) return null;
    const selected = operation(method, instruction, state, offsets, smallLongs);
    return selected ? Object.freeze({...selected, name: instruction.name, operand: instruction.operand,
      depth: state.length, inputs: Object.freeze([...state]), instruction}) : null;
  }));
}
