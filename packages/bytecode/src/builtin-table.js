import {runtimeBuiltinDefinitions} from './runtime-builtins.js';
import {decimalIntrinsicDefinitions} from './decimal-intrinsic-profile.js';
import {sourceMathBuiltins, sourceSingleMathBuiltins, sourceSignMathBuiltins} from './source-math-builtins.js';

// A closed source-visible subset of the existing CIL profile. Unique wire names
// distinguish overloads; the descriptor retains the actual CLR member identity.
const sourceDecimals = [
  ['Truncate', ['System.Decimal'], ['d']], ['Round', ['System.Decimal'], ['d']],
  ['Round', ['System.Decimal', 'int'], ['d', 'decimals']], ['Parse', ['string'], ['s']],
  ['Ceiling', ['System.Decimal'], ['d']], ['Floor', ['System.Decimal'], ['d']],
  ...['Add', 'Subtract', 'Multiply', 'Divide', 'Remainder'].map(name =>
    [name, ['System.Decimal', 'System.Decimal'], ['d1', 'd2']]),
  ['Compare', ['System.Decimal', 'System.Decimal'], ['d1', 'd2'], 'int'],
  ['Equals', ['System.Decimal', 'System.Decimal'], ['d1', 'd2'], 'bool'],
  ['Negate', ['System.Decimal'], ['d']], ['Abs', ['System.Decimal'], ['value']],
  ['ToSByte', ['System.Decimal'], ['value'], 'sbyte'], ['ToByte', ['System.Decimal'], ['value'], 'byte'],
  ['ToInt16', ['System.Decimal'], ['value'], 'short'], ['ToUInt16', ['System.Decimal'], ['value'], 'ushort'],
  ['ToInt32', ['System.Decimal'], ['d'], 'int'], ['ToUInt32', ['System.Decimal'], ['d'], 'uint'],
  ['ToInt64', ['System.Decimal'], ['d'], 'long'], ['ToUInt64', ['System.Decimal'], ['d'], 'ulong'],
  ['ToSingle', ['System.Decimal'], ['d'], 'float'], ['ToDouble', ['System.Decimal'], ['d'], 'double'],
  ['GetBits', ['System.Decimal'], ['d'], 'int[]'],
  ['Sign', ['System.Decimal'], ['value'], 'int', 'System.Math']
].map(sourceDecimal);

// Appended after the released integral Math entries, not inside sourceDecimals.
const sourceDecimalExtrema = ['Min', 'Max'].map(name => sourceDecimal([
  name, ['System.Decimal', 'System.Decimal'], ['val1', 'val2'], 'System.Decimal', 'System.Math'
]));

const sourceDecimalModes = [
  ['Round', ['System.Decimal', 'System.MidpointRounding'], ['d', 'mode']],
  ['Round', ['System.Decimal', 'int', 'System.MidpointRounding'], ['d', 'decimals', 'mode']]
].map(row => ({...sourceDecimal(row), wireSuffix: ':MidpointRounding'}));

function sourceDecimal([name, parameters, parameterNames, returnType = 'System.Decimal', owner = 'System.Decimal']) {
  const descriptor = decimalIntrinsicDefinitions.find(candidate => candidate.owner === owner &&
    candidate.isStatic && candidate.name === name && candidate.returnType === returnType &&
    candidate.parameters.length === parameters.length && candidate.parameters.every((type, index) => type === parameters[index]));
  if (!descriptor) throw new TypeError('Missing source Decimal contract');
  return {descriptor, parameterNames: Object.freeze(parameterNames)};
}

function decimalBuiltin(id, {descriptor, parameterNames, wireSuffix = ''}) {
  const params = Object.freeze(descriptor.parameters.map(type => type === 'System.Decimal' ? 'decimal' : type));
  const math = descriptor.owner === 'System.Math';
  return Object.freeze({
    id, name: (math ? 'Math.' : 'decimal.') + descriptor.name + '#' + params.length + (math ? ':Decimal' : '') + wireSuffix,
    min: params.length, max: params.length,
    result: descriptor.returnType === 'System.Decimal' ? 'decimal' : descriptor.returnType, params, decimal: descriptor,
    parameterNames
  });
}

/** Build the frozen dispatch table, retaining contract IDs across reserved sparse ranges. */
export function createBuiltinTable(definitions, contracts, releasedRanges) {
  const contractOffset = definitions.length;
  const entries = definitions.map(([name, min, max, result, params], id) =>
    Object.freeze({id, name, min, max, result, params}));
  for (const contract of contracts) {
    const id = contractOffset + contract.id;
    const receiver = !contract.isStatic && contract.kind !== 'constructor' ? [contract.owner] : [];
    const params = Object.freeze([...receiver, ...contract.parameters]);
    entries[id] = Object.freeze({
      id, name: '$framework:' + contract.id, min: params.length, max: params.length,
      result: contract.result, params, contract
    });
  }
  // Runtime opcodes follow the released ranges, not a later extension's sparse ID.
  let runtimeId = contractOffset + releasedRanges.reduce((end, range) => Math.max(end, range.start + range.size), 0);
  for (const [name, min, max, result, params] of runtimeBuiltinDefinitions) {
    const id = runtimeId++;
    entries[id] = Object.freeze({id, name, min, max, result, params: Object.freeze(params)});
  }
  for (const source of sourceDecimals) {
    const id = runtimeId++;
    entries[id] = decimalBuiltin(id, source);
  }
  for (const builtin of sourceMathBuiltins) {
    const id = runtimeId++;
    entries[id] = Object.freeze({...builtin, id});
  }
  for (const source of sourceDecimalExtrema) {
    const id = runtimeId++;
    entries[id] = decimalBuiltin(id, source);
  }
  for (const source of sourceDecimalModes) {
    const id = runtimeId++;
    entries[id] = decimalBuiltin(id, source);
  }
  for (const builtin of sourceSingleMathBuiltins) {
    const id = runtimeId++;
    entries[id] = Object.freeze({...builtin, id});
  }
  for (const builtin of sourceSignMathBuiltins) {
    const id = runtimeId++;
    entries[id] = Object.freeze({...builtin, id});
  }
  return Object.freeze(entries);
}
