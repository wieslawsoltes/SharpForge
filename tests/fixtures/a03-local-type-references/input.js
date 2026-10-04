import { AssemblyInspector, MetadataBuilder } from '@sharpforge/cil';
import { metadataImage } from '../a03-metadata/fixture.js';

/** Real CLI rows with explicit Module scopes and local-reference hierarchy edges. */
export function localReferenceFixture() {
  const builder = new MetadataBuilder('LocalTypeReferences');
  const tokens = {};
  const definition = (name, namespace = 'Fixture', base = 0, flags = 1) => builder.addRow('TypeDef', {
    Flags: flags, Name: name, Namespace: namespace, Extends: base, FieldList: 1, MethodList: 1,
  });
  const reference = (name, namespace = 'Fixture', scope = 1) => builder.addRow('TypeRef', {
    ResolutionScope: scope, Name: name, Namespace: namespace,
  });
  tokens.object = builder.typeRef('System.Object');
  definition('<Module>', '', 0, 0);
  tokens.Parent = definition('Parent', 'Fixture', tokens.object);
  tokens.parent = reference('Parent');
  tokens.parentAgain = reference('Parent');
  tokens.Child = definition('Child', 'Fixture', tokens.parent);
  tokens.child = reference('Child');
  tokens.Sibling = definition('Sibling', 'Fixture', tokens.parentAgain);
  tokens.IRoot = definition('IRoot', 'Fixture', 0, 0xa1);
  tokens.rootInterface = reference('IRoot');
  tokens.IChild = definition('IChild', 'Fixture', 0, 0xa1);
  tokens.childInterface = reference('IChild');
  builder.addRow('InterfaceImpl', { Class: tokens.IChild, Interface: tokens.rootInterface });
  builder.addRow('InterfaceImpl', { Class: tokens.Parent, Interface: tokens.childInterface });
  tokens.OtherParent = definition('Parent', 'Other', tokens.object);
  tokens.otherParent = reference('Parent', 'Other');
  tokens.Global = definition('Global', '', tokens.object, 0);
  tokens.global = reference('Global', '');
  tokens.Unicode = definition('Żółć', 'Zażółć', tokens.object);
  tokens.unicode = reference('Żółć', 'Zażółć');
  tokens.Bom = definition('\ufeffParent', 'Fixture', tokens.object);
  tokens.bom = reference('\ufeffParent');
  tokens.Open = definition('Open`1', 'Fixture', tokens.object);
  builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: tokens.Open, Name: 'T' });
  tokens.open = reference('Open`1');
  tokens.Nested = definition('Nested', '', tokens.object, 2);
  builder.addRow('NestedClass', { NestedClass: tokens.Nested, EnclosingClass: tokens.Parent });
  tokens.nested = reference('Nested', '', tokens.parent);
  tokens.nestedAsTopLevel = reference('Nested', '');
  tokens.nil = reference('Parent', 'Fixture', 0);
  tokens.module = reference('Parent', 'Fixture', builder.manifest.moduleRef({ Name: 'Other.netmodule' }));
  tokens.assembly = reference('Parent', 'Fixture', builder.assemblyRef('Other.Assembly'));
  tokens.missing = reference('Absent');
  tokens.wrongCase = reference('parent');
  tokens.wrongNamespace = reference('Parent', 'fixture');
  tokens.moduleType = reference('<Module>', '');
  return { builder, tokens, reference, definition,
    bytes: () => metadataImage(builder), inspect: () => new AssemblyInspector(metadataImage(builder)) };
}

export const localReferenceCases = Object.freeze({
  parent: 'Parent', parentAgain: 'Parent', child: 'Child', rootInterface: 'IRoot', childInterface: 'IChild',
  otherParent: 'OtherParent', global: 'Global', unicode: 'Unicode', bom: 'Bom',
});
