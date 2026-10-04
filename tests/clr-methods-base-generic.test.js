import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { MethodBaseDefinitions } from '../packages/clr/src/type-system/method-base-definition.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

const primitive = name => ({ kind: 'primitive', name });
const instance = (token, argumentsList, kind = 'class') => ({ kind: 'genericInstance', type: { kind, token }, arguments: argumentsList });
const signature = (type, genericArity = 0) => encodeSignature({ kind: 'method', hasThis: true,
  returnType: type, parameters: [type], genericArity });
const fails = code => error => error.code === code;
function definition(md, name = 'Box`1', arity = 1, attributes = 0) {
  const token = md.add(2, [1, md.string(name), md.string('Fixture'),
    codedIndex('TypeDefOrRef', md.typeRef('System.Object')), 1, md.rows[6].length + 1]);
  for (let position = 0; position < arity; position++) {
    md.add(42, [position, attributes, codedIndex('TypeOrMethodDef', token), md.string(`T${position}`)]);
  }
  return token;
}
const load = async (context, image) => (await context.loadFromStream(image)).manifestModule;
function genericHierarchy(makeType, decorate) {
  return hierarchyFixture(({ md }) => {
    const box = definition(md);
    for (const row of [0, 3, 6]) md.rows[6][row][4] = md.blob(signature(makeType(box, row)));
    decorate?.(md, box);
  });
}

test('CLR generic-instance override signatures match nested definitions and array arguments without bodies', async () => {
  const image = genericHierarchy(box => instance(box, [{ kind: 'szarray', element: instance(box, [primitive('int')]) }]));
  const context = baseContext({ isCollectible: true });
  const module = await load(context, image);
  const method = module.methodDefinition(0x06000007);
  const root = module.methodDefinition(0x06000001);
  assert.equal(await method.getBaseDefinition(), root);
  assert.equal(await method.getBaseDefinition(), root);
  assert.equal(module.methodBodyReadCount, 0);
  context.unload();
  assert.equal(await method.getBaseDefinition(), root);
  await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), fails(LoadErrorCode.Cancelled));
});

test('CLR generic method arguments compare by ordinal inside generic-instance signatures', async () => {
  const image = genericHierarchy(box => instance(box, [primitive('int')]), (md, box) => {
    for (const row of [0, 3, 6]) {
      md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x06000001 + row), md.string(`MethodT${row}`)]);
      md.rows[6][row][4] = md.blob(signature(instance(box, [{ kind: 'genericParameter', scope: 'method', index: 0 }]), 1));
    }
  });
  const module = await load(baseContext(), image);
  assert.equal(await module.methodDefinition(0x06000007).getBaseDefinition(), module.methodDefinition(0x06000001));
});

test('CLR generic override matching keeps distinct arguments and definitions in separate slots', async () => {
  for (const differentDefinition of [false, true]) {
    const image = genericHierarchy((box, row) => instance(box, [primitive(row === 6 ? 'string' : 'int')]), (md) => {
      md.rows[2][1][3] = 0;
      if (differentDefinition) {
        const other = definition(md, 'Other`1');
        md.rows[6][6][4] = md.blob(signature(instance(other, [primitive('int')])));
      }
    });
    const module = await load(baseContext(), image);
    const method = module.methodDefinition(0x06000007);
    assert.equal(await method.getBaseDefinition(), method);
  }
});

test('CLR generic definitions resolve canonically across TypeDef and external TypeRef signatures', async () => {
  const parent = managedFixture({ name: 'GenericOverrideBase', entry: null,
    methods: [{ name: 'M', flags: 0x1c6, static: false, noBody: true }], decorate({ md }) {
      md.rows[6][0][4] = md.blob(signature(instance(definition(md), [primitive('int')])));
    } });
  const child = managedFixture({ name: 'GenericOverrideChild', entry: null,
    methods: [{ name: 'M', flags: 0xc6, static: false, noBody: true }], decorate({ md }) {
      md.referenceIdentities.set('genericoverridebase', { name: 'GenericOverrideBase', version: [0, 2, 0, 0],
        culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
      md.rows[2][1][3] = codedIndex('TypeDefOrRef', md.typeRef('Fixture.Program', 'GenericOverrideBase'));
      md.rows[6][0][4] = md.blob(signature(instance(md.typeRef('Fixture.Box`1', 'GenericOverrideBase'), [primitive('int')])));
    } });
  const context = baseContext({ load: ({ assemblyName }) => assemblyName.name === 'GenericOverrideBase' ? parent : null });
  const module = await load(context, child);
  const root = await module.methodDefinition(0x06000001).getBaseDefinition();
  assert.equal(root.assembly.identity.name, 'GenericOverrideBase');
  assert.equal(root, root.module.methodDefinition(0x06000001));
});

test('CLR generic override signatures reject arity, category, constraints and unsupported argument families', async () => {
  const types = [
    box => instance(box, [primitive('int'), primitive('int')]),
    box => instance(box, [primitive('int')], 'valuetype'),
    box => instance(box, [{ kind: 'genericParameter', scope: 'type', index: 0 }]),
    box => instance(box, [{ kind: 'modopt', token: box, element: primitive('int') }]),
    box => instance(box, [{ kind: 'pointer', element: primitive('int') }]),
  ];
  for (const makeType of types) {
    const module = await load(baseContext(), genericHierarchy(makeType));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
  for (const attributes of [1, 4]) {
    const module = await load(baseContext(), genericHierarchy(box => instance(box, [primitive('int')]), md => {
      md.rows[42][0][1] = attributes;
    }));
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
  const ordinary = await load(baseContext(), genericHierarchy(box => instance(box, [primitive('int')]), md => {
    md.rows[42] = [];
  }));
  await assert.rejects(ordinary.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
});

test('CLR generic definition row budgets apply before descriptor expansion', async () => {
  const image = genericHierarchy(box => instance(box, [primitive('int')]), md => { definition(md, 'Other`3', 3); });
  const context = baseContext();
  const module = await load(context, image);
  const bounded = new MethodBaseDefinitions(context.types, { maxDepth: 128, maxMetadataRows: 3 });
  await assert.rejects(bounded.get(module.methodDefinition(0x06000007)), fails(LoadErrorCode.LimitExceeded));
});

test('CLR cancellation during external generic binding does not publish a completed override result', async () => {
  const controller = new AbortController();
  let first = true;
  const context = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
    if (name === 'Box`1' && first) { first = false; controller.abort(); }
    return context.types.intrinsic(`${namespace}.${name}`);
  } } });
  context.types.defineIntrinsic('System.Box`1', { genericArity: 1 });
  const image = genericHierarchy(box => instance(box, [primitive('int')]), md => {
    const reference = md.typeRef('System.Box`1');
    for (const row of [0, 3, 6]) md.rows[6][row][4] = md.blob(signature(instance(reference, [primitive('int')])));
  });
  const module = await load(context, image);
  const method = module.methodDefinition(0x06000007);
  await assert.rejects(method.getBaseDefinition({ signal: controller.signal }), fails(LoadErrorCode.Cancelled));
  assert.equal(await method.getBaseDefinition(), module.methodDefinition(0x06000001));
});
