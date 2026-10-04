import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';

const fails = code => error => error.code === code;
const load = async (image, options = {}) => (await baseContext(options).loadFromStream(image)).manifestModule;
const nested = (md, child, parent) => { md.rows[2][child - 1][0] = 2; md.add(41, [child, parent]); };
function fixture(decorate, parent = 1, child = 6) {
  return hierarchyFixture(({ md }) => {
    md.rows[6][0][2] = 0x3c0 | parent;
    md.rows[6][3][2] = 0xc0 | child;
    nested(md, 3, 2);
    decorate?.(md);
  });
}

test('CLR nested strict access permits private enclosing bases with every non-private-scope child mask', async () => {
  for (let access = 0; access <= 6; access++) {
    const module = await load(fixture(null, 1, access));
    const method = module.methodDefinition(0x06000004);
    if (access) assert.equal(await method.getBaseDefinition(), module.methodDefinition(0x06000001));
    else await assert.rejects(method.getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
    assert.equal(module.methodBodyReadCount, 0);
  }
});

test('CLR nested strict access handles skipped lexical levels and each enclosing inheritance edge', async () => {
  const skipped = await load(fixture(md => {
    nested(md, 4, 3);
    md.rows[2][3][3] = codedIndex('TypeDefOrRef', 0x02000002);
  }));
  assert.equal(await skipped.methodDefinition(0x06000007).getBaseDefinition(), skipped.methodDefinition(0x06000001));
  const chain = await load(fixture(md => {
    nested(md, 4, 3);
    md.rows[6][3][2] = 0x2c1;
  }));
  assert.equal(await chain.methodDefinition(0x06000007).getBaseDefinition(), chain.methodDefinition(0x06000001));
  const inherited = await load(fixture(md => {
    nested(md, 4, 3);
    md.rows[6][3][3] = md.string('DifferentMethod');
  }));
  assert.equal(await inherited.methodDefinition(0x06000007).getBaseDefinition(), inherited.methodDefinition(0x06000001));
});

test('CLR lexical containment alone cannot grant a private override through a non-enclosing inheritance edge', async () => {
  const sibling = await load(fixture(md => {
    nested(md, 4, 2); // Root encloses Leaf, but its immediate base Middle does not.
    md.rows[6][3][3] = md.string('DifferentMethod');
  }));
  await assert.rejects(sibling.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  const outside = await load(fixture(md => { md.rows[6][3][3] = md.string('DifferentMethod'); }));
  await assert.rejects(outside.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
});

test('CLR nested public/family overrides still obey widening and private-scope/new-slot boundaries', async () => {
  for (const [parent, child, accepted] of [[6, 6, true], [4, 6, true], [6, 4, false], [0, 6, false]]) {
    const module = await load(fixture(null, parent, child));
    const method = module.methodDefinition(0x06000004);
    if (accepted) assert.equal(await method.getBaseDefinition(), module.methodDefinition(0x06000001));
    else await assert.rejects(method.getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
  const module = await load(fixture(md => { md.rows[6][3][2] |= 0x100; }, 0));
  assert.equal(await module.methodDefinition(0x06000004).getBaseDefinition(), module.methodDefinition(0x06000004));
});

test('CLR nested strict access bounds lexical depth and rejects inconsistent/generic enclosing metadata', async () => {
  const deep = fixture(md => {
    md.rows[41][0][1] = 5;
    md.add(2, [2, md.string('Container'), 0, 0, 1, 10]);
    nested(md, 5, 6);
    md.add(2, [2, md.string('OuterContainer'), 0, 0, 1, 10]);
    nested(md, 6, 2);
  });
  const allowed = await load(deep, { typeOptions: { maxDepth: 4 } });
  assert.equal(await allowed.methodDefinition(0x06000004).getBaseDefinition(), allowed.methodDefinition(0x06000001));
  const limited = await load(deep, { typeOptions: { maxDepth: 3 } });
  await assert.rejects(limited.methodDefinition(0x06000004).getBaseDefinition(), fails(LoadErrorCode.LimitExceeded));
  const invalid = await load(fixture(md => { md.rows[2][2][0] = 1; }));
  await assert.rejects(invalid.methodDefinition(0x06000004).getBaseDefinition(), fails(LoadErrorCode.InvalidImage));
  const generic = await load(fixture(md => {
    const owner = md.add(2, [1, md.string('GenericContainer`1'), 0, 0, 1, 10]);
    md.rows[41][0][1] = owner & 0xffffff;
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', owner), md.string('T')]);
  }, 6));
  await assert.rejects(generic.methodDefinition(0x06000004).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
});

test('CLR nested strict roots retain canonical ownership, cancellation and cooperative unload behavior', async () => {
  const context = baseContext({ isCollectible: true });
  const module = (await context.loadFromStream(fixture())).manifestModule;
  const method = module.methodDefinition(0x06000004), root = module.methodDefinition(0x06000001);
  await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), fails(LoadErrorCode.Cancelled));
  assert.equal(await method.getBaseDefinition(), root);
  assert.equal(await baseContext().types.getBaseDefinition(method), root);
  context.unload();
  assert.equal(await method.getBaseDefinition(), root);
  await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), fails(LoadErrorCode.Cancelled));
  assert.equal(module.methodBodyReadCount, 0);
});
