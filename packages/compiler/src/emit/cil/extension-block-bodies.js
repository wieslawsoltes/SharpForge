/** CIL bodies for metadata-only extension declarations and an embedded marker attribute when needed. */
import { IlBuilder } from './il-builder.js';
import { frameworkType } from './framework-types.js';
import { ExtensionMetadataBody } from '../../codegen/metadata/extension-marker-attribute.js';

function declarationBody(program) {
  const shape = { isStatic: false, returnType: program.core.void, parameters: [] };
  const exception = frameworkType(program.core, 'System', 'NotImplementedException');
  const constructor = program.tokens.external(exception, '.ctor', shape);
  return new IlBuilder().emit('newobj', constructor, { pops: 0, pushes: 1 }).emit('throw');
}

function attributeConstructor(program, { field }) {
  const shape = { isStatic: false, returnType: program.core.void, parameters: [] };
  const constructor = program.tokens.external(program.core.attribute, '.ctor', shape);
  return new IlBuilder().emit('ldarg', 0).emit('call', constructor, { pops: 1, pushes: 0 })
    .emit('ldarg', 0).emit('ldarg', 1).emit('stfld', program.tokens.field(field)).emit('ret', undefined, { pops: 0, pushes: 0 });
}

function attributeName(program, { field }) {
  return new IlBuilder().emit('ldarg', 0).emit('ldfld', program.tokens.field(field)).emit('ret', undefined, { pops: 1, pushes: 0 });
}

const bodies = new Map([
  [ExtensionMetadataBody.Declaration, declarationBody],
  [ExtensionMetadataBody.AttributeConstructor, attributeConstructor],
  [ExtensionMetadataBody.AttributeName, attributeName],
]);

/** Populate the existing planned-method body contribution seam before executable bodies are generated. */
export function installExtensionBlockBodies(writer) {
  for (const [method, descriptor] of writer.extensions?.bodies ?? []) {
    const emit = bodies.get(descriptor.kind);
    method.emitBody = program => emit(program, descriptor);
  }
}
