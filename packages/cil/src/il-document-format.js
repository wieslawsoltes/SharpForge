import { AssemblyInspector, tokenHex, ilLabel } from './inspector.js';
import { CilError } from './binary.js';

function encodeImage(bytes) {
  let source = '';
  for (let index = 0; index < bytes.length; index += 16384) {
    source += String.fromCharCode(...bytes.subarray(index, index + 16384));
  }
  return btoa(source);
}

function formatInstruction(instruction) {
  let operand;
  if (instruction.operandKind === 'token') operand = tokenHex(instruction.operand);
  else if (instruction.operandKind === 'switch') operand = '(' + instruction.operand.map(ilLabel).join(', ') + ')';
  else if (instruction.operandKind.startsWith('br')) operand = ilLabel(instruction.operand);
  else if (instruction.operand === undefined) operand = '';
  else operand = Object.is(instruction.operand, -0) ? '-0' : String(instruction.operand);
  const comment = instruction.operandKind === 'token' ? ' // ' + instruction.operandText : '';
  return `  ${instruction.label}: ${instruction.name}${operand ? ' ' + operand : ''}${comment}`;
}

function formatHandler(handler) {
  const payload = handler.flags === 1 ? ilLabel(handler.catchType) : tokenHex(handler.catchType);
  return `  .eh ${handler.flags} ${ilLabel(handler.start)} ${ilLabel(handler.end)} ` +
    `${ilLabel(handler.target)} ${ilLabel(handler.handlerEnd)} ${payload}`;
}

/** Format the metadata-preserving SharpForge dialect; every visible body remains authoritative. */
export function formatILDocument(bytes) {
  const inspector = new AssemblyInspector(bytes);
  const assembly = inspector.summary();
  const lines = [
    '// SharpForge.IL/1 — metadata-preserving IL workspace',
    '// Every method body below is authoritative. Numeric metadata tokens reference .image.',
    '// Editing declarations/signature tokens requires existing compatible metadata.',
    `.image "${encodeImage(inspector.pe.bytes)}"`,
    `.assembly ${JSON.stringify(assembly.name)}`,
  ];
  for (const method of assembly.methods) {
    if (method.error) throw new CilError(`Cannot export method ${tokenHex(method.token)}: ${method.error}`);
    if (!method.hasBody) continue;
    lines.push(
      '',
      `// ${method.owner}::${method.name}(${method.signature.parameters.join(', ')}) -> ${method.signature.returnType}`,
      `.method ${tokenHex(method.token)}`,
      '{',
      `  .maxstack ${method.maxStack}`,
      `  .locals ${tokenHex(method.localSignature ?? 0)}`,
      `  .initlocals ${method.initLocals ? 1 : 0}`,
    );
    for (const instruction of method.instructions) lines.push(formatInstruction(instruction));
    for (const handler of method.handlers) lines.push(formatHandler(handler));
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}
