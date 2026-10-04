import { CilOpcodes } from '../opcodes/catalog.js';
import { tokenHex } from '../inspector.js';
import { ExpressionContext, identifier, typeName } from './expressions.js';
import { valueInstructionHandler } from './value-instructions.js';
import { memberInstructionHandler } from './member-instructions.js';
import { controlInstructionHandler } from './control-instructions.js';
import { controlFlowCancellation } from './cfg-contracts.js';

const handlerProviders = Object.freeze([valueInstructionHandler, memberInstructionHandler, controlInstructionHandler]);
const handlers = Object.create(null);
for (const opcode of Object.values(CilOpcodes)) {
  for (const provider of handlerProviders) {
    const handler = provider(opcode);
    if (handler) {
      handlers[opcode.name] = handler;
      break;
    }
  }
}
Object.freeze(handlers);

function render(context) {
  const method = context.method;
  const parameters = method.signature.parameters.map((type, index) => `${typeName(type)} arg${index}`).join(', ');
  const declaration = `public ${method.signature.isStatic ? 'static ' : ''}${typeName(method.signature.returnType)} `
    + `${identifier(method.name)}(${parameters})`;
  const locals = method.locals.map((type, index) => `    ${typeName(type)} v${index}${method.initLocals ? ' = default' : ''};`);
  return [
    `// Reconstructed from ${tokenHex(method.token)} IL; original names/source formatting are not recovered.`,
    declaration, '{', ...locals, ...context.statements, '}',
  ].join('\n') + '\n';
}

/** Retain the existing conservative lowering; unsupported instructions or stack merges throw a fallback reason. */
export function reconstructCSharp(inspector, method, graph, signal) {
  if (method.handlers.length) throw new Error('Exception-region structuring is not implemented; complete IL is shown.');
  const types = [method.signature.returnType, ...method.signature.parameters, ...method.locals];
  if (method.signature.genericArity || types.some(type => /[!*]|`[0-9]/.test(type))) {
    throw new Error('Generic and pointer signatures are preserved as IL.');
  }
  const context = new ExpressionContext(inspector, method);
  const targets = new Set();
  for (const edge of graph.edges) {
    controlFlowCancellation(signal);
    if (edge.kind !== 'fall-through') targets.add(graph.blocks[edge.target].startOffset);
  }
  for (const instruction of method.instructions) {
    controlFlowCancellation(signal);
    if (targets.has(instruction.offset)) {
      if (context.stack.length) throw new Error('Non-empty evaluation stack at a branch target');
      context.statements.push(`  ${instruction.label}:`);
      context.reachable = true;
    }
    if (!context.reachable) continue;
    const handler = handlers[instruction.name];
    if (!handler) throw new Error(`Opcode '${instruction.name}' has no proven C# reconstruction`);
    handler(context, instruction);
  }
  return render(context);
}
