const scenarios = [
  ['TopInternal', 'Other', true, true],
  ['Outer', 'Other', true, true],
  ['PrivateChild', 'Outer', true, true],
  ['PrivateChild', 'Other', false, false],
  ['PrivateChild', 'Sibling', true, true],
  ['PublicChild', 'Other', true, true],
  ['PublicInPrivate', 'Other', false, false],
  ['FamilyChild', 'Derived', true, true],
  ['FamilyChild', 'NestedDerived', true, true],
  ['FamilyChild', 'Other', false, 'unknown'],
  ['AssemblyChild', 'Other', true, true],
  ['FamOrChild', 'Other', true, true],
  ['FamAndChild', 'Derived', true, true],
  ['FamAndChild', 'Other', false, 'unknown'],
];
export const nativeCases = scenarios.map(([target, accessor, accepted, query], index) =>
  ({ target, accessor, accepted, query, name: 'TypeAccess' + index }));

/** Each fixture verifies one castclass use, with no member access obscuring type visibility. */
export function typeAccessIL(fixture) {
  const names = { TopInternal: 'TopInternal', Outer: 'Outer', PrivateChild: 'Outer/PrivateChild',
    PublicChild: 'Outer/PublicChild', PublicInPrivate: 'Outer/PrivateChild/PublicInPrivate',
    FamilyChild: 'Outer/FamilyChild', AssemblyChild: 'Outer/AssemblyChild',
    FamOrChild: 'Outer/FamOrChild', FamAndChild: 'Outer/FamAndChild' };
  const test = `.method public static void Test() cil managed {
    .maxstack 1 ldnull castclass ${names[fixture.target]} pop ret
  }`;
  function type(name, visibility, base = '[System.Runtime]System.Object', children = '') {
    return `.class ${visibility} auto ansi ${name} extends ${base} {
      ${name === fixture.accessor ? test : ''} ${children}
    }`;
  }
  const privateChild = type('PrivateChild', 'nested private', undefined, type('PublicInPrivate', 'nested public'));
  const children = privateChild + type('PublicChild', 'nested public') + type('Sibling', 'nested public') +
    type('FamilyChild', 'nested family') + type('AssemblyChild', 'nested assembly') +
    type('FamOrChild', 'nested famorassem') + type('FamAndChild', 'nested famandassem');
  return `.assembly extern System.Runtime {}\n.assembly ${fixture.name} {}\n.module ${fixture.name}.dll\n` +
    type('TopInternal', 'private') + type('Outer', 'public', undefined, children) +
    type('Derived', 'public', 'Outer', type('NestedDerived', 'nested public')) + type('Other', 'public') + '\n';
}
