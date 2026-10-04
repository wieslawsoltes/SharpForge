import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature } from '@sharpforge/cil';
import { AssemblyLoadSession, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';

const primitive = name => ({ kind: 'primitive', name });
const named = token => ({ kind: 'class', token });
const generic = (token, argumentsList) => ({ kind: 'genericInstance', type: named(token), arguments: argumentsList });
async function fixture({ reference = false, outerName = 'Outer', innerName = 'Inner', nestedGeneric = false, standalone = false } = {}) {
  const image = managedFixture({ entry: null, methods: [{ name: 'M', flags: 0x16, noBody: true }], decorate({ md }) {
    let inner;
    if (reference) {
      const outer = md.typeRef(`Fixture.${outerName}`);
      inner = md.add(1, [codedIndex('ResolutionScope', outer), md.string(innerName), 0]);
    } else {
      const outer = md.add(2, [1, md.string(outerName), md.string('Fixture'), 0, 1, 2]);
      inner = md.add(2, [2, md.string(innerName), 0, 0, 1, 2]);
      md.add(41, [inner & 0xffffff, outer & 0xffffff]);
      if (nestedGeneric) for (const [token, names] of [[outer, ['T']], [inner, ['T', 'U']]]) {
        names.forEach((name, index) => md.add(42, [index, 0, codedIndex('TypeOrMethodDef', token), md.string(name)]));
      }
    }
    const box = md.add(2, [1, md.string('Box`1'), md.string('Fixture'), 0, 1, 2]);
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', box), md.string('T')]);
    const argument = nestedGeneric ? generic(inner, [primitive('int'), primitive('string')]) : named(inner);
    const returnType = standalone ? argument : generic(box, [argument]);
    md.rows[6][0][4] = md.blob(encodeSignature({ kind: 'method', returnType, parameters: [] }));
  } });
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  return (await context.loadFromStream(image)).manifestModule;
}

test('CLR nested generic arguments retain qualified enclosing names for both TypeDef and TypeRef metadata', async () => {
  for (const reference of [false, true]) {
    const module = await fixture({ reference });
    assert.equal(module.methodDefinition(0x06000001).toString(), 'Fixture.Box`1[Fixture.Outer+Inner] M()');
    assert.equal(module.methodBodyReadCount, 0);
    assert.equal(module.assembly.loadContext.assemblies.length, 1);
  }
});

test('CLR nested generic arguments retain inherited and own argument positions while outermost nested names stay simple', async () => {
  for (const reference of [false, true]) {
    const options = { reference, nestedGeneric: true, outerName: 'Outer`1', innerName: 'Inner`1' };
    const module = await fixture(options);
    const method = module.methodDefinition(0x06000001);
    assert.equal(method.toString(), 'Fixture.Box`1[Fixture.Outer`1+Inner`1[System.Int32,System.String]] M()');
    module.assembly.loadContext.unload();
    assert.equal(String(method), 'Fixture.Box`1[Fixture.Outer`1+Inner`1[System.Int32,System.String]] M()');
    const standalone = await fixture({ ...options, standalone: true });
    assert.equal(standalone.methodDefinition(0x06000001).toString(), 'Inner`1 M()');
  }
});

test('CLR qualified nested arguments reject reserved identifiers in every ancestor instead of inventing escaping', async () => {
  for (const reference of [false, true]) for (const outerName of ['Out+er', 'Out,er', 'Out[er', 'Out&er', 'Out*er', 'Out\\er']) {
    const module = await fixture({ reference, outerName });
    assert.throws(() => module.methodDefinition(0x06000001).toString(), error => error.code === LoadErrorCode.TypeLoad);
    // Reflection's outermost nested Name does not include its ancestor, so that independent spelling remains available.
    const simple = await fixture({ reference, outerName, standalone: true });
    assert.equal(simple.methodDefinition(0x06000001).toString(), 'Inner M()');
  }
});
