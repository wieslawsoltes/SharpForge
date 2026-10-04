import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { locateInteropToolchain } from './fixtures/exported-extension-blocks/dotnet.mjs';
import { nullableEmptyScopeSnapshot } from './fixtures/exported-extension-blocks/nullable-empty-snapshot.mjs';

const fixture = name => new URL('./fixtures/exported-extension-blocks/' + name, import.meta.url);
const source = readFileSync(fixture('NoTransformMethods.cs'), 'utf8');
const expected = JSON.parse(readFileSync(fixture('no-transform-metadata.json'), 'utf8'));
const toolchain = locateInteropToolchain();
const surfaces = [
  { name: 'registry', references: undefined, skip: false },
  { name: 'PE', references: toolchain?.references, skip: toolchain ? false : 'Requires an installed .NET 10+ reference pack' },
];
const context = value => [{ name: 'System.Runtime.CompilerServices.NullableContextAttribute', bytes: [1, 0, value, 0, 0] }];

test('nullable empty-scope byte control records its actual pre-optimization compiler and unchanged source', () => {
  assert.equal(expected.producer.compiler, 'SharpForge');
  assert.equal(expected.producer.revision, 'ed91058416e8c1bbd40fdf3d778f07f615c410c8');
  assert.equal(expected.source.sha256, createHash('sha256').update(source).digest('hex'));
  const records = expected.snapshots.registry;
  const record = name => records.find(item => item.target === 'NoTransformControl.Control.' + name);
  assert.deepEqual(record('Plain').attributes, []);
  assert.deepEqual(record('Empty').attributes, []);
  assert.deepEqual(record('Generic').attributes, context(0), 'A nonempty [0] generic vote overrides the enclosing context');
  assert.deepEqual(record('Oblivious').attributes, context(0));
  assert.deepEqual(record('ReturnOnly').attributes, context(2), 'A return-only transform participates in context election');
});

for (const surface of surfaces) {
  for (const [name, emit] of [['executable', compileToAssembly], ['reference', compileToReferenceAssembly]]) {
    test(`nullable scope pruning preserves ${surface.name} ${name} metadata bytes and Param/GenericParam rows`, { skip: surface.skip }, () => {
      const result = emit(source, { name: 'NoTransformMetadata', outputKind: 'library', langVersion: '14', references: surface.references });
      assert.equal(result.success, true, JSON.stringify(result.diagnostics));
      assert.deepEqual(nullableEmptyScopeSnapshot(result.assembly), expected.snapshots[surface.name]);
    });
  }
}
