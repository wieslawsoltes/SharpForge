import {bclScalar, fail} from '../host.js';
import {formatBclValue} from './number-format.js';

const owner = 'SharpForge.Runtime.Formatting';
const boxable = new Set(['int', 'double', 'bool', 'sbyte', 'byte', 'short', 'ushort', 'uint',
  'long', 'ulong', 'char', 'float', 'decimal', 'nint', 'nuint']);

/** Register the compiler formatting bridge in its released ABI order. */
export function registerFormatting({define, member}) {
  define(owner, {kind: 'bcl', family: 'format'});
  member(owner, 'BoxValue', ['object', 'string'], 'object', {isStatic: true});
  member(owner, 'FormatValue', ['object', 'string', 'int', 'string'], 'string', {isStatic: true});
}

/** Invoke compiler formatting calls through the injected managed heap and scalar services. */
export function invokeFormatting(platform, descriptor, args) {
  const scalars = args.map(value => bclScalar(platform, value));
  if (descriptor.name === 'BoxValue') {
    if (!boxable.has(scalars[1])) {
      fail(platform, 'InvalidOperationException', 'Unknown primitive box');
    }
    const value = platform.heap.allocate('box', scalars[1], [platform.managed(scalars[0], scalars[1])]);
    return {handled: true, value};
  }
  const value = platform.heap.string(formatBclValue(platform, args[0], scalars[1] ?? '', scalars[2], scalars[3]));
  return {handled: true, value};
}

export const formattingModule = Object.freeze({
  name: 'formatting',
  families: Object.freeze(['format']),
  contracts: registerFormatting,
  invoke: invokeFormatting
});
