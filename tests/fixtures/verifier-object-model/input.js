import { MetadataBuilder, Writer, CilWriter, methodSignature, localSignature, fieldSignature, writePE, TEXT_RVA } from '@sharpforge/cil';
import { fieldAuthority } from '../verifier-fields/input.js';

const definitions = [
  ['Owner', 'object', 0x100001], ['Derived', 'Owner', 0x100001], ['Other', 'object', 0x100001],
  ['Value', 'valueType', 0x100109], ['OtherValue', 'valueType', 0x100109], ['Choice', 'enum', 0x101],
  ['IContract', null, 0xa1], ['Abstract', 'object', 0x100081], ['Host', 'object', 0x100001],
  ['Hidden', 'object', 0x100003], ['IsByRefLikeAttribute', 'attribute', 0x100001],
];
const constructorOwners = new Set(['Owner', 'Other', 'Value', 'OtherValue', 'Abstract', 'Hidden', 'IsByRefLikeAttribute']);

function addAnnotations(input, descriptions) {
  for (const description of descriptions) {
    const owner = description.kind === 'counterfeit' ? input.types.IsByRefLikeAttribute
      : input.builder.typeRef(description.kind === 'byRefLike'
        ? 'System.Runtime.CompilerServices.IsByRefLikeAttribute' : 'System.ObsoleteAttribute');
    const constructor = description.kind === 'counterfeit' ? input.constructors.IsByRefLikeAttribute
      : input.builder.member(owner, '.ctor', methodSignature('void', [], false, input.resolve));
    input.annotations.set(constructor, description.kind === 'byRefLike');
    for (let index = 0; index < (description.count ?? 1); index++) {
      input.builder.addRow('CustomAttribute', { Parent: input.types[description.owner ?? 'Value'], Type: constructor,
        Value: Uint8Array.of(1, 0, 0, 0) });
    }
  }
}

/** Real local constructors plus one selected Test method; no #SF execution profile or compiler lowering is involved. */
export function objectFixture(fixture) {
  const builder = new MetadataBuilder('Objects_' + fixture.name);
  const tokens = { object: builder.typeRef('System.Object'), valueType: builder.typeRef('System.ValueType'),
    enum: builder.typeRef('System.Enum'), attribute: builder.typeRef('System.Attribute') };
  if (fixture.externalBase) tokens.externalBase = builder.typeRef(fixture.externalBase);
  const types = Object.fromEntries(definitions.map(([name], index) => [name, 0x02000002 + index]));
  const resolve = name => types[name.replace(/^Fixture\./, '')] ?? builder.typeRef(name);
  const bodies = [];
  const constructors = {};
  const members = {};
  const input = { builder, tokens, types, resolve, constructors, members, externalBase: fixture.externalBase, annotations: new Map() };
  function method(owner, description) {
    const signature = description.signature ?? methodSignature(description.result ?? 'void', description.parameters ?? [],
      !description.instance, resolve);
    const token = builder.addRow('MethodDef', { RVA: 0, ImplFlags: description.implFlags ?? 0,
      Flags: description.flags ?? (description.instance ? 0x86 : 0x96), Name: description.name, Signature: signature, ParamList: 1 });
    bodies.push({ owner, token, ...description });
    return token;
  }
  builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  for (const [name, parent, flags] of definitions) {
    const parentToken = name === 'Owner' && tokens.externalBase ? tokens.externalBase : types[parent] ?? tokens[parent] ?? 0;
    builder.addRow('TypeDef', { Flags: flags, Name: name, Namespace: 'Fixture', Extends: parentToken,
      FieldList: (builder.rows[4]?.length ?? 0) + 1, MethodList: (builder.rows[6]?.length ?? 0) + 1 });
    const fields = name === 'Choice' ? [['value__', 'int', 0x606]]
      : ['Owner', 'Value', 'OtherValue'].includes(name) ? [['Number', 'int', 6]] : [];
    for (const [field, type, visibility] of fields) {
      members[name + '.' + field] = builder.addRow('Field', { Flags: visibility, Name: field, Signature: fieldSignature(type, resolve) });
    }
    if (constructorOwners.has(name) || fixture.constructor?.owner === name) {
      const configured = fixture.constructor?.owner === name ? fixture.constructor : {};
      constructors[name] = method(name, { name: '.ctor', instance: true, flags: 0x1886, parameters: [], ...configured,
        body(writer) {
          writer.op('ldarg.0');
          if (parent === 'valueType') writer.op('initobj', types[name]);
          else {
            const base = parent === 'Owner' ? constructors.Owner
              : builder.member(parentToken, '.ctor', methodSignature('void', [], false, resolve));
            writer.op('call', base);
          }
          writer.op('ret');
        } });
    }
    if (name === 'Owner') input.ordinary = method(name, { name: 'Ordinary', instance: true, body: writer => writer.op('ret') });
    if (name === (fixture.owner ?? 'Host')) {
      input.method = method(name, { ...fixture, name: fixture.methodName ?? 'Test', parameters: fixture.parameters ?? [],
        body: fixture.body ?? (writer => writer.op('ret')) });
    }
  }
  builder.addRow('NestedClass', { NestedClass: types.Hidden, EnclosingClass: types.Owner });
  for (const name of ['Owner', 'Value']) builder.addRow('InterfaceImpl', { Class: types[name], Interface: types.IContract });
  addAnnotations(input, fixture.annotations ?? []);
  fixture.decorate?.(input);
  const section = new Writer().zero(72);
  for (const body of bodies) {
    if (body.noBody) continue;
    const writer = new CilWriter();
    body.body(writer, input);
    const code = writer.finish();
    const locals = body.locals?.length ? builder.addRow('StandAloneSig', { Signature: localSignature(body.locals, resolve) }) : 0;
    section.pad(4);
    builder.rows[6][(body.token & 0xffffff) - 1][0] = TEXT_RVA + section.length;
    section.u16(0x3003 | (body.initLocals === false ? 0 : 0x10)).u16(body.maxStack ?? 8).u32(code.length).u32(locals).bytes(code);
  }
  section.pad(4);
  const offset = section.length;
  const metadata = builder.finish(undefined, Uint8Array.of(8, 3, 7, 5));
  section.bytes(metadata);
  return { ...input, bytes: writePE(section.finish(), offset, metadata.length, 0) };
}

export function objectAuthority(core, input) {
  const authority = fieldAuthority(core, input);
  const bindings = new Map([[input.tokens.enum, { status: 'known', value: core.coreTypes.enum }]]);
  if (input.tokens.externalBase && core.externalTypes?.has(input.externalBase))
    bindings.set(input.tokens.externalBase, { status: 'known', value: core.externalTypes.get(input.externalBase) });
  return { ...authority, resolveType: token => bindings.get(token) ?? authority.resolveType(token) };
}

/** Fixture host supplies exact constructor-token facts for this emitted module; spelling conveys no authority. */
export function objectAnnotations(input) {
  return { classifyConstructor(token) {
    return input.annotations.has(token) ? { status: 'known', value: { byRefLike: input.annotations.get(token) } }
      : { status: 'unknown', reason: 'constructor-identity-unprepared' };
  } };
}
