import {Op} from '@sharpforge/bytecode';

/** Relocate local references while preserving implicit CLI initialization of real library .cctor bodies. */
export function linkLocalProjectInstruction(module, code, offset, wrappers) {
  const operation = code[offset];
  const argument = code[offset + 1];
  if (operation === Op.CALL) {
    const source = module.image.methods[argument];
    const type = module.source.typesByName.get(source.owner);
    code[offset + 1] = type && source.name !== '.cctor'
      ? wrappers.method({module, type: {source: type}, source}) : module.offsets.methods + argument;
    return true;
  }
  if (operation === Op.NEWOBJ) {
    const allocate = wrappers.allocate(module, argument);
    if (allocate === null) code[offset + 1] += module.offsets.types;
    else {
      code[offset] = Op.CALL;
      code[offset + 1] = allocate;
      code[offset + 2] = 0;
    }
    return true;
  }
  if (operation !== Op.LDSTATIC && operation !== Op.STSTATIC) return false;
  const definition = module.inspector.fields.get(module.inspector.debug.statics[argument]);
  const source = module.source.types.get(definition.ownerToken);
  if (!source || !module.source.typeInitializers.has(source.name)) {
    code[offset + 1] += module.offsets.statics;
    return true;
  }
  const descriptor = {token: definition.token, fieldType: module.mapType(module.image.statics[argument].type)};
  const store = operation === Op.STSTATIC;
  code[offset] = Op.CALL;
  code[offset + 1] = wrappers.staticField({module, type: {source}, descriptor, index: argument}, store);
  code[offset + 2] = store ? 1 : 0;
  return true;
}
