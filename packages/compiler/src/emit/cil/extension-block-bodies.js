/** CIL bodies for metadata-only extension declarations; embedded attribute bodies use the common contribution. */
import { IlBuilder } from './il-builder.js';
import { frameworkType } from './framework-types.js';

function declarationBody(program) {
  const shape = { isStatic: false, returnType: program.core.void, parameters: [] };
  const exception = frameworkType(program.core, 'System', 'NotImplementedException');
  const constructor = program.tokens.external(exception, '.ctor', shape);
  return new IlBuilder().emit('newobj', constructor, { pops: 0, pushes: 1 }).emit('throw');
}

/** Populate the existing planned-method body contribution seam before executable bodies are generated. */
export function installExtensionBlockBodies(writer) {
  for (const method of writer.extensions?.bodies.keys() ?? []) method.emitBody = declarationBody;
}
