import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {faultRecord} from '../scripts/planning/schema/adapters.js';
import {validate} from '../scripts/planning/schema/validate.js';

const nestedFault = readFileSync(new URL('../planning/contracts/fixtures/safepoint/nested-fault.cs', import.meta.url), 'utf8');
// Preserve the original A00 input independently of the repaired replacement fixture.
const unhandled = 'using System;\n' +
  'class Program { static void Main() { try { throw new Exception("first"); } finally { throw new Exception("second"); } } }\n';
const schema = version => JSON.parse(readFileSync(new URL(
  '../planning/contracts/schema/' + (version === 1 ? 'fault' : 'fault-v2') + '.schema.json', import.meta.url)));

function create(engine, source) {
  const compiled = compileToIL(source, {pipeline: 'bound'});
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const options = {virtualTime: true, weakStringInterning: true};
  return engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
    : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
}

function assertRootedTerminalFault(vm, message) {
  assert.equal(vm.state, 'faulted');
  assert.equal(vm.fault.message, message);
  assert.equal(vm.fault.phase, 'unhandled');
  assert.equal(vm.output.join(''), '');
  assert(vm.frames.length > 0, 'Unhandled termination keeps the throwing frame for inspection');
  assert(vm.fault.frames.length > 0, 'The portable fault retains its throw trace');
  const reference = vm.fault.reference;
  assert(reference, 'The thrown managed exception must retain its owned heap handle');
  vm.heap.collect();
  assert.equal(vm.heap.get(reference).methodTable.name, 'System.Exception');
  for (const schemaVersion of [1, 2]) {
    const record = faultRecord(vm, undefined, {schemaVersion});
    validate(schema(schemaVersion), record, {supportedVersion: schemaVersion});
    assert.equal(record.uncatchable, false);
    assert.deepEqual(record.exceptionHandle, {h: reference.h + 1, g: reference.g});
    assert.equal(record.cause, null, 'Replacing an exception does not invent suppressed-exception history');
  }
}

for (const engine of ['source', 'reload', 'cil']) {
  test(`A00 ${engine}: selected handler runs the throwing finally and rethrows second`, () => {
    const vm = create(engine, nestedFault);
    try {
      vm.run();
      assertRootedTerminalFault(vm, 'second');
    } finally { vm.stop(); }
  });

  test(`A00 ${engine}: no matching handler preserves first and its frame through GC and restore`, () => {
    const vm = create(engine, unhandled);
    try {
      vm.run();
      assertRootedTerminalFault(vm, 'first');
      const frames = vm.frames.map(frame => ({id: frame.id, pc: frame.pc}));
      const instructions = vm.instructions;
      const saved = vm.snapshot();
      vm.runSlice({instructionBudget: 100, timeBudgetMs: 100});
      assert.equal(vm.instructions, instructions, 'A terminal fault must not resume finally code');
      assert.deepEqual(vm.frames.map(frame => ({id: frame.id, pc: frame.pc})), frames);
      vm.restore(saved);
      assertRootedTerminalFault(vm, 'first');
      assert.deepEqual(vm.frames.map(frame => ({id: frame.id, pc: frame.pc})), frames);
    } finally { vm.stop(); }
  });
}
