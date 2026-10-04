const getType = Object.freeze({owner: 'object', name: 'GetType', result: 'System.Type', parameters: [], instance: true});
const toString = Object.freeze({owner: 'object', name: 'ToString', result: 'string', parameters: [], instance: true});
const referenceEquals = Object.freeze({owner: 'System.Object', name: 'ReferenceEquals', result: 'bool',
  parameters: ['object', 'object'], instance: false});
const typeNames = Object.freeze({'System.Int32': 'int', 'System.Double': 'double', 'System.Boolean': 'bool', 'System.Int64': 'long'});

/** Emit virtual Object members distinctly from static Convert calls, including receiver boxing. */
export function emitObjectBuiltin(context, writer, name, types, adapt) {
  let target;
  if (name === 'object.ToString') target = toString;
  else if (name === 'object.ReferenceEquals') target = referenceEquals;
  else if (name === 'object.GetType' || name.startsWith('$type.')) target = getType;
  else return false;
  adapt(types, target.instance ? ['object'] : target.parameters);
  writer.op(target.instance ? 'callvirt' : 'call',
    context.external(target.owner, target.name, target.result, target.parameters, !target.instance));
  return true;
}

/** Preserve emitted Object identities; static Convert(object) must never become a virtual Object call. */
export function decodeObjectBuiltin(target, call, span, metadata) {
  if (target.owner !== 'System.Object') return null;
  if (target.name === 'ToString' && call.name === 'callvirt') return 'object.ToString';
  if (target.name === 'ReferenceEquals') return 'object.ReferenceEquals';
  if (target.name !== 'GetType') return null;
  const box = span.find(instruction => instruction.name === 'box');
  const type = box ? typeNames[metadata.typeName(box.operand)] : null;
  return type ? '$type.' + type + '.GetType' : 'object.GetType';
}
