const scenarios = [
  ['public', 'Other', 'Owner', true, true],
  ['private', 'Owner', 'Owner', true, true],
  ['private', 'Other', 'Owner', false, false],
  ['assembly', 'Other', 'Owner', true, true],
  ['famorassem', 'Other', 'Owner', true, true],
  ['family', 'Derived', 'Derived', true, true],
  ['family', 'Derived', 'Owner', false, 'unknown'],
  ['famandassem', 'Derived', 'Further', true, true],
];
export const nativeCases = ['field', 'method'].flatMap(kind => [
  ...scenarios.map(([access, accessor, receiver, accepted, query]) => ({ kind, access, accessor, receiver, accepted, query })),
  { kind, access: 'family', accessor: 'Derived', receiver: null, accepted: true, query: true, isStatic: true },
]).map((fixture, index) => ({ ...fixture, name: `Access${index}` }));

/** The receiver's declared type is an IL parameter; no invalid case is ever executed. */
export function accessIL(fixture) {
  const storage = fixture.isStatic ? 'static ' : '';
  const member = fixture.kind === 'field'
    ? `.field ${fixture.access} ${storage}int32 Target`
    : `.method ${fixture.access} ${fixture.isStatic ? 'static' : 'instance'} void Target() cil managed { .maxstack 0 ret }`;
  const instruction = fixture.kind === 'field'
    ? `${fixture.isStatic ? 'ldsfld' : 'ldfld'} int32 Owner::Target pop`
    : `call ${fixture.isStatic ? '' : 'instance '}void Owner::Target()`;
  const test = `.method public static void Test(${fixture.receiver ? `class ${fixture.receiver} receiver` : ''}) cil managed {
    .maxstack 1 ${fixture.isStatic ? '' : 'ldarg.0'} ${instruction} ret
  }`;
  const definitions = [['Owner', '[System.Runtime]System.Object'], ['Derived', 'Owner'],
    ['Further', 'Derived'], ['Other', '[System.Runtime]System.Object']];
  return `.assembly extern System.Runtime {}\n.assembly ${fixture.name} {}\n.module ${fixture.name}.dll\n` +
    definitions.map(([name, parent]) => `.class public auto ansi ${name} extends ${parent} {
      ${name === 'Owner' ? member : ''}
      ${name === fixture.accessor ? test : ''}
    }`).join('\n') + '\n';
}
