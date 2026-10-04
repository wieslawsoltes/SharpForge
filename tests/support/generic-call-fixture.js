import {
  MetadataBuilder, Writer, CilWriter, methodSignature, localSignature, fieldSignature,
  methodSpecSignature, signatureType, codedIndex, token, writePE, TEXT_RVA
} from '@sharpforge/cil';

/** Independent CLI metadata, including real GenericParam, TypeSpec and MethodSpec rows. */
export function genericCallFixture(types, {decorate, entry = 'Program.Main'} = {}) {
  const md = new MetadataBuilder('GenericCalls');
  const typeTokens = new Map(types.map((type, index) => [type.name, token(2, index + 2)]));
  const methods = new Map(), fields = new Map();
  const resolve = name => typeTokens.get(name) ?? md.typeRef(name);
  const context = {
    md, types: typeTokens, methods, fields, resolve,
    typeSpec(name) {
      const writer = new Writer();
      signatureType(writer, name, resolve);
      return md.add(27, [md.blob(writer.finish())]);
    },
    member(owner, name, result, parameters = [], isStatic = true, options = {}) {
      return md.member(typeof owner === 'number' ? owner : resolve(owner), name,
        methodSignature(result, parameters, isStatic, resolve, options));
    },
    field(owner, name, type) { return md.member(owner, name, fieldSignature(type, resolve)); },
    methodSpec(method, args) {
      return md.add(43, [codedIndex('MethodDefOrRef', method), md.blob(methodSpecSignature(args, resolve))]);
    }
  };
  md.add(2, [0, md.string('<Module>'), 0, 0, 1, 1]);
  let nextMethod = 1, nextField = 1;
  for (const type of types) {
    const base = type.base?.includes('<') ? context.typeSpec(type.base) : resolve(type.base ?? 'System.Object');
    md.add(2, [type.flags ?? 0x100001, md.string(type.name), 0,
      type.interface ? 0 : codedIndex('TypeDefOrRef', base), nextField, nextMethod]);
    for (const field of type.fields ?? []) fields.set(type.name + '.' + field.name, token(4, nextField++));
    for (const method of type.methods) methods.set(type.name + '.' + method.name, token(6, nextMethod++));
  }
  const parameters = (owner, list = []) => list.forEach((parameter, index) => {
    md.add(42, [index, parameter.flags ?? 0, codedIndex('TypeOrMethodDef', owner), md.string('T' + index)]);
  });
  const definitions = [];
  for (const type of types) {
    parameters(typeTokens.get(type.name), type.genericParameters);
    for (const field of type.fields ?? []) {
      md.add(4, [field.flags ?? 6, md.string(field.name), md.blob(fieldSignature(field.type, resolve))]);
    }
    for (const method of type.methods) {
      const methodToken = methods.get(type.name + '.' + method.name);
      const signature = method.signature ?? methodSignature(method.result ?? 'void', method.parameters ?? [],
        method.static !== false, resolve, {genericArity: method.genericParameters?.length ?? 0});
      md.add(6, [0, 0, method.flags ?? (method.static === false ? 0x86 : 0x96), md.string(method.name), md.blob(signature), 1]);
      parameters(methodToken, method.genericParameters);
      definitions.push({...method, token: methodToken});
    }
    for (const iface of type.interfaces ?? []) {
      const typeToken = iface.includes('<') ? context.typeSpec(iface) : resolve(iface);
      md.add(9, [typeTokens.get(type.name) & 0xffffff, codedIndex('TypeDefOrRef', typeToken)]);
    }
  }
  const section = new Writer().zero(72);
  for (const method of definitions) {
    if (!method.body) continue;
    const writer = new CilWriter();
    method.body(writer, context);
    const code = writer.finish();
    const locals = method.locals?.length ? md.add(17, [md.blob(localSignature(method.locals, resolve))]) : 0;
    section.pad(4);
    md.rows[6][(method.token & 0xffffff) - 1][0] = TEXT_RVA + section.length;
    section.u16(0x3013).u16(method.maxStack ?? 16).u32(code.length).u32(locals).bytes(code);
  }
  decorate?.(context);
  section.pad(4);
  const offset = section.length, metadata = md.finish(undefined, new Uint8Array([0xa0, 5, 3]));
  section.bytes(metadata);
  return writePE(section.finish(), offset, metadata.length, methods.get(entry));
}
