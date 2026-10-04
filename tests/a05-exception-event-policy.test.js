import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const fixtures = ['first-chance-policy', 'unhandled-policy'].map(name => {
  const directory = new URL(`./fixtures/a05/${name}/`, import.meta.url);
  const compiled = compileToIL(readFileSync(new URL('Program.cs', directory), 'utf8'));
  assert(compiled.success, `${name}: ${JSON.stringify(compiled.diagnostics)}`);
  return {name, compiled, expected: readFileSync(new URL('expected.txt', directory), 'utf8'),
    fault: name === 'unhandled-policy' ? 'System.Exception' : 'ExecutionEngineException'};
});

function create(compiled, engine) {
  const options = {weakStringInterning: true, maxInstructions: 20000};
  return engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
    : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
}

function verify(vm, fixture) {
  if (vm.state === 'paused') vm.state = 'running';
  const result = vm.run();
  assert.equal(result.state, 'faulted', result.fault?.stack);
  assert.equal(result.output, fixture.expected);
  assert.equal(result.fault.name, fixture.fault);
  assert.notEqual(result.exitCode, 0);
  if (fixture.name === 'unhandled-policy') {
    assert.equal(result.fault.message, 'terminal');
  } else {
    assert.equal(result.fault.fatal, true);
    assert.equal(result.exitCode, 0x80131506 | 0);
    assert.equal(result.fault.eventFailureName, 'System.Exception');
    assert.equal(result.fault.message, 'FirstChanceException handler escaped: subscriber');
    assert(vm.frames.some(frame => frame.exceptionEventContinuation?.fault.message === 'original'),
      'Failfast retains the original notification and throwing frames for inspection');
  }
}

for (const engine of ['source', 'reload', 'cil']) for (const fixture of fixtures) {
  test(`${engine}: ${fixture.name} follows pinned CoreCLR callback failure and notification order`, () => {
    const vm = create(fixture.compiled, engine);
    try { verify(vm, fixture); }
    finally { vm.stop(); }
  });

  for (const methodName of ['First', 'Second']) {
    test(`${engine}: ${fixture.name} ${methodName} callback preserves policy through local and portable restore`, async () => {
      const vm = create(fixture.compiled, engine);
      let found = false;
      for (let step = 0; step < 3000; step++) {
        const frame = vm.top, method = frame?.method ?? vm.image?.methods[frame?.methodId];
        if (method?.name === methodName && frame.exceptionEventContinuation) { found = true; break; }
        if (!['ready', 'running', 'paused'].includes(vm.state)) break;
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      }
      assert(found, `Expected active ${methodName} event frame`);
      const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
      verify(vm, fixture);
      vm.stop();
      vm.heap.collect();
      const fresh = create(fixture.compiled, engine);
      try {
        await restoreSerializedSnapshot(fresh, wire);
        vm.restore(saved);
        for (const replay of [vm, fresh]) {
          replay.heap.collect();
          verify(replay, fixture);
        }
      } finally { vm.stop(); fresh.stop(); }
    });
  }
}
