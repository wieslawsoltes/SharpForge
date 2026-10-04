import {frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';
import {nullableElementType} from './nullable-profile.js';
import {Op} from '@sharpforge/bytecode';

export const nullableUnderlying = type => type.endsWith('?') ? type.slice(0, -1) :
  /^System\.Nullable(?:`1)?<(.+)>$/.exec(type)?.[1] ?? null;

/** A framework byref parameter receives the address of the existing capture cell's Value field. */
function emitReference(context, writer, actual, expected) {
  const type = context.layout.types.get(actual), cell = type?.referenceCell;
  if (!cell || cell.valueType !== expected.slice(0, -1)) {
    throw new CilError(`Framework byref '${expected}' requires a matching marked reference cell`);
  }
  const field = context.fieldTokens.get(actual + ':' + cell.field);
  if (!field) throw new CilError('Missing reference cell field token');
  writer.op('ldflda', field);
}

/** A null reference becomes default Nullable<T>; a present number keeps its presence, including zero. */
function emitNullable(context, writer, actual, expected, scratch, convert) {
  const element = nullableElementType(expected);
  if (!element) {
    throw new CilError('Unsupported nullable framework parameter');
  }
  const token = context.resolveType(expected);
  if (nullableElementType(actual) === element) return;
  if (actual === 'null') {
    writer.op('pop');
    const local = scratch(expected, 4200);
    writer.op('ldloca', local).op('initobj', token).local('ldloc', local);
    return;
  }
  if (actual === 'object') {
    writer.op('unbox.any', token);
    return;
  }
  if (actual !== element && !['int', 'double', 'float', 'bool', 'uint'].includes(actual)) {
    throw new CilError('Nullable framework arguments require an approved value, a matching box, or null');
  }
  convert(actual, element);
  writer.op('newobj', context.external(expected, '.ctor', 'void', ['!0'], false));
}

/** CLI APIs receive an actual delegate over a generated forwarding method, not the compiler's capture record. */
function emitDelegate(context, writer, actual, expected) {
  const type = context.layout.types.get(actual);
  if (!type || type.delegateContract !== expected || type.frameworkInvoke === undefined) {
    throw new CilError('Framework delegate argument has no matching compiler delegate bridge');
  }
  const invoke = context.methodTokens.get(type.frameworkInvoke);
  if (!invoke) throw new CilError('Missing framework delegate forwarding method');
  writer.op('dup');
  const missing = writer.length;
  writer.op('brfalse', 0).op('ldftn', invoke)
    .op('newobj', context.external(expected, '.ctor', 'void', ['object', 'nint'], false));
  writer.patch32(missing + 1, writer.length - (missing + 5));
}

export function needsFrameworkAdaptation(context, descriptor, actual) {
  const instance = !descriptor.isStatic && descriptor.kind !== 'constructor';
  if (instance && frameworkType(descriptor.owner)?.kind === 'value') return true;
  return descriptor.parameters.some((type, index) => {
    const from = actual[index + (instance ? 1 : 0)];
    return type.endsWith('&') || nullableUnderlying(type) ||
      frameworkType(type)?.kind === 'delegate' && context.layout.types.get(from)?.delegateInvoke !== undefined;
  });
}

/** The source emitter evaluates a property setter against an already captured, writable value receiver. */
export function frameworkReceiverSlot(method, pc, descriptor) {
  if (descriptor.isStatic || descriptor.kind !== 'set' || frameworkType(descriptor.owner)?.kind !== 'value') return null;
  const start = pc - descriptor.parameters.length - 1;
  if (start < 0 || method.code[start * 3] !== Op.LDLOC) throw new CilError('A value setter requires a captured receiver local');
  for (let at = start + 1; at < pc; at++) {
    if (method.code[at * 3] !== Op.LDLOC) throw new CilError('Value setter arguments must be captured before receiver addressing');
  }
  const slot = method.code[start * 3 + 1];
  if (method.locals[slot]?.type !== descriptor.owner) throw new CilError('Value setter receiver type mismatch');
  return slot;
}

export function adaptFrameworkArguments(context, writer, {descriptor, actual, scratch, convert, receiverSlot = null}) {
  const instance = !descriptor.isStatic && descriptor.kind !== 'constructor';
  const expected = [...(instance ? [descriptor.owner] : []), ...descriptor.parameters];
  if (actual.length !== expected.length) throw new CilError('Framework argument stack shape is invalid');
  const locals = [];
  for (let index = actual.length - 1; index >= 0; index--) {
    if (index === 0 && receiverSlot !== null) {
      writer.op('pop');
      locals[index] = receiverSlot;
      continue;
    }
    locals[index] = scratch(actual[index], 4000 + index);
    writer.local('stloc', locals[index]);
  }
  for (let index = 0; index < expected.length; index++) {
    const from = actual[index], to = expected[index];
    if (index === 0 && instance && frameworkType(to)?.kind === 'value') {
      writer.op('ldloca', locals[index]);
      continue;
    }
    writer.local('ldloc', locals[index]);
    if (to.endsWith('&')) emitReference(context, writer, from, to);
    else if (nullableUnderlying(to)) emitNullable(context, writer, from, to, scratch, convert);
    else if (frameworkType(to)?.kind === 'delegate' && context.layout.types.get(from)?.delegateInvoke !== undefined) {
      emitDelegate(context, writer, from, to);
    } else convert(from, to);
  }
}
