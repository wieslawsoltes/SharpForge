import {constantType} from '../analysis-types.js';

/** Preserve readonly string field identity in genuine CIL; other profile constants retain their old encoding. */
export function emitSourceConstant(context, writer, index, flags) {
  const value = context.image.constants[index];
  if (value !== null && typeof value === 'object' && Object.hasOwn(value, 'readonlyField')) {
    const {owner, name} = value.readonlyField;
    const parent = context.metadata.typeRef(owner, 'System.Runtime');
    writer.op('ldsfld', context.metadata.member(parent, name, context.signatures.field('string')));
    return;
  }
  const type = constantType(value, flags);
  if (type === 'null') writer.op('ldnull');
  else if (type === 'string') writer.op('ldstr', 0x70000000 | context.metadata.userString(value));
  else if (type === 'double') writer.op('ldc.r8', value);
  else {
    writer.integer(value === true ? 1 : value === false ? 0 : value);
    if (type === 'bool') writer.op('conv.u1');
  }
}
