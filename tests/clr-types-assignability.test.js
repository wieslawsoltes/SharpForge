import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { assignabilityFixture } from './clr-types-assignability-fixtures.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-assignability/native-assignability.json', import.meta.url)));

test('CLR class, interface and array assignability matches independent native reflection', async () => {
  const { types, entries } = await assignabilityFixture(Buffer.from(native.image, 'base64'));
  assert.match(native.runtime, /^\.NET 10\./);
  for (const pair of native.pairs) {
    const target = entries.get(pair.target);
    const source = entries.get(pair.source);
    assert.equal(types.isAssignableFrom(target, source), pair.result, `${pair.target} <- ${pair.source}`);
    assert.equal(types.isAssignableFrom(target, source), pair.result, 'Cached result remains identical');
  }
});

test('CLR assignability preserves context identity and rejects unresolved or unsupported forms', async () => {
  const first = await assignabilityFixture(Buffer.from(native.image, 'base64'));
  const second = await assignabilityFixture(Buffer.from(native.image, 'base64'));
  const child = first.entries.get('child');
  assert.equal(first.types.isAssignableFrom(child, child), true);
  assert.equal(first.types.isAssignableFrom(child, second.entries.get('child')), false);
  assert.equal(second.types.isAssignableFrom(first.entries.get('base'), child), true);
  const unloaded = (await first.context.loadFromStream(managedFixture())).manifestModule.typeDefinition(0x02000002);
  assert.throws(() => first.types.isAssignableFrom(child, unloaded), /loaded type graph/);
  assert.throws(() => first.types.isAssignableFrom(child, null), TypeError);
  const integer = first.entries.get('int');
  for (const unsafe of [first.types.pointer(integer), first.types.byRef(integer), first.types.functionPointer({ returnType: integer })]) {
    assert.throws(() => first.types.isAssignableFrom(unsafe, unsafe), /later casting batch/);
  }
  const definition = first.types.intrinsic('System.Collections.Generic.IList`1');
  assert.throws(() => first.types.isAssignableFrom(definition, definition), /Generic definition/);
  assert.throws(() => first.types.isAssignableFrom(first.entries.get('object'), first.entries.get('IList<int>')), /Generic variance/);
  assert.throws(() => first.types.isAssignableFrom(child, child, { signal: AbortSignal.abort() }),
    error => error.code === LoadErrorCode.Cancelled);
});

test('CLR assignability bounds traversal and detects generic metadata without claiming generic support', async () => {
  const types = arrayContext({ typeOptions: { maxDepth: 2 } }).types;
  const object = types.intrinsic('System.Object');
  const first = types.defineIntrinsic('Fixture.First', { baseType: object });
  const second = types.defineIntrinsic('Fixture.Second', { baseType: first });
  assert.throws(() => types.isAssignableFrom(object, second), error => error.code === LoadErrorCode.LimitExceeded);
  const context = arrayContext();
  const generic = managedFixture({ name: 'GenericOwner', decorate({ md }) {
    md.add(42, [0, 0, 2 << 1, md.string('T')]);
  } });
  const module = (await context.loadFromStream(generic)).manifestModule;
  const type = await context.types.load(module, 0x02000002);
  assert.throws(() => context.types.isAssignableFrom(type, type), /Generic definition/);
});
