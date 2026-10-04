import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { ReferenceManager } from '../packages/compiler/src/metadata-import/reference-manager.js';
import { tupleElementNamesOf } from '../packages/compiler/src/binder/tuples.js';
import { tupleAttributeRows } from './fixtures/nullable-metadata/inspect-metadata.mjs';

const fixture = name => readFileSync(new URL('./fixtures/nullable-metadata/' + name, import.meta.url));
const source = fixture('TupleMetadata.cs').toString('utf8');
const pack = loadReferencePack();

test('A02-T08.4 tuple relation fixture records genuine Roslyn provenance', () => {
  const provenance = JSON.parse(fixture('tuple-provenance.json'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(provenance.sourceSha256, sha256(fixture('TupleMetadata.cs')));
  assert.equal(provenance.assemblySha256, sha256(fixture('TupleMetadata.dll')));
  assert.deepEqual(tupleAttributeRows(fixture('TupleMetadata.dll')), JSON.parse(fixture('roslyn-tuple-attributes.json')));
});

test('A02-T08.4 tuple names are emitted on bases, interfaces, constraints, events, and synthesized accessors', {
  skip: pack ? false : 'no .NET reference pack installed',
}, () => {
  const expected = tupleAttributeRows(fixture('TupleMetadata.dll'));
  for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
    const result = emit(source, { name: 'TupleMetadata', outputKind: 'library', references: pack.references });
    assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
    assert.ok(result.assembly);
    assert.deepEqual(tupleAttributeRows(result.assembly), expected);
  }
});

test('A02-T08.4 imported tuple names match Roslyn across declaration relations', {
  skip: pack ? false : 'no .NET reference pack installed',
}, () => {
  const result = compileToAssembly(source, { name: 'TupleMetadata', outputKind: 'library', references: pack.references });
  assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
  const shape = bytes => {
    const assembly = new ReferenceManager([...pack.references, { bytes }]).assemblies.find(item => item.name === 'TupleMetadata');
    const carrier = assembly.getTypeByMetadataName('TupleMetadata.Carrier`1');
    const nested = assembly.getTypeByMetadataName('TupleMetadata.Outer`1+Nested');
    return {
      base: tupleElementNamesOf(carrier.baseType),
      interface: tupleElementNamesOf(carrier.interfaces[0]),
      constraint: tupleElementNamesOf(carrier.typeParameters[0].constraintTypes[0].type),
      changed: tupleElementNamesOf(carrier.getMembers('Changed')[0].type),
      custom: tupleElementNamesOf(carrier.getMembers('Custom')[0].type),
      add: tupleElementNamesOf(carrier.getMembers('add_Changed')[0].parameters[0].type),
      nested: tupleElementNamesOf(nested.baseType),
    };
  };
  assert.deepEqual(shape(result.assembly), shape(fixture('TupleMetadata.dll')));
});
