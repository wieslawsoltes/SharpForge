import { AssemblyInspector, codedIndex } from '@sharpforge/cil';
import { inheritedMemberFixture } from '../a03-verifier-members/inherited-input.js';

/** Reuse the native-qualified inherited-member image, replacing only owner scopes with local TypeRef aliases. */
export function nestedMemberFixture() {
  const fixture = inheritedMemberFixture((context, tokens) => {
    const { md } = context;
    const outer = md.addRow('TypeDef', { Flags: 1, Name: 'Outer', Namespace: 'Fixture',
      Extends: md.typeRef('System.Object'), FieldList: 5, MethodList: 7 });
    for (const [child, parent] of [[tokens.middle, outer], [tokens.child, tokens.middle]]) {
      const row = md.rows[2][(child & 0xffffff) - 1];
      row[0] = (row[0] & ~7) | 2;
      row[2] = 0;
      md.addRow('NestedClass', { NestedClass: child, EnclosingClass: parent });
    }
    const reference = (name, scope = 1, namespace = '') => md.addRow('TypeRef', {
      ResolutionScope: scope, Name: name, Namespace: namespace,
    });
    const base = reference('Base', 1, 'Fixture');
    const middle = reference('Middle', reference('Outer', 1, 'Fixture'));
    const child = reference('Child', middle);
    for (const [name, owner] of Object.entries({ baseField: base, hiddenMethod: child, inheritedOverload: child,
      privateMethod: child, directConstructor: middle, inheritedField: child, inheritedConstructor: child, missing: child })) {
      const row = md.rows[10][(tokens[name] & 0xffffff) - 1];
      // Copy the existing physical name/signature indices to isolate owner normalization in this fixture.
      tokens[`${name}Alias`] = md.add(10, [codedIndex('MemberRefParent', owner), row[1], row[2]]);
    }
  });
  return { ...fixture, inspect: () => new AssemblyInspector(fixture.bytes) };
}

export const memberAliasCases = Object.freeze({
  baseFieldAlias: 0x04000001, hiddenMethodAlias: 0x06000005, inheritedOverloadAlias: 0x06000002,
  privateMethodAlias: 0x06000003, directConstructorAlias: 0x06000006,
});

export const memberAliasUnknownCases = Object.freeze({
  inheritedFieldAlias: 'ArgumentOutOfRangeException', inheritedConstructorAlias: 'MissingMethodException', missingAlias: 'MissingMethodException',
});
