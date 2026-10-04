import {
  MetadataBuilder, Writer, CilWriter, methodSignature, localSignature,
  codedIndex, token, writePE, TEXT_RVA
} from '@sharpforge/cil';

/** Independent metadata assembly for declaration slots and explicit MethodImpl rows. */
export function dispatchFixture(classes, main, {methodImpl = [], interfaces = [], memberRef = false} = {}) {
  const md = new MetadataBuilder('VirtualDispatch');
  const typeTokens = new Map(classes.map((type, index) => [type.name, token(2, index + 2)]));
  const object = md.typeRef('System.Object');
  const resolve = name => typeTokens.get(name) ?? md.typeRef(name);
  const methods = new Map();
  md.add(2, [0, md.string('<Module>'), 0, 0, 1, 1]);
  let nextMethod = 1;
  for (const type of classes) {
    const base = type.interface ? 0 : codedIndex('TypeDefOrRef', type.base ? resolve(type.base) : object);
    md.add(2, [type.flags ?? 0x100001, md.string(type.name), 0, base, 1, nextMethod]);
    for (const method of type.methods) methods.set(type.name + '::' + method.name, token(6, nextMethod++));
  }
  md.add(2, [0x100001, md.string('Program'), 0, codedIndex('TypeDefOrRef', object), 1, nextMethod]);
  const entry = token(6, nextMethod);
  const definitions = classes.flatMap(type => type.methods.map(method => ({
    ...method, owner: type.name, token: methods.get(type.name + '::' + method.name)
  })));
  definitions.push({name: 'Main', owner: 'Program', token: entry, flags: 0x96, result: 'int', locals: ['object'], body: main});
  for (const method of definitions) {
    const signature = methodSignature(method.result ?? 'int', method.parameters ?? [], !!(method.flags & 0x10), resolve);
    md.add(6, [0, 0, method.flags ?? 0x1c6, md.string(method.name), md.blob(signature), 1]);
  }
  const methodRef = name => {
    const definition = definitions.find(method => method.owner + '::' + method.name === name);
    if (!memberRef) return methods.get(name);
    return md.member(resolve(definition.owner), definition.name,
      methodSignature(definition.result ?? 'int', definition.parameters ?? [], false, resolve));
  };
  const context = {md, types: typeTokens, methods, methodRef,
    objectCtor: () => md.member(object, '.ctor', methodSignature('void', [], false, resolve))};
  const section = new Writer().zero(72);
  for (const method of definitions) {
    if (!method.body) continue;
    const writer = new CilWriter();
    method.body(writer, context);
    const code = writer.finish();
    const locals = method.locals ? md.add(17, [md.blob(localSignature(method.locals, resolve))]) : 0;
    section.pad(4);
    md.rows[6][(method.token & 0xffffff) - 1][0] = TEXT_RVA + section.length;
    section.u16(0x3013).u16(8).u32(code.length).u32(locals).bytes(code);
  }
  for (const [owner, iface] of interfaces) {
    md.add(9, [resolve(owner) & 0xffffff, codedIndex('TypeDefOrRef', resolve(iface))]);
  }
  for (const [owner, body, declaration] of methodImpl) {
    md.add(25, [resolve(owner) & 0xffffff,
      codedIndex('MethodDefOrRef', methods.get(body)), codedIndex('MethodDefOrRef', methods.get(declaration))]);
  }
  section.pad(4);
  const offset = section.length;
  const metadata = md.finish(undefined, new Uint8Array([3, 7, 0]));
  section.bytes(metadata);
  return writePE(section.finish(), offset, metadata.length, entry);
}
