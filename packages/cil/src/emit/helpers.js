import {CilWriter} from '../opcodes.js';
import {CilError} from '../binary.js';

function allocate(context, descriptor, writer) {
  writer.local('ldarg', 0).op('call', context.external('object', '.ctor', 'void', [], false)).op('ret');
  return 2;
}

function constructor(context, descriptor, writer) {
  writer.local('ldarg', 0).op('call', context.external('object', '.ctor', 'void', [], false));
  const initializer = descriptor.type.original.initializer;
  if (initializer !== undefined) writer.local('ldarg', 0).op('call', context.methodTokens.get(initializer));
  if (descriptor.ctor) {
    writer.local('ldarg', 0);
    descriptor.parameters.forEach((parameter, index) => writer.local('ldarg', index + 1));
    writer.op('call', context.methodTokens.get(descriptor.ctor.id));
  }
  writer.op('ret');
  return descriptor.ctor ? descriptor.parameters.length + 1 : 2;
}

function assertion(context, descriptor, writer) {
  writer.local('ldarg', 0);
  const branch = writer.length;
  writer.op('brtrue', 0).local('ldarg', 1)
    .op('newobj', context.external('Exception', '.ctor', 'void', ['string'], false)).op('throw');
  const done = writer.length;
  writer.op('ret').patch32(branch + 1, done - (branch + 5));
  return 2;
}

function typeInitializer(context, descriptor, writer) {
  writer.op('call', context.methodTokens.get(descriptor.ensure.id)).op('ret');
  return 1;
}

const helpers = new Map([
  ['allocate', allocate], ['constructor', constructor], ['assert', assertion], ['typeInitializer', typeInitializer],
]);

/** Emit canonical CLI scaffolding; source method bodies remain the only executable profile payload. */
export function emitHelper(context, descriptor) {
  const emit = helpers.get(descriptor.helper);
  if (!emit) throw new CilError('Unknown canonical helper');
  // Historical helper emission interns this member before any helper-specific references.
  context.external('object', '.ctor', 'void', [], false);
  const writer = new CilWriter();
  const maxStack = emit(context, descriptor, writer);
  return {code: writer.finish(), locals: [], maxStack, handlers: []};
}

/** Give external native field access the same initialization helper that source calls already use. */
export function projectTypeInitializer(context, type, originals, methodToken, options) {
  if (options.projectStaticInitializers !== undefined && typeof options.projectStaticInitializers !== 'boolean') {
    throw new CilError('projectStaticInitializers must be boolean');
  }
  if (options.projectStaticInitializers === false || !type.original) return null;
  const ensure = originals.find(method => method.name === '<EnsureInitialized>' && method.isStatic
    && method.returnType === 'void' && method.parameters.length === 0);
  if (!ensure || originals.some(method => method.name === '.cctor')) return null;
  const precise = originals.some(method => method.name === '<cctor>' && method.isStatic);
  type.flags = precise ? type.flags & ~0x100000 : type.flags | 0x100000;
  context.projectInitialization = true;
  return {token: methodToken, name: '.cctor', parameters: [], returnType: 'void', isStatic: true,
    flags: 0x1891, helper: 'typeInitializer', type, ensure};
}
