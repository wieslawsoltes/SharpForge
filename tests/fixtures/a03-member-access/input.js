import { MetadataBuilder, methodSignature, fieldSignature } from '@sharpforge/cil';
import { metadataImage } from '../a03-metadata/fixture.js';

/** Closed local hierarchy for known negative relations; native fixtures keep System.Object unresolved explicitly. */
export function accessFixture(decorate) {
  const md = new MetadataBuilder('MemberAccess');
  const types = {}, members = {}, references = {};
  function type(name, parent = 0, flags = 1) {
    const result = md.addRow('TypeDef', { Flags: flags, Name: name, Namespace: 'Fixture', Extends: parent,
      FieldList: (md.rows[4]?.length ?? 0) + 1, MethodList: (md.rows[6]?.length ?? 0) + 1 });
    types[name] = result;
    return result;
  }
  type('<Module>', 0, 0);
  const root = type('Root');
  const owner = type('Owner', root);
  for (const isStatic of [false, true]) for (let access = 0; access <= 6; access++) {
    for (const kind of ['field', 'method']) {
      const name = `${isStatic ? 'Static' : 'Instance'}${access}${kind}`;
      const flags = access | (isStatic ? 0x10 : 0);
      const signature = kind === 'field' ? fieldSignature('int') : methodSignature('void', [], isStatic);
      members[name] = kind === 'field'
        ? md.addRow('Field', { Flags: flags, Name: name, Signature: signature })
        : md.addRow('MethodDef', { RVA: 0, ImplFlags: 0x80, Flags: flags, Name: name, Signature: signature, ParamList: 1 });
      references[name] = md.member(owner, name, signature);
    }
  }
  const derived = type('Derived', owner);
  type('Further', derived);
  type('Sibling', owner);
  type('Other', root, 0);
  const nested = type('Nested', owner, 2);
  members.nested = md.addRow('Field', { Flags: 6, Name: 'NestedMember', Signature: fieldSignature('int') });
  md.definitions.nestedClass({ NestedClass: nested, EnclosingClass: owner });
  type('Interface', 0, 0xa1);
  members.interface = md.addRow('Field', { Flags: 4, Name: 'InterfaceMember', Signature: fieldSignature('int') });
  const generic = type('Generic', root);
  md.addRow('GenericParam', { Number: 0, Flags: 0, Owner: generic, Name: 'T' });
  type('UnresolvedBase', md.typeRef('Unknown.Base', 'Other.Assembly'));
  decorate?.({ md, types, members, references });
  return { bytes: metadataImage(md), types, members, references };
}
