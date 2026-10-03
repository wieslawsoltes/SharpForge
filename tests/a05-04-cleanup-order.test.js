import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {cleanupClauses} from '../packages/runtime/src/execution/eh-nesting.js';

const fixture = new URL('./fixtures/a05-cleanup/', import.meta.url);
const source = readFileSync(new URL('Program.cs', fixture), 'utf8');
const expected = readFileSync(new URL('expected.txt', fixture), 'utf8');
for (const engine of ['source', 'reloaded', 'cil']) {
  test(`T04.4 ${engine}: three cleanup levels, return, catch leave and replacement exception`, () => {
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly) :
      new VirtualMachine(engine === 'source' ? compiled.image : loadAssembly(compiled.assembly));
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, expected);
    assert.equal(vm.stackBudget.frames.size, 0);
    assert.equal(vm.frameIndex.size, 0);
  });
}

test('T04.4 fault is selected only on exceptional exit and cleanup order is innermost first', () => {
  const outer = {flags: 2, start: 0, end: 40, target: 40};
  const middle = {flags: 4, start: 5, end: 30, target: 30};
  const inner = {flags: 2, start: 10, end: 20, target: 20};
  const frame = {method: {handlers: [outer, middle, inner]}};
  assert.deepEqual(cleanupClauses(frame, 15, 50, false), [inner, outer]);
  assert.deepEqual(cleanupClauses(frame, 15, 50, true), [inner, middle, outer]);
  assert.deepEqual(cleanupClauses(frame, 15, 25, true), [inner]);
  assert.deepEqual(cleanupClauses({...frame, needsInitialization: true}, 15, 50, true), []);
});
