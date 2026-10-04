import {emitSourceVarargsBuiltin} from './source-varargs-emission.js';
import {decodeNumericBuiltin, emitNumericBuiltin} from './numeric-builtin-mapping.js';
import {emitControlBuiltin,decodeControlBuiltin} from './control-builtin-mapping.js';
import {Builtins, numericTypeId, numericTypeName} from '@sharpforge/bytecode';
import {frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';
import {emitObjectBuiltin} from './object-builtin-mapping.js';
import {decodeMathBuiltin, emitMathBuiltin} from './math-builtin-mapping.js';

const isValue = type => numericTypeId(type) !== undefined || type === 'bool' ||
  ['enum', 'value'].includes(frameworkType(type)?.kind);
const decimalBuiltins = Object.values(Builtins).filter(builtin => builtin.decimal);

/** Keep exact typed families ahead of the released name-based source mappings. */
export function decodeProfileBuiltin(target, span) {
  return decodeControlBuiltin(target) ?? decodeNumericBuiltin(target, span) ?? decodeMathBuiltin(target, span) ?? decodeDecimalBuiltin(target);
}

/** Recognize only the source-visible Decimal overload with its complete CLI signature. */
export function decodeDecimalBuiltin(target) {
  const signature = target.sig;
  if ((target.owner !== 'System.Decimal' && target.owner !== 'System.Math') ||
      signature?.kind !== 'method' || signature.isStatic !== true || signature.genericArity ||
      signature.callingConvention || signature.explicitThis || signature.sentinel != null) return null;
  return decimalBuiltins.find(builtin => {
    const descriptor = builtin.decimal;
    return target.owner === descriptor.owner && target.name === descriptor.name &&
      numericTypeName(signature.returnType) === builtin.result &&
      signature.parameters.length === builtin.params.length &&
      signature.parameters.every((type, index) => numericTypeName(type) === builtin.params[index]);
  }) ?? null;
}

function legacyTarget(name, count, types) {
  if (name.startsWith('Console.')) {
    const type = types[0];
    return {owner: 'System.Console', member: name.slice(8), result: 'void',
      params: count ? [type === 'null' ? 'string' : frameworkType(type)?.kind === 'enum' ? 'object'
        : isValue(type) || type === 'string' ? type : 'object'] : []};
  }
  if (name.startsWith('Math.') || name === '$Math.Abs.Int32') {
    const member = name === '$Math.Abs.Int32' ? 'Abs' : name.slice(5);
    const result = ['Abs', 'Min', 'Max'].includes(member) && types.every(type => type === 'int') ? 'int' : 'double';
    return {owner: 'System.Math', member, result, params: types.map(() => result)};
  }
  if (name.startsWith('GC.')) {
    const member = name.slice(3);
    return {owner: 'System.GC', member, result: member === 'Collect' ? 'void' : member === 'GetTotalMemory' ? 'long' : 'int',
      params: member === 'Collect' ? [] : member === 'GetTotalMemory' ? ['bool'] : ['int'],
      extra: member === 'GetTotalMemory' && !count};
  }
  if (name === 'int.Parse' || name === 'double.Parse') {
    const owner = name.startsWith('int') ? 'int' : 'double';
    return {owner, member: 'Parse', result: owner, params: ['string']};
  }
  if (name.startsWith('Convert.')) {
    const member = name.slice(8), type = types[0];
    return {owner: 'System.Convert', member, result: {ToInt32: 'int', ToDouble: 'double', ToString: 'string'}[member],
      params: [type === 'null' ? 'object' : isValue(type) || type === 'string' ? type : 'object']};
  }
  if (name.startsWith('Array.')) return {owner: 'Array', member: name.slice(6), result: 'void', params: ['Array']};
  if (name === 'Type.Name' || name === 'Type.FullName') {
    return {owner: name === 'Type.Name' ? 'System.Reflection.MemberInfo' : 'System.Type',
      member: 'get_' + name.slice(5), result: 'string', params: [], instance: true};
  }
  if (name === 'Exception.new') {
    return {owner: 'Exception', member: '.ctor', result: 'void', params: ['string'], instance: true, newObject: true};
  }
  if (name === 'Exception.Message') {
    return {owner: 'Exception', member: 'get_Message', result: 'string', params: [], instance: true};
  }
  if (name === 'Environment.TickCount') return {owner: 'System.Environment', member: 'get_TickCount', result: 'int', params: []};
  if (name.startsWith('string.')) return stringTarget(name.slice(7), count);
  throw new CilError(`No CIL intrinsic mapping for ${name}`);
}

function stringTarget(member, count) {
  return {
    owner: 'string', member,
    result: ['Contains', 'StartsWith', 'EndsWith', 'IsNullOrEmpty'].includes(member) ? 'bool' : member === 'IndexOf' ? 'int' : 'string',
    instance: !['Concat', 'IsNullOrEmpty', 'Intern', 'IsInterned'].includes(member),
    params: member === 'Concat' ? ['string', 'string'] : ['IsNullOrEmpty', 'Intern', 'IsInterned'].includes(member) ? ['string']
      : member === 'Substring' ? Array(count - 1).fill('int') : ['Contains', 'IndexOf', 'StartsWith', 'EndsWith'].includes(member)
        ? ['string'] : member === 'Replace' ? ['string', 'string'] : []
  };
}

/** Emit a source builtin as an ordinary CLI call, retaining the released legacy mappings. */
export function emitBuiltin(context, writer, id, types, adapt) {
  const count = types.length;
  const builtin = Builtins[id], name = builtin.name;
  if (emitNumericBuiltin(context, writer, builtin, types, adapt)) return;
  if (emitSourceVarargsBuiltin(context, writer, builtin, types, adapt) || emitControlBuiltin(context, writer, builtin, types, adapt)) return;
  if (emitMathBuiltin(context, writer, builtin, types, adapt)) return;
  if (builtin.decimal) {
    const descriptor = builtin.decimal;
    adapt(types, builtin.params);
    writer.op('call', context.external(descriptor.owner, descriptor.name, descriptor.returnType, descriptor.parameters, true));
    return;
  }
  if (emitObjectBuiltin(context, writer, name, types, adapt)) return;
  if (name === 'Enum.HasFlag') {
    adapt(types, ['object', 'object']);
    writer.op('callvirt', context.external('System.Enum', 'HasFlag', 'bool', ['System.Enum'], false));
    return;
  }
  if (name === 'string.get_Chars') {
    adapt(types, ['string', 'int']);
    writer.op('callvirt', context.external('string', 'get_Chars', 'char', ['int'], false)).op('conv.i4');
    return;
  }
  if (name === 'Debug.Assert') {
    if (count === 1) writer.op('ldstr', 0x70000000 | context.metadata.userString('Assertion failed'));
    writer.op('call', context.helperToken).op('ldnull');
    return;
  }
  const target = legacyTarget(name, count, types);
  const {owner, member, result, params, instance = false, newObject = false, extra = false} = target;
  if (extra) writer.integer(0);
  else adapt(types, [...(instance && !newObject ? [owner] : []), ...params]);
  writer.op(newObject ? 'newobj' : instance ? 'callvirt' : 'call', context.external(owner, member, result, params, !instance));
  if (result === 'void' && !newObject) writer.op('ldnull');
}
