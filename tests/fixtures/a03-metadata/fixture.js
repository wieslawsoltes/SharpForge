import { MetadataBuilder, Writer, writePE } from '@sharpforge/cil';

/** One complete structural fixture; signatures are ordinary CLI, with no executable method bodies. */
export function metadataFixture() {
  const builder = new MetadataBuilder('MetadataRows');
  const reference = builder.typeRef('System.Object');
  const module = builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  const owner = builder.addRow('TypeDef', { Flags: 0x11, Name: 'Owner', Namespace: 'Fixture',
    Extends: reference, FieldList: 1, MethodList: 1 });
  const nested = builder.addRow('TypeDef', { Flags: 2, Name: 'Nested', Namespace: '',
    Extends: reference, FieldList: 2, MethodList: 2 });
  const iface = builder.addRow('TypeDef', { Flags: 0xa1, Name: 'IContract', Namespace: 'Fixture',
    Extends: 0, FieldList: 2, MethodList: 2 });
  const field = builder.definitions.field({ Flags: 0x16, Name: 'Number', Signature: new Uint8Array([6, 8]) });
  const method = builder.definitions.method({ RVA: 0, ImplFlags: 0x80, Flags: 0x2016,
    Name: 'Import', Signature: new Uint8Array([0, 1, 1, 8]), ParamList: 1 });
  const param = builder.definitions.parameter({ Flags: 1, Sequence: 1, Name: 'value' });
  builder.addRow('InterfaceImpl', { Class: owner, Interface: iface });
  const constructor = builder.addRow('MemberRef', { Class: reference, Name: '.ctor', Signature: new Uint8Array([0x20, 0, 1]) });
  builder.definitions.constant({ Type: 8, Parent: field, Value: new Uint8Array([42, 0, 0, 0]) });
  builder.addRow('CustomAttribute', { Parent: owner, Type: constructor, Value: new Uint8Array([1, 0, 0, 0]) });
  builder.interop.fieldMarshal({ Parent: param, NativeType: new Uint8Array([7]) });
  builder.interop.declSecurity({ Action: 2, Parent: 0x20000001, PermissionSet: new Uint8Array([0x2e, 0]) });
  builder.definitions.classLayout({ PackingSize: 4, ClassSize: 4, Parent: owner });
  builder.definitions.fieldLayout({ Offset: 0, Field: field });
  builder.definitions.fieldRVA({ RVA: 0x3000, Field: field });
  builder.addRow('StandAloneSig', { Signature: new Uint8Array([7, 1, 8]) });
  const event = builder.interop.event({ EventFlags: 0, Name: 'Changed', EventType: reference });
  builder.interop.eventMap({ Parent: owner, EventList: event });
  const property = builder.addRow('Property', { Flags: 0, Name: 'Value', Type: new Uint8Array([8, 0, 8]) });
  builder.addRow('PropertyMap', { Parent: owner, PropertyList: property });
  builder.interop.methodSemantics({ Semantics: 2, Method: method, Association: property });
  builder.definitions.methodImpl({ Class: owner, MethodBody: method, MethodDeclaration: method });
  const native = builder.manifest.moduleRef({ Name: 'native' });
  builder.addRow('TypeSpec', { Signature: new Uint8Array([0x1d, 8]) });
  builder.interop.implMap({ MappingFlags: 0x101, MemberForwarded: method, ImportName: 'native_method', ImportScope: native });
  const file = builder.manifest.file({ Flags: 1, Name: 'linked.bin', HashValue: new Uint8Array([1, 2, 3]) });
  builder.manifest.exportedType({ Flags: 0x200001, TypeDefId: 0, TypeName: 'Forwarded', TypeNamespace: 'Fixture',
    Implementation: 0x23000001 });
  builder.manifest.manifestResource({ Offset: 0, Flags: 1, Name: 'Resource', Implementation: file });
  builder.definitions.nestedClass({ NestedClass: nested, EnclosingClass: owner });
  const generic = builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: owner, Name: 'T' });
  builder.addRow('MethodSpec', { Method: method, Instantiation: new Uint8Array([10, 1, 8]) });
  builder.addRow('GenericParamConstraint', { Owner: generic, Constraint: reference });
  return { builder, module, owner, nested, iface, field, method, param };
}

export function metadataImage(builder) {
  const metadata = builder.finish();
  const section = new Writer().zero(72).bytes(metadata).finish();
  return writePE(section, 72, metadata.length, 0);
}
