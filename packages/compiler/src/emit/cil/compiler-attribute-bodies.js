/** Executable constructors/getters for locally embedded compiler attributes, including legacy target packs. */
import { IlBuilder } from './il-builder.js';
import { CompilerAttributeBody } from '../../codegen/metadata/compiler-attribute-symbols.js';

function constructorBody(program, descriptor) {
  const shape = { isStatic: false, returnType: program.core.void, parameters: [] };
  const constructor = program.tokens.external(program.core.attribute, '.ctor', shape);
  const il = new IlBuilder().emit('ldarg', 0).emit('call', constructor, { pops: 1, pushes: 0 });
  if (descriptor.kind !== CompilerAttributeBody.Constructor) {
    il.emit('ldarg', 0);
    if (descriptor.kind === CompilerAttributeBody.ByteArrayConstructor) {
      il.emit('ldc.i4', 1).emit('newarr', program.tokens.type(program.core.byte))
        .emit('dup').emit('ldc.i4', 0).emit('ldarg', 1).emit('stelem.i1');
    } else il.emit('ldarg', 1);
    il.emit('stfld', program.tokens.field(descriptor.field));
  }
  return il.emit('ret', undefined, { pops: 0, pushes: 0 });
}

function fieldGetter(program, { field }) {
  return new IlBuilder().emit('ldarg', 0).emit('ldfld', program.tokens.field(field)).emit('ret', undefined, { pops: 1, pushes: 0 });
}

/** Called before AssemblyEmitter emits any body; reference assemblies keep their ordinary throwing stubs. */
export function installCompilerAttributeBodies(writer) {
  for (const contract of writer.compilerAttributes?.definitions.values() ?? []) {
    for (const [method, descriptor] of contract.bodies) {
      const emit = descriptor.kind === CompilerAttributeBody.FieldGetter ? fieldGetter : constructorBody;
      method.emitBody = program => emit(program, descriptor);
    }
  }
}
