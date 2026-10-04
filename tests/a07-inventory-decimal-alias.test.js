import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contracts, types} from '@sharpforge/framework';
import {compareMembers} from '../scripts/conformance/inventory/bcl-api-diff.js';
import {normalizeType} from '../scripts/conformance/inventory/common.js';

test('BCL inventory matches registered Decimal insertion against its actual CLR metadata signature', () => {
  const reference = JSON.parse(readFileSync(new URL('../packages/bcl-core/reference/dotnet-10.0.5.json', import.meta.url)));
  const native = reference.rows.find(row => row.owner === 'System.Text.StringBuilder' && row.name === 'Insert' &&
    row.kind === 'method' && row.parameters.join(',') === 'System.Int32,System.Decimal');
  assert.ok(native, 'Pinned .NET metadata must contain the actual Decimal insertion overload');
  const registered = contracts.find(row => row.owner === native.owner && row.name === native.name &&
    row.parameters.join(',') === 'int,decimal');
  assert.ok(registered);
  const result = compareMembers({...reference, rows: [native]}, {registryTypes: types, registryContracts: contracts});
  assert.equal(result.rows[0].status, 'implemented');
  assert.deepEqual(result.rows[0].contractIds, [registered.id]);
  const wrongWidth = {...native, parameters: ['System.Int32', 'System.Double']};
  assert.equal(compareMembers({...reference, rows: [wrongWidth]}, {
    registryTypes: types, registryContracts: [registered]
  }).rows[0].status, 'missing');
});

test('BCL inventory Decimal aliases preserve containers and distinct type names', () => {
  assert.equal(normalizeType('System.Decimal[]'), 'decimal[]');
  assert.equal(normalizeType('System.Decimal&'), 'decimal&');
  assert.equal(normalizeType('System.Collections.Generic.List<System.Decimal>'), 'System.Collections.Generic.List<decimal>');
  assert.equal(normalizeType('System.DecimalLike'), 'System.DecimalLike');
});
