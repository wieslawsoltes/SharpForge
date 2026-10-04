import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

const fails = code => error => error.code === code;
const load = async (context, image) => (await context.loadFromStream(image)).manifestModule;
function fixture(parent, child, decorate) {
  return hierarchyFixture(({ md }) => {
    md.rows[6][0][2] = (md.rows[6][0][2] & ~7) | 0x200 | parent;
    md.rows[6][3][2] = (md.rows[6][3][2] & ~7) | child;
    decorate?.(md);
  });
}

test('CLR strict same-assembly override access follows the complete widening matrix', async () => {
  // Authored access sets, independent of the product bit table; rows name base access.
  const children = [[], [], [2, 3, 4, 5, 6], [3, 5, 6], [4, 5, 6], [5, 6], [6]];
  for (let parent = 0; parent <= 6; parent++) {
    for (let child = 0; child <= 6; child++) {
      const module = await load(baseContext(), fixture(parent, child));
      const method = module.methodDefinition(0x06000004);
      if (children[parent].includes(child)) {
        assert.equal(await method.getBaseDefinition(), module.methodDefinition(0x06000001), `${parent}/${child}`);
      } else await assert.rejects(method.getBaseDefinition(), fails(LoadErrorCode.TypeLoad), `${parent}/${child}`);
      assert.equal(module.methodBodyReadCount, 0);
    }
  }
});

test('CLR strict override results remain canonical, cancellation-aware and usable after cooperative unload', async () => {
  const context = baseContext({ isCollectible: true });
  const module = await load(context, fixture(2, 6));
  const method = module.methodDefinition(0x06000007), root = module.methodDefinition(0x06000001);
  assert.equal(await method.getBaseDefinition(), root);
  assert.equal(await baseContext().types.getBaseDefinition(method), root);
  context.unload();
  assert.equal(await method.getBaseDefinition(), root);
  await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), fails(LoadErrorCode.Cancelled));
});

test('CLR strict checks apply to each matched edge, while new slots do not override an inaccessible root', async () => {
  const module = await load(baseContext(), fixture(6, 4));
  await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  const reset = await load(baseContext(), fixture(1, 6, md => { md.rows[6][3][2] |= 0x100; }));
  assert.equal(await reset.methodDefinition(0x06000007).getBaseDefinition(), reset.methodDefinition(0x06000004));
});

test('CLR strict generic type and generic method access stays explicitly unsupported', async () => {
  const images = [
    fixture(6, 6, md => { md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x02000003), md.string('T')]); }),
    fixture(6, 6, md => {
      const integer = { kind: 'primitive', name: 'int' };
      for (const index of [0, 3]) {
        md.rows[6][index][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
          genericArity: 1, returnType: integer, parameters: [integer] }));
        md.add(42, [0, 0, codedIndex('TypeOrMethodDef', 0x06000001 + index), md.string('T')]);
      }
    }),
  ];
  for (const image of images) {
    const module = await load(baseContext(), image);
    await assert.rejects(module.methodDefinition(0x06000004).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
});

test('CLR strict access uses canonical assembly identity and defers cross-assembly friend policies', async () => {
  const parent = managedFixture({ name: 'StrictBase', entry: null,
    methods: [{ name: 'M', flags: 0x3c6, static: false, noBody: true }] });
  const child = managedFixture({ name: 'StrictChild', entry: null,
    methods: [{ name: 'M', flags: 0xc6, static: false, noBody: true }], decorate({ md }) {
      md.referenceIdentities.set('strictbase', { name: 'StrictBase', version: [0, 2, 0, 0],
        culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
      md.rows[2][1][3] = codedIndex('TypeDefOrRef', md.typeRef('Fixture.Program', 'StrictBase'));
    } });
  const context = baseContext({ load: ({ assemblyName }) => assemblyName.name === 'StrictBase' ? parent : null });
  const module = await load(context, child);
  await assert.rejects(module.methodDefinition(0x06000001).getBaseDefinition(),
    error => error.code === LoadErrorCode.TypeLoad && error.message.includes('Cross-assembly'));
});

test('CLR strict access rejects reserved masks and bounds generic metadata before owner expansion', async () => {
  for (const [parent, child] of [[7, 6], [6, 7]]) {
    const module = await load(baseContext(), fixture(parent, child));
    await assert.rejects(module.methodDefinition(0x06000004).getBaseDefinition(), fails(LoadErrorCode.InvalidImage));
  }
  const image = fixture(6, 6, md => {
    const marker = md.add(2, [1, md.string('Other`13'), 0, 0, 1, 10]);
    for (let index = 0; index < 13; index++) md.add(42, [index, 0, codedIndex('TypeOrMethodDef', marker), md.string(`T${index}`)]);
  });
  const context = baseContext({ typeOptions: { maxMetadataRows: 12 } });
  const module = await load(context, image);
  await assert.rejects(module.methodDefinition(0x06000004).getBaseDefinition(), fails(LoadErrorCode.LimitExceeded));
});
