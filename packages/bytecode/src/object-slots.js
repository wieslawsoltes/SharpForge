const slots = Object.freeze({ToString: ['string'], Equals: ['bool', 'object'], GetHashCode: ['int']});

/** Exact Object slots carried by source images; unrelated same-named methods keep ordinary method identities. */
export function sourceObjectSlot(method) {
  const signature = slots[method.name];
  if (!signature || method.isStatic || method.callingConvention || method.genericArity || method.explicitThis ||
      method.sentinel != null || !Array.isArray(method.parameters) || method.returnType !== signature[0] ||
      method.parameters.length !== signature.length - 1 ||
      !method.parameters.every((parameter, index) => (parameter.type ?? parameter) === signature[index + 1])) return null;
  return method.name;
}

export const objectSlotKey = name => 'System.Object::' + name;

/** Appended identities preserve every previously released builtin number. */
export const sourceObjectBuiltins = Object.freeze([
  Object.freeze({name: 'object.Equals', min: 2, max: 2, result: 'bool', params: Object.freeze(['object', 'object'])}),
  Object.freeze({name: 'object.GetHashCode', min: 1, max: 1, result: 'int', params: Object.freeze(['object'])})
]);
