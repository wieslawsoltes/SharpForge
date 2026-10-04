import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, encodeSignature, encodeTypeSignature } from '@sharpforge/cil';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { OverrideSignatures } from '../packages/clr/src/type-system/override-signature.js';
import { baseContext, hierarchyFixture } from './clr-methods-base-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

const integer = { kind: 'primitive', name: 'int' };
const modified = (token, element = integer, kind = 'modreq') => ({ kind, token, element });
const signature = type => encodeSignature({ kind: 'method', hasThis: true, returnType: type, parameters: [type] });
const fails = code => error => error.code === code;
const load = async (context, image) => (await context.loadFromStream(image)).manifestModule;
function marker(md, name = 'Marker') {
  return md.add(2, [1, md.string(name), md.string('Fixture'), 0, 1, md.rows[6].length + 1]);
}
function fixture(makeType, decorate) {
  return hierarchyFixture(({ md }) => {
    const first = marker(md), second = marker(md, 'Other');
    for (const row of [0, 3, 6]) md.rows[6][row][4] = md.blob(signature(makeType(first, second, row, md)));
    decorate?.(md, first, second);
  });
}

test('CLR override modifiers retain kind, order and constructor position in canonical cached keys', async () => {
  for (const kind of ['modreq', 'modopt']) {
    const image = fixture((first, second) => modified(first, {
      kind: 'byref', element: modified(second, { kind: 'szarray', element: integer }, 'modopt'),
    }, kind));
    const context = baseContext({ isCollectible: true });
    const module = await load(context, image);
    const method = module.methodDefinition(0x06000007), root = module.methodDefinition(0x06000001);
    assert.equal(await method.getBaseDefinition(), root);
    assert.equal(await method.getBaseDefinition(), root);
    assert.equal(module.methodBodyReadCount, 0);
    context.unload();
    assert.equal(await method.getBaseDefinition(), root);
    await assert.rejects(method.getBaseDefinition({ signal: AbortSignal.abort() }), fails(LoadErrorCode.Cancelled));
  }
});

test('CLR override modifier kind, identity, order, omission and placement mismatches keep separate slots', async () => {
  const variants = [
    (first, second) => modified(first, modified(second), 'modopt'),
    (first, second) => modified(second, modified(second)),
    (first, second) => modified(second, modified(first)),
    () => integer,
    (first, second) => ({ kind: 'byref', element: modified(first, modified(second)) }),
  ];
  for (const different of variants) {
    const image = fixture((first, second, row) => row === 6 ? different(first, second) : modified(first, modified(second)), md => {
      // A complete metadata chain permits an unmatched reuse-slot method to introduce a slot.
      md.rows[2][1][3] = 0;
    });
    const module = await load(baseContext(), image);
    const method = module.methodDefinition(0x06000007);
    assert.equal(await method.getBaseDefinition(), method);
  }
});

test('CLR modifier identities resolve equivalent local and cross-assembly TypeRefs', async () => {
  const local = fixture((first, second, row, md) => {
    const reference = row === 6 ? md.add(1, [codedIndex('ResolutionScope', 1), md.string('Marker'), md.string('Fixture')]) : first;
    return modified(reference);
  });
  const localModule = await load(baseContext(), local);
  assert.equal(await localModule.methodDefinition(0x06000007).getBaseDefinition(), localModule.methodDefinition(0x06000001));
  const parent = managedFixture({ name: 'ModifierBase', entry: null,
    methods: [{ name: 'M', flags: 0x1c6, static: false, noBody: true }], decorate({ md }) {
      md.rows[6][0][4] = md.blob(signature(modified(marker(md))));
    } });
  const child = managedFixture({ name: 'ModifierChild', entry: null,
    methods: [{ name: 'M', flags: 0xc6, static: false, noBody: true }], decorate({ md }) {
      md.referenceIdentities.set('modifierbase', { name: 'ModifierBase', version: [0, 2, 0, 0],
        culture: '', flags: 0, publicKeyOrToken: new Uint8Array() });
      md.rows[2][1][3] = codedIndex('TypeDefOrRef', md.typeRef('Fixture.Program', 'ModifierBase'));
      md.rows[6][0][4] = md.blob(signature(modified(md.typeRef('Fixture.Marker', 'ModifierBase'))));
    } });
  const context = baseContext({ load: ({ assemblyName }) => assemblyName.name === 'ModifierBase' ? parent : null });
  const module = await load(context, child);
  const root = await module.methodDefinition(0x06000001).getBaseDefinition();
  assert.equal(root.assembly.identity.name, 'ModifierBase');
  assert.equal(root, root.module.methodDefinition(0x06000001));
});

test('CLR override modifier binding rejects TypeSpecs, open definitions and malformed token extents', async () => {
  const images = [
    fixture((first, second, row, md) => modified(md.add(27, [md.blob(encodeTypeSignature({ kind: 'class', token: first }))]))),
    fixture(first => modified(first), (md, first) => {
      md.add(42, [0, 0, codedIndex('TypeOrMethodDef', first), md.string('T')]);
    }),
  ];
  for (const image of images) {
    const module = await load(baseContext(), image);
    await assert.rejects(module.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.TypeLoad));
  }
  const malformed = await load(baseContext(), fixture(() => modified(0x0200ffff)));
  await assert.rejects(malformed.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.InvalidImage));
  const deep = await load(baseContext(), fixture(first => modified(first), (md, first) => {
    const prefix = Array.from({ length: 65 }, () => [0x1f, codedIndex('TypeDefOrRef', first)]).flat();
    md.rows[6][6][4] = md.blob(Uint8Array.from([0x20, 1, 8, ...prefix, 8]));
  }));
  await assert.rejects(deep.methodDefinition(0x06000007).getBaseDefinition(), fails(LoadErrorCode.InvalidImage));
});

test('CLR modifier row and identity limits apply before expanding generic descriptors or publishing keys', async () => {
  const image = fixture(first => modified(first), md => {
    const other = marker(md, 'Generic`4');
    for (let position = 0; position < 4; position++) {
      md.add(42, [position, 0, codedIndex('TypeOrMethodDef', other), md.string(`T${position}`)]);
    }
  });
  const context = baseContext(), module = await load(context, image);
  const signatures = new OverrideSignatures(context.types, 3);
  await assert.rejects(signatures.key(module.methodDefinition(0x06000007)), fails(LoadErrorCode.LimitExceeded));
  const ordinary = await load(baseContext(), fixture(first => modified(first)));
  const bounded = new OverrideSignatures(ordinary.assembly.loadContext.types, 1);
  await assert.rejects(bounded.key(ordinary.methodDefinition(0x06000007)), fails(LoadErrorCode.LimitExceeded));
});

test('CLR cancelled external modifier binding can retry without a partially cached signature', async () => {
  const controller = new AbortController();
  let first = true;
  const context = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
    if (name === 'Modifier' && first) { first = false; controller.abort(); }
    return context.types.intrinsic(`${namespace}.${name}`);
  } } });
  context.types.defineIntrinsic('System.Modifier');
  const image = fixture((first, second, row, md) => modified(md.typeRef('System.Modifier')));
  const module = await load(context, image), method = module.methodDefinition(0x06000007);
  await assert.rejects(method.getBaseDefinition({ signal: controller.signal }), fails(LoadErrorCode.Cancelled));
  assert.equal(await method.getBaseDefinition(), module.methodDefinition(0x06000001));
});
