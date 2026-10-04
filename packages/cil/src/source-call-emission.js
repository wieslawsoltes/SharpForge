import {
  Op
} from '@sharpforge/bytecode';
import {
  sourceValueType
} from './emit/source-values.js';

/** Ordinary and virtual source calls share argument adaptation and the void-result placeholder. */
export function emitSourceCall(writer, context, {
  op,
  a,
  b,
  input,
  adapt
}) {
  if (op !== Op.CALL && op !== Op.CALLVIRT) return false;
  const target = context.image.methods[a];
  const receiver = target.owner + (sourceValueType(context, target.owner) ? '&' : '');
  adapt(input.slice(input.length - b), [...(target.isStatic ? [] : [receiver]), ...target.parameters.map(parameter => parameter.type)]);
  writer.op(op === Op.CALLVIRT ? 'callvirt' : 'call', context.methodTokens.get(a));
  if (target.returnType === 'void') writer.op('ldnull');
  return true;
}
