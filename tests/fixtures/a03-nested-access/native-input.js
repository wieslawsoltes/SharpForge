const scenarios = [
  ['Outer', 'private', 'Inner', null, true, true],
  ['Outer', 'private', 'Deep', null, true, true],
  ['Inner', 'private', 'Outer', null, false, false],
  ['Inner', 'private', 'Sibling', null, false, false],
  ['PrivateChild', 'public', 'Outer', null, true, true],
  ['PrivateChild', 'public', 'Other', null, false, false],
  ['PrivateChild', 'public', 'Sibling', null, true, true],
  ['PublicChild', 'public', 'Other', null, true, true],
  ['PublicInPrivate', 'public', 'Other', null, false, false],
  ['Outer', 'family', 'NestedDerived', 'Derived', true, true],
  ['Outer', 'family', 'NestedDerived', 'Outer', false, 'unknown'],
  ['FamilyChild', 'public', 'Derived', null, true, true],
];
export const nativeCases = ['field', 'method'].flatMap(kind => scenarios.map(
  ([owner, access, accessor, receiver, accepted, query]) => ({ kind, owner, access, accessor, receiver, accepted, query }),
)).map((fixture, index) => ({ ...fixture, name: 'Nested' + index }));

/** Target names are unique; only Test is verified and no invalid fixture is executed. */
export function nestedIL(fixture) {
  const names = { Outer: 'Outer', Inner: 'Outer/Inner', Deep: 'Outer/Inner/Deep', Sibling: 'Outer/Sibling',
    PrivateChild: 'Outer/PrivateChild', PublicChild: 'Outer/PublicChild', PublicInPrivate: 'Outer/PrivateChild/PublicInPrivate',
    FamilyChild: 'Outer/FamilyChild', Derived: 'Derived', NestedDerived: 'Derived/NestedDerived', Other: 'Other' };
  const isStatic = !fixture.receiver;
  const member = fixture.kind === 'field'
    ? `.field ${fixture.access} ${isStatic ? 'static ' : ''}int32 Target`
    : `.method ${fixture.access} ${isStatic ? 'static' : 'instance'} void Target() cil managed { .maxstack 0 ret }`;
  const instruction = fixture.kind === 'field'
    ? `${isStatic ? 'ldsfld' : 'ldfld'} int32 ${names[fixture.owner]}::Target pop`
    : `call ${isStatic ? '' : 'instance '}void ${names[fixture.owner]}::Target()`;
  const test = `.method public static void Test(${fixture.receiver ? 'class ' + names[fixture.receiver] + ' receiver' : ''}) cil managed {
    .maxstack 1 ${isStatic ? '' : 'ldarg.0'} ${instruction} ret
  }`;
  function type(name, visibility, base = '[System.Runtime]System.Object', children = '') {
    return `.class ${visibility} auto ansi ${name} extends ${base} {
      ${name === fixture.owner ? member : ''} ${name === fixture.accessor ? test : ''} ${children}
    }`;
  }
  const inner = type('Inner', 'nested public', undefined, type('Deep', 'nested public'));
  const privateChild = type('PrivateChild', 'nested private', undefined, type('PublicInPrivate', 'nested public'));
  const outer = type('Outer', 'public', undefined, inner + privateChild + type('Sibling', 'nested public') +
    type('PublicChild', 'nested public') + type('FamilyChild', 'nested family'));
  return `.assembly extern System.Runtime {}\n.assembly ${fixture.name} {}\n.module ${fixture.name}.dll\n` +
    outer + type('Derived', 'public', 'Outer', type('NestedDerived', 'nested public')) + type('Other', 'public') + '\n';
}
