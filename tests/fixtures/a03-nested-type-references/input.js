import { AssemblyInspector, MetadataBuilder, fieldSignature } from '@sharpforge/cil';
import { metadataImage } from '../a03-metadata/fixture.js';

/** Local nested definitions, including identical names under unrelated enclosing identities. */
export function nestedReferenceFixture() {
  const builder = new MetadataBuilder('NestedTypeReferences');
  const tokens = {};
  const definition = (name, owner = 0, base = tokens.object, flags = owner ? 2 : 1) => {
    const token = builder.addRow('TypeDef', { Flags: flags, Name: name, Namespace: owner ? '' : 'Fixture',
      Extends: base, FieldList: (builder.rows[4]?.length ?? 0) + 1, MethodList: 1 });
    if (owner) builder.addRow('NestedClass', { NestedClass: token, EnclosingClass: owner });
    return token;
  };
  const reference = (name, owner = 1, namespace = owner === 1 ? 'Fixture' : '') => builder.addRow('TypeRef', {
    ResolutionScope: owner, Name: name, Namespace: namespace,
  });
  tokens.object = builder.typeRef('System.Object');
  builder.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  tokens.Outer = definition('Outer');
  tokens.outer = reference('Outer');
  tokens.Middle = definition('Middle', tokens.Outer);
  tokens.middle = reference('Middle', tokens.outer);
  tokens.Base = definition('Base', tokens.Outer);
  tokens.base = reference('Base', tokens.outer);
  tokens.Leaf = definition('Leaf', tokens.Middle, tokens.base);
  tokens.leaf = reference('Leaf', tokens.middle);
  tokens.value = builder.addRow('Field', { Flags: 0x16, Name: 'Value', Signature: fieldSignature('int') });
  tokens.valueReference = builder.member(tokens.leaf, 'Value', fieldSignature('int'));
  tokens.Derived = definition('Derived', 0, tokens.leaf);
  tokens.Contract = definition('IContract', tokens.Outer, 0, 0xa2);
  tokens.contract = reference('IContract', tokens.outer);
  builder.addRow('InterfaceImpl', { Class: tokens.Leaf, Interface: tokens.contract });
  tokens.Secret = definition('Secret', tokens.Outer, tokens.object, 3);
  tokens.secret = reference('Secret', tokens.outer);
  tokens.OtherOuter = definition('OtherOuter');
  tokens.otherOuter = reference('OtherOuter');
  tokens.OtherMiddle = definition('Middle', tokens.OtherOuter);
  tokens.otherMiddle = reference('Middle', tokens.otherOuter);
  tokens.OtherLeaf = definition('Leaf', tokens.OtherMiddle);
  tokens.otherLeaf = reference('Leaf', tokens.otherMiddle);
  tokens.TopLevelLeaf = definition('Leaf');
  tokens.Unicode = definition('Żółć', tokens.Outer);
  tokens.unicode = reference('Żółć', tokens.outer);
  tokens.Bom = definition('\ufeffŻółć', tokens.Outer);
  tokens.bom = reference('\ufeffŻółć', tokens.outer);
  tokens.leafForward = reference('Leaf', 0x01000000 + builder.rows[1].length + 2);
  tokens.middleForward = reference('Middle', tokens.outer);
  tokens.Open = definition('Open`1', tokens.Outer);
  builder.addRow('GenericParam', { Number: 0, Flags: 0, Owner: tokens.Open, Name: 'T' });
  tokens.open = reference('Open`1', tokens.outer);
  tokens.InOpen = definition('InOpen', tokens.Open);
  tokens.inOpen = reference('InOpen', tokens.open);
  tokens.external = builder.typeRef('Fixture.Outer', 'Other.Assembly');
  tokens.externalNested = reference('Middle', tokens.external);
  tokens.externalMember = builder.member(tokens.externalNested, 'Value', fieldSignature('int'));
  tokens.genericMember = builder.member(tokens.open, 'Value', fieldSignature('int'));
  tokens.nilOuter = reference('Outer', 0, 'Fixture');
  tokens.nilNested = reference('Middle', tokens.nilOuter);
  tokens.wrongEnclosing = reference('Leaf', tokens.outer);
  tokens.wrongNamespace = reference('Leaf', tokens.middle, 'Wrong');
  tokens.wrongCase = reference('leaf', tokens.middle);
  tokens.missing = reference('Missing', tokens.middle);
  return { builder, tokens, definition, reference,
    bytes: () => metadataImage(builder), inspect: () => new AssemblyInspector(metadataImage(builder)) };
}

export const nestedReferenceCases = Object.freeze({
  middle: 'Middle', base: 'Base', leaf: 'Leaf', contract: 'Contract', secret: 'Secret',
  otherMiddle: 'OtherMiddle', otherLeaf: 'OtherLeaf', unicode: 'Unicode', bom: 'Bom',
  leafForward: 'Leaf', middleForward: 'Middle',
});
