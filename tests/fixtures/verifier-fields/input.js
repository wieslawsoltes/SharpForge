import { MetadataBuilder, Writer, CilWriter, fieldSignature, methodSignature, localSignature, writePE, TEXT_RVA } from '@sharpforge/cil';

const definitions = ['Owner', 'Derived', 'Other', 'Value', 'Host'];
const fields = {
  Owner: [['Number', 'int', 6], ['Readonly', 'int', 0x26], ['Shared', 'int', 0x16], ['SharedReadonly', 'int', 0x36],
    ['Reference', 'class Fixture.Owner', 6], ['Payload', 'valuetype Fixture.Value', 6], ['Private', 'int', 1], ['Protected', 'int', 4]],
  Value: [['Number', 'int', 6]],
};

/** Real non-profile CLI rows and bodies, independently authored from the transfer tables. */
export function fieldFixture(fixture) {
  const builder = new MetadataBuilder('Fields_' + fixture.name);
  const tokens = { object: builder.typeRef('System.Object'), valueType: builder.typeRef('System.ValueType') };
  const types = Object.fromEntries(definitions.map((name, index) => [name, 0x02000002 + index]));
  const resolve = name => types[name.replace(/^Fixture\./, '')] ?? builder.typeRef(name);
  const members = {};
  let method;
  builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  for (const name of definitions) {
    const parent = name === 'Derived' ? types.Owner : name === 'Value' ? tokens.valueType : tokens.object;
    builder.addRow('TypeDef', { Flags: name === 'Value' ? 0x109 : 0x100001, Name: name, Namespace: 'Fixture', Extends: parent,
      FieldList: (builder.rows[4]?.length ?? 0) + 1, MethodList: (builder.rows[6]?.length ?? 0) + 1 });
    for (const [field, type, flags] of fields[name] ?? []) {
      members[`${name}.${field}`] = builder.addRow('Field', { Flags: flags, Name: field, Signature: fieldSignature(type, resolve) });
    }
    if (name !== (fixture.owner ?? 'Host')) continue;
    method = builder.addRow('MethodDef', { RVA: 0, ImplFlags: 0, Flags: fixture.flags ?? (fixture.instance ? 0x86 : 0x96),
      Name: fixture.methodName ?? fixture.name, ParamList: 1,
      Signature: methodSignature(fixture.result ?? 'void', fixture.parameters ?? [], !fixture.instance, resolve) });
  }
  const context = { builder, tokens, types, members, method, resolve };
  fixture.decorate?.(context);
  const writer = new CilWriter();
  fixture.body(writer, context);
  const code = writer.finish();
  const locals = fixture.locals?.length ? builder.addRow('StandAloneSig', { Signature: localSignature(fixture.locals, resolve) }) : 0;
  const section = new Writer().zero(72).pad(4);
  builder.rows[6][0][0] = TEXT_RVA + section.length;
  section.u16(0x3003 | (fixture.initLocals === false ? 0 : 0x10)).u16(fixture.maxStack ?? 8).u32(code.length).u32(locals).bytes(code);
  section.pad(4);
  const offset = section.length;
  const metadata = builder.finish(undefined, new Uint8Array([8, 4, 1]));
  section.bytes(metadata);
  return { ...context, bytes: writePE(section.finish(), offset, metadata.length, 0) };
}

export function fieldAuthority(core, fixture, sameModule = false) {
  const { coreTypes } = core;
  const bindings = new Map([[fixture.tokens.object, { status: 'known', value: coreTypes.object }],
    [fixture.tokens.valueType, { status: 'known', value: coreTypes.valueType }]]);
  return { ...coreTypes, sameModule,
    resolveType: token => bindings.get(token) ?? { status: 'unknown', reason: 'unprepared-core-binding' } };
}
