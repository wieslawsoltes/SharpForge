/** Closed cooperative synchronization contracts. No runtime dependency. */
const definitions = [];
const define = (owner, name, parameters, returnType, genericArity = 0) => definitions.push(Object.freeze({
  owner,
  name,
  parameters: Object.freeze(parameters),
  returnType,
  isStatic: true,
  genericArity,
  implementation: 'synchronization'
}));
const monitor = 'System.Threading.Monitor',
  atomic = 'System.Threading.Interlocked',
  volatile = 'System.Threading.Volatile';
define(monitor, 'Enter', ['object'], 'void');
define(monitor, 'Enter', ['object', 'bool&'], 'void');
define(monitor, 'Exit', ['object'], 'void');
define(monitor, 'IsEntered', ['object'], 'bool');
for (const parameters of [
    ['object'],
    ['object', 'int']
  ]) define(monitor, 'TryEnter', parameters, 'bool');
for (const parameters of [
    ['object', 'bool&'],
    ['object', 'int', 'bool&']
  ]) define(monitor, 'TryEnter', parameters, 'void');
for (const parameters of [
    ['object'],
    ['object', 'int'],
    ['object', 'int', 'bool']
  ]) define(monitor, 'Wait', parameters, 'bool');
for (const name of ['Pulse', 'PulseAll']) define(monitor, name, ['object'], 'void');
define(monitor, 'get_LockContentionCount', [], 'long');
for (const type of ['int', 'uint', 'long', 'ulong']) {
  for (const name of ['Increment', 'Decrement']) define(atomic, name, [type + '&'], type);
  for (const name of ['Add', 'And', 'Or']) define(atomic, name, [type + '&', type], type);
}
for (const type of ['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'nint', 'nuint', 'float', 'double', 'object']) {
  define(atomic, 'Exchange', [type + '&', type], type);
  define(atomic, 'CompareExchange', [type + '&', type, type], type);
}
for (const type of ['long', 'ulong']) define(atomic, 'Read', [type + '&'], type);
define(atomic, 'Exchange', ['!!0&', '!!0'], '!!0', 1);
define(atomic, 'CompareExchange', ['!!0&', '!!0', '!!0'], '!!0', 1);
define(atomic, 'MemoryBarrier', [], 'void');
define('System.Threading.Thread', 'MemoryBarrier', [], 'void');
for (const type of ['bool', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'nint', 'nuint', 'float', 'double']) {
  define(volatile, 'Read', [type + '&'], type);
  define(volatile, 'Write', [type + '&', type], 'void');
}
define(volatile, 'Read', ['!!0&'], '!!0', 1);
define(volatile, 'Write', ['!!0&', '!!0'], 'void', 1);
for (const name of ['ReadBarrier', 'WriteBarrier']) define(volatile, name, [], 'void');
export const syncIntrinsicDefinitions = Object.freeze(definitions);

const aliases = Object.freeze({
  'System.Object': 'object',
  'System.Boolean': 'bool',
  'System.SByte': 'sbyte',
  'System.Byte': 'byte',
  'System.Int16': 'short',
  'System.UInt16': 'ushort',
  'System.Int32': 'int',
  'System.UInt32': 'uint',
  'System.Int64': 'long',
  'System.UInt64': 'ulong',
  'System.IntPtr': 'nint',
  'System.UIntPtr': 'nuint',
  'System.Single': 'float',
  'System.Double': 'double',
  'System.Void': 'void'
});
const typeName = type => type?.endsWith('&') ? typeName(type.slice(0, -1)) + '&' : aliases[type] ?? type;
const signatureKey = descriptor => {
  const s = descriptor.signature ?? descriptor;
  return [descriptor.owner, descriptor.name, s.isStatic, s.parameters?.map(typeName).join(','), typeName(s.returnType), s.genericArity ?? 0].join(
    '|');
};
const keys = new Set(definitions.map(signatureKey));
/** MethodSpec signatures arrive substituted; retain exact closed parameter shape. */
export function isSynchronizationIntrinsic(descriptor) {
  if (keys.has(signatureKey(descriptor))) return true;
  const signature = descriptor.signature ?? descriptor,
    args = descriptor.methodArguments ?? descriptor.genericArguments;
  if (!signature.isStatic || args?.length !== 1) return false;
  const type = typeName(args[0]),
    parameters = signature.parameters?.map(typeName),
    result = typeName(signature.returnType);
  if (!parameters || parameters[0] !== type + '&') return false;
  if (descriptor.owner === atomic && ['Exchange', 'CompareExchange'].includes(descriptor.name)) return result === type && parameters.length === (
    descriptor.name === 'Exchange' ? 2 : 3) && parameters.slice(1).every(parameter => parameter === type);
  if (descriptor.owner === volatile) return descriptor.name === 'Read' ? parameters.length === 1 && result === type : descriptor.name === 'Write' &&
    parameters.length === 2 && parameters[1] === type && result === 'void';
  return false;
}
