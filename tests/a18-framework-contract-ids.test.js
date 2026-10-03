import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  frameworkManifest, contracts, findContracts, propertiesFor, eventsFor, contributionManifest, idReservations,
  areaReservations, CONTROLS, XAML
} from '@sharpforge/framework';

test('framework contracts are unique and inherited properties/events bind without reflection fallback', async () => {
  const locked = JSON.parse(await readFile(new URL('../planning/contracts/framework-ids.lock.json', import.meta.url), 'utf8'));
  const releasedCount = contributionManifest.reduce((count, block) => count + block.size, 0);
  assert.equal(releasedCount, 1744);
  assert.equal(locked.length, releasedCount);
  const ids = new Set();
  for (const contract of contracts) {
    assert(Number.isSafeInteger(contract.id) && contract.id >= 0, 'Invalid framework ABI ID');
    assert(!ids.has(contract.id), 'Duplicate framework ABI ID ' + contract.id);
    ids.add(contract.id);
    const reservations = idReservations.filter(block => contract.id >= block.start && contract.id < block.start + block.size);
    assert.equal(reservations.length, 1, 'Contract must occupy exactly one registered reservation: ' + contract.id);
  }
  // Array ordinals describe the closed released set; independently reserved extensions leave intentional gaps.
  const released = contracts.filter(contract => contract.id < releasedCount);
  assert.equal(released.length, releasedCount);
  released.forEach((contract, index) => assert.equal(contract.id, index, 'Released ID at ordinal ' + index));
  assert.deepEqual(released.map(({id, owner, name, parameters, kind}) => ({id, owner, name, parameters, kind})), locked);
  assert.equal(propertiesFor(CONTROLS + 'StackPanel').Padding.type, XAML + 'Thickness');
  assert.equal(findContracts(CONTROLS + 'Button', 'set_Background').length, 1);
  assert.equal(eventsFor(CONTROLS + 'Button').Click, XAML + 'RoutedEventHandler');
  assert.equal(findContracts(CONTROLS + 'Button', 'add_Click', false).length, 1);
  assert.deepEqual(findContracts(CONTROLS + 'Button', 'eval'), []);
  assert.deepEqual(findContracts('Unregistered.HostObject', 'toString'), []);
  assert(frameworkManifest.types.length > 60);
});

test('A18 attached dependency-property getters retain their explicit reserved ABI IDs', () => {
  const area = areaReservations.find(block => block.name === 'A18');
  assert.equal(area.start, 1245184);
  assert.equal(area.size, 65536);
  const expected = [
    [1245184, 'Canvas', 'LeftProperty'],
    [1245185, 'Canvas', 'TopProperty'],
    [1245186, 'Canvas', 'ZIndexProperty'],
    [1245187, 'Grid', 'RowProperty'],
    [1245188, 'Grid', 'ColumnProperty'],
    [1245189, 'Grid', 'RowSpanProperty'],
    [1245190, 'Grid', 'ColumnSpanProperty'],
    [1245191, 'VariableSizedWrapGrid', 'RowSpanProperty'],
    [1245192, 'VariableSizedWrapGrid', 'ColumnSpanProperty']
  ];
  const byId = new Map(contracts.map(contract => [contract.id, contract]));
  for (const [id, ownerName, property] of expected) {
    const owner = CONTROLS + ownerName;
    const actual = byId.get(id);
    assert(actual, 'Missing reserved attached-property contract ' + id);
    const {name, parameters, result, isStatic, kind} = actual;
    assert.deepEqual({id: actual.id, owner: actual.owner, name, parameters, result, isStatic, kind},
      {id, owner, name: 'get_' + property, parameters: [], result: XAML + 'DependencyProperty', isStatic: true, kind: 'get'});
    assert.deepEqual(findContracts(owner, 'get_' + property, true), [actual]);
    assert.deepEqual(findContracts(owner, 'set_' + property, true), []);
    assert.equal(propertiesFor(owner)[property].readOnly, true);
    assert.equal(propertiesFor(owner)[property].isStatic, true);
  }
});
