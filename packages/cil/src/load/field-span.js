import {Op} from '@sharpforge/bytecode';
import {CilError} from '../binary.js';
import {decodeCoded, readSignature} from '../metadata.js';
import {resolveExternalReadonlyField} from '../external-field-profile.js';

function externalStringField(instruction, context) {
  const metadata = context.metadata;
  const token = instruction.operand;
  if (token >>> 24 !== 10) return null;
  const row = metadata.row(token);
  const ownerToken = decodeCoded('MemberRefParent', row[0]);
  const member = {token, ownerToken, owner: metadata.typeName(ownerToken), name: metadata.string(row[1]),
    signature: readSignature(metadata.blob(row[2]), metadata)};
  const resolved = resolveExternalReadonlyField({metadata}, member);
  return resolved?.externalField.type === 'string' ? {readonlyField: {owner: member.owner, name: member.name}} : null;
}

/** Field provenance comes from exact metadata; canonical re-emission still checks the entire method span. */
export function decodeFieldSpan(span, context) {
  const instruction = span.find(item => ['ldfld', 'stfld', 'ldsfld', 'stsfld'].includes(item.name));
  if (!instruction) return null;
  if (instruction.name.endsWith('sfld')) {
    const index = context.staticByToken.get(instruction.operand);
    if (index !== undefined) return [instruction.name === 'ldsfld' ? Op.LDSTATIC : Op.STSTATIC, index, 0];
    const marker = span.length === 1 && instruction.name === 'ldsfld' ? externalStringField(instruction, context) : null;
    if (!marker) throw new CilError('Unknown static field token');
    return [Op.CONST, context.intern(marker), 0];
  }
  const field = context.fieldByToken.get(instruction.operand);
  if (!field) throw new CilError('Unknown field token');
  return [instruction.name === 'ldfld' ? Op.LDFLD : Op.STFLD, field.index, 0];
}
