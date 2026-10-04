import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature, encodeTypeSignature } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { OverrideSignatures } from '../packages/clr/src/type-system/override-signature.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

const variable = { kind: 'genericParameter', scope: 'method', index: 0 };
const signature = encodeSignature({ kind: 'method', hasThis: true, genericArity: 1, returnType: variable, parameters: [variable] });
const fails = code => error => error.code === code;
const load = async (context, image) => (await context.loadFromStream(image)).manifestModule;
function genericMethod(md, row, flags, constraints = []) {
  md.rows[6][row][4] = md.blob(signature);
  const parameter = md.add(42, [0, flags, codedIndex('TypeOrMethodDef', 0x06000001 + row), md.string(`T${row}`)]);
  for (const token of constraints) md.add(44, [parameter & 0xffffff, codedIndex('TypeDefOrRef', token)]);
}
function constrainedFixture(decorate = () => {}) {
  return hierarchyFixture(({ md }) => {
    const first = md.add(2, [0xa1, md.string('IFirst'), md.string('Fixture'), 0, 1, 10]);
    const second = md.add(2, [0xa1, md.string('ISecond'), md.string('Fixture'), 0, 1, 10]);
    for (const row of [0, 3, 6]) genericMethod(md, row, 4, [first]);
    decorate(md, first, second);
  });
}

test('CLR constrained method overrides retain canonical roots, cached results and unloaded identity', async () => {
  for (const flags of [4, 16, 24]) {
    const context = baseContext({ isCollectible: true });
    const module = await load(context, constrainedFixture(md => {
      for (const row of md.rows[42]) row[1] = flags;
    }));
    const method = module.methodDefinition(0x06000007), root = module.methodDefinition(0x06000001);
    assert.equal(await method.getBaseDefinition(), root);
    assert.equal(await method.getBaseDefinition(), root);
    assert.equal(module.methodBodyReadCount, 0);
    context.unload();
    assert.equal(await method.getBaseDefinition(), root);
    await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), fails(LoadErrorCode.Cancelled));
  }
});

test('CLR override constraints can be removed at successive edges and do not affect signature matching', async () => {
  const module = await load(baseContext(), constrainedFixture((md, first, second) => {
    md.rows[42][0][1] = 20;
    md.rows[42][2][1] = 0;
    md.rows[44] = [[1, codedIndex('TypeDefOrRef', first)], [1, codedIndex('TypeDefOrRef', second)],
      [2, codedIndex('TypeDefOrRef', first)]];
  }));
  assert.equal(await module.methodDefinition(0x06000007).getBaseDefinition(), module.methodDefinition(0x06000001));
});

test('CLR constraint comparison validates every edge and rejects stronger or different requirements', async () => {
  for (const decorate of [
    md => { md.rows[42][0][1] = 0; md.rows[42][1][1] = 4; md.rows[42][2][1] = 0; },
    md => { md.rows[42][2][1] = 16; },
    (md, first, second) => { md.rows[44][2][1] = codedIndex('TypeDefOrRef', second); },
  ]) {
    const module = await load(baseContext(), constrainedFixture(decorate));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
});

test('CLR special constraints follow constructor implication and ignore canonical vacuous type constraints', async () => {
  for (const valueType of [false, true]) {
    const module = await load(baseContext(), constrainedFixture(md => {
      for (const row of md.rows[42]) row[1] = valueType ? 24 : 0;
      if (valueType) md.rows[42][2][1] = 16;
      const token = md.typeRef(valueType ? 'System.ValueType' : 'System.Object');
      md.rows[44] = [[valueType ? 2 : 3, codedIndex('TypeDefOrRef', token)]];
    }));
    assert.equal(await module.methodDefinition(0x06000007).getBaseDefinition(), module.methodDefinition(0x06000001));
  }
});

test('CLR explicit constraints use canonical identities across defining and referencing assemblies', async () => {
  const parent = managedFixture({ name: 'ConstraintBase', entry: null,
    methods: [{ name: 'M', flags: 0x1c6, static: false, noBody: true }], decorate({ md }) {
      const contract = md.add(2, [0xa1, md.string('IContract'), md.string('Fixture'), 0, 1, 2]);
      genericMethod(md, 0, 0, [contract]);
    } });
  const child = managedFixture({ name: 'ConstraintChild', entry: null,
    methods: [{ name: 'M', flags: 0xc6, static: false, noBody: true }], decorate({ md }) {
      md.referenceIdentities.set('constraintbase', { name: 'ConstraintBase', version: [0, 2, 0, 0],
        culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
      md.rows[2][1][3] = codedIndex('TypeDefOrRef', md.typeRef('Fixture.Program', 'ConstraintBase'));
      genericMethod(md, 0, 0, [md.typeRef('Fixture.IContract', 'ConstraintBase')]);
    } });
  const context = baseContext({ load: ({ assemblyName }) => assemblyName.name === 'ConstraintBase' ? parent : null });
  const module = await load(context, child);
  const root = await module.methodDefinition(0x06000001).getBaseDefinition();
  assert.equal(root.assembly.identity.name, 'ConstraintBase');
  assert.equal(root, root.module.methodDefinition(0x06000001));
});

test('CLR unsupported constraint expressions, variant flags and malformed rows fail explicitly', async () => {
  for (const flags of [1, 2, 12, 32, 0x8000]) {
    const module = await load(baseContext(), constrainedFixture(md => { md.rows[42][2][1] = flags; }));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
  for (const decorate of [
    md => { const token = md.add(27, [md.blob(encodeTypeSignature(variable))]);
      md.rows[44][2][1] = codedIndex('TypeDefOrRef', token); },
    md => { md.rows[44][2][1] = codedIndex('TypeDefOrRef', 0x020000ff); },
  ]) {
    const module = await load(baseContext(), constrainedFixture(decorate));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
});

test('CLR generic row limits precede descriptor expansion and cancelled constraint binding can be retried', async () => {
  const context = baseContext();
  const module = await load(context, constrainedFixture());
  await assert.rejects(new OverrideSignatures(context.types, 2).key(module.methodDefinition(0x06000007)),
    fails(LoadErrorCode.LimitExceeded));
  const controller = new AbortController();
  let first = true;
  const cancellable = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
    if (name === 'IComparable' && first) { first = false; controller.abort(); }
    return cancellable.types.intrinsic(`${namespace}.${name}`);
  } } });
  const external = await load(cancellable, constrainedFixture(md => {
    for (const row of md.rows[44]) row[1] = codedIndex('TypeDefOrRef', md.typeRef('System.IComparable'));
  }));
  const method = external.methodDefinition(0x06000007);
  await assert.rejects(method.getBaseDefinition({ signal: controller.signal }), fails(LoadErrorCode.Cancelled));
  assert.equal(await method.getBaseDefinition(), external.methodDefinition(0x06000001));
});
