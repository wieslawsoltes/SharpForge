import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  contracts, idReservations, contractForMember, findContracts,
  frameworkManifest, propertiesFor, CONTROLS
} from '@sharpforge/framework';
import {Builtins, frameworkBuiltin, CONTRACT_BUILTIN_OFFSET} from '@sharpforge/bytecode';

test('framework contract IDs preserve reserved ranges and round-trip through dispatch lookup', () => {
  const ids = new Set();
  for (const [index, contract] of contracts.entries()) {
    assert(Number.isSafeInteger(contract.id) && contract.id >= 0);
    assert(!ids.has(contract.id), `Duplicate contract ID ${contract.id}`);
    ids.add(contract.id);
    const reservation = idReservations.find(range =>
      contract.id >= range.start && contract.id < range.start + range.size);
    assert(reservation, `Contract ${contract.id} has no reserved range`);
    // Only released legacy ranges are dense; area contributions have independent IDs.
    if (reservation.legacy) assert.equal(contract.id, index);
    const builtin = frameworkBuiltin(contract);
    assert.equal(builtin, Builtins[CONTRACT_BUILTIN_OFFSET + contract.id]);
    assert.equal(builtin.id, CONTRACT_BUILTIN_OFFSET + contract.id);
    assert.equal(builtin.contract, contract);
    assert(findContracts(contract.owner, contract.name, contract.isStatic).includes(contract));
    assert.equal(contractForMember({
      owner: contract.owner, name: contract.name,
      signature: {
        isStatic: contract.isStatic, parameters: contract.parameters,
        returnType: contract.kind === 'constructor' ? 'void' : contract.result
      }
    }), contract);
  }
});

test('released framework IDs retain their locked member identity after extensions register', async () => {
  const locked = JSON.parse(await readFile(new URL('../planning/contracts/framework-ids.lock.json', import.meta.url), 'utf8'));
  const current = new Map(contracts.map(({id, owner, name, parameters, kind}) =>
    [id, {id, owner, name, parameters, kind}]));
  for (const contract of locked) assert.deepEqual(current.get(contract.id), contract, `Contract ID ${contract.id}`);
});

test('inherited WinUI properties and members bind without reflection fallback', () => {
  assert.equal(propertiesFor(CONTROLS + 'StackPanel').Padding.type, 'Microsoft.UI.Xaml.Thickness');
  assert.equal(findContracts(CONTROLS + 'Button', 'set_Background').length, 1);
  assert(frameworkManifest.types.length > 60);
});
