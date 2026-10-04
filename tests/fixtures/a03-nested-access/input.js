import { MetadataBuilder, methodSignature, fieldSignature } from '@sharpforge/cil';
import { metadataImage } from '../a03-metadata/fixture.js';

/** Closed inheritance and independent lexical nesting; every type has the same access-flag matrix. */
export function nestedFixture(decorate) {
  const md = new MetadataBuilder('NestedAccess');
  const types = {}, members = {};
  function type(name, { base = types.Root ?? 0, enclosing, visibility = 2 } = {}) {
    const token = md.addRow('TypeDef', { Flags: enclosing ? visibility : 1, Name: name, Namespace: '', Extends: base,
      FieldList: (md.rows[4]?.length ?? 0) + 1, MethodList: (md.rows[6]?.length ?? 0) + 1 });
    types[name] = token;
    if (enclosing) md.definitions.nestedClass({ NestedClass: token, EnclosingClass: enclosing });
    for (const isStatic of [false, true]) for (let access = 0; access <= 6; access++) {
      for (const kind of ['field', 'method']) {
        const memberName = `${isStatic ? 'Static' : 'Instance'}${access}${kind}`;
        const flags = access | (isStatic ? 0x10 : 0);
        const signature = kind === 'field' ? fieldSignature('int') : methodSignature('void', [], isStatic);
        members[name + '.' + memberName] = kind === 'field'
          ? md.addRow('Field', { Flags: flags, Name: memberName, Signature: signature })
          : md.addRow('MethodDef', { RVA: 0, ImplFlags: 0x80, Flags: flags, Name: memberName, Signature: signature, ParamList: 1 });
      }
    }
    return token;
  }
  md.addRow('TypeDef', { Flags: 0, Name: '<Module>', Namespace: '', Extends: 0, FieldList: 1, MethodList: 1 });
  type('Root');
  const outer = type('Outer');
  const inner = type('Inner', { enclosing: outer });
  type('Deep', { enclosing: inner });
  type('Sibling', { enclosing: outer });
  for (let visibility = 2; visibility <= 7; visibility++) type('Visibility' + visibility, { enclosing: outer, visibility });
  type('PublicInPrivate', { enclosing: types.Visibility3 });
  const derived = type('Derived', { base: outer });
  type('NestedDerived', { enclosing: derived });
  const other = type('Other');
  type('NestedReceiver', { enclosing: other, base: derived });
  type('OtherNested', { enclosing: other });
  const generic = type('Generic');
  md.addRow('GenericParam', { Number: 0, Flags: 0, Owner: generic, Name: 'T' });
  type('InGeneric', { enclosing: generic });
  decorate?.({ md, types, members, type });
  return { bytes: metadataImage(md), types, members };
}
