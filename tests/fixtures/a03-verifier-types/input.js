import { AssemblyInspector, MetadataBuilder } from '@sharpforge/cil';
import { metadataImage } from '../a03-metadata/fixture.js';

/** Synthetic hierarchy metadata, not a claim that arbitrary baseless classes are loadable. */
export function typeSystemFixture() {
  const builder = new MetadataBuilder('VerifierTypes');
  const tokens = {};
  const add = (name, base = 0, flags = 1) => {
    tokens[name] = builder.addRow('TypeDef', { Flags: flags, Name: name, Namespace: 'Fixture',
      Extends: base, FieldList: 1, MethodList: 1 });
    return tokens[name];
  };
  add('<Module>', 0, 0);
  const root = add('Root');
  const parent = add('Parent', root);
  add('Left', parent);
  add('Right', parent);
  add('Other', root);
  const contract = add('IContract', 0, 0xa1);
  const child = add('IChild', 0, 0xa1);
  add('IUnrelated', 0, 0xa1);
  builder.addRow('InterfaceImpl', { Class: child, Interface: contract });
  builder.addRow('InterfaceImpl', { Class: parent, Interface: child });
  tokens.external = builder.typeRef('Fixture.Parent', 'Another.Assembly');
  add('ExternalChild', tokens.external);
  add('Open');
  builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: tokens.Open, Name: 'T' });
  tokens.array = builder.typeSpec({ kind: 'szarray', element: { kind: 'class', token: parent } });
  return { builder, tokens, inspect: () => new AssemblyInspector(metadataImage(builder)) };
}
