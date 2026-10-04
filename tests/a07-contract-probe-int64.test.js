import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {probeContract} from '../scripts/planning/check-contract-implementations.js';

const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));

for (const engine of ['source', 'cil']) {
  for (const type of ['long', 'ulong']) {
    test(`contract probe ${engine}: StringBuilder.Append(${type}) reaches its handler with a valid Int64 fixture`, () => {
      const contract = findContracts('System.Text.StringBuilder', 'Append')
        .find(member => member.parameters.length === 1 && member.parameters[0] === type);
      assert(contract, `Missing released Append(${type}) contract`);
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      // probeContract owns VM cleanup; a returned outcome proves more than its accepted managed-fault fallback.
      assert.deepEqual(probeContract(vm, contract), {handled: true, outcome: 'returned'});
    });
  }
}
