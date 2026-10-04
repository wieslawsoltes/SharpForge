import { AssemblyInspector, MetadataBuilder, Writer, writePE, codedIndex } from '@sharpforge/cil';

export function builder(name, mvid, options = {}) {
  const metadata = new MetadataBuilder(name, { assemblyVersion: [1, 0, 0, 0], ...options });
  metadata.rows[0][0][2] = metadata.guid(Uint8Array.from({ length: 16 }, (_, index) => index === 15 ? mvid : index + 1));
  metadata.add(2, [0, metadata.string('<Module>'), 0, 0, 1, 1]);
  return metadata;
}
export function type(metadata, name, base = 0, flags = 1, namespace = 'Hierarchy') {
  return metadata.add(2, [flags, metadata.string(name), metadata.string(namespace), base ? codedIndex('TypeDefOrRef', base) : 0, 1, 1]);
}
export function assemblyReference(metadata, name, { version = [1, 0, 0, 0], culture = '', key = new Uint8Array(), flags = 0 } = {}) {
  return metadata.add(35, [...version, flags, metadata.blob(key), metadata.string(name), metadata.string(culture), 0]);
}
export function reference(metadata, scope, name, namespace = 'Hierarchy') {
  return metadata.add(1, [scope ? codedIndex('ResolutionScope', scope) : 0, metadata.string(name), metadata.string(namespace)]);
}
export function implementsType(metadata, owner, target) { metadata.add(9, [owner & 0xffffff, codedIndex('TypeDefOrRef', target)]); }
export function inspector(metadata) {
  const data = metadata.finish(), section = new Writer().zero(72).bytes(data).finish();
  return new AssemblyInspector(writePE(section, 72, data.length, 0));
}
export function hierarchyFixture() {
  const a = builder('Hierarchy.A', 31), base = type(a, 'Base'), root = type(a, 'IRoot', 0, 0xa1);
  const contract = type(a, 'IChild', 0, 0xa1), outer = type(a, 'Outer'), inner = type(a, 'Inner', 0, 2, '');
  a.add(41, [inner & 0xffffff, outer & 0xffffff]);
  implementsType(a, contract, root);
  type(a, 'Outer+Inner'); // A display-name lookalike must not replace a nested definition.
  const b = builder('Hierarchy.B', 32), assembly = assemblyReference(b, 'Hierarchy.A');
  const baseReference = reference(b, assembly, 'Base'), interfaceReference = reference(b, assembly, 'IChild');
  const outerReference = reference(b, assembly, 'Outer'), innerReference = reference(b, outerReference, 'Inner', '');
  const derived = type(b, 'Derived', baseReference), further = type(b, 'Further', derived), nested = type(b, 'NestedDerived', innerReference);
  implementsType(b, derived, interfaceReference);
  return { a, b, tokens: { base, root, contract, outer, inner, derived, further, nested, baseReference, interfaceReference } };
}
