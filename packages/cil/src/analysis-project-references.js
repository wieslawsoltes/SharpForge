import {Op} from '@sharpforge/bytecode';

const calls = new Set([Op.EXTCALL, Op.EXTNEWOBJ]);
const fields = new Set([Op.EXTLDFLD, Op.EXTSTFLD, Op.EXTLDSTATIC, Op.EXTSTSTATIC]);

/** Apply the typed stack effect of a verified external descriptor before the legacy instruction transfer. */
export function analyzeProjectInstruction(image, operation, {argument, count, stack, pop}) {
  const profile = image.externalReferences;
  if (calls.has(operation)) {
    const method = profile.methods[argument];
    for (let index = 0; index < count; index++) pop();
    stack.push(operation === Op.EXTNEWOBJ ? profile.types[method.type].imageName
      : method.returnType === 'void' ? 'null' : method.returnType);
    return true;
  }
  if (!fields.has(operation)) return false;
  const field = profile.fields[argument];
  if (operation === Op.EXTSTFLD || operation === Op.EXTSTSTATIC) pop();
  if (!field.isStatic) pop();
  stack.push(field.fieldType);
  return true;
}
