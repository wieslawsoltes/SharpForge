import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, instructionProfile} from '@sharpforge/runtime';

function timed(engine, source) {
  const artifact = compileToIL(source);
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  let now = 0;
  const options = {profile: {duration: true, clock: () => now}, onOutput: () => { now = 1e308; }};
  return engine === 'cil' ? new CilVirtualMachine(artifact.assembly, options)
    : new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, options);
}

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: recursive inclusive duration overflow latches a host failure`, () => {
    const vm = timed(engine, `class Program {
      static void Recur(int n) { if (n > 0) Recur(n - 1); else Console.Write("spike"); }
      static void Main() { Recur(2); }
    }`);
    const overflow = error => error instanceof RangeError && /inclusive duration overflow/.test(error.message);
    assert.throws(() => vm.run(), overflow);
    assert.equal(vm.fault, null);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.output.join(''), 'spike');
    assert.throws(() => instructionProfile(vm), overflow);
    assert.throws(() => vm.stop(), overflow);
    assert.equal(vm.frames.length, 0);
  });

  test(`${engine}: a finite large nonrecursive interval remains valid`, () => {
    const vm = timed(engine, 'class Program { static void Main() { Console.Write("spike"); } }');
    try {
      assert.equal(vm.run().output, 'spike');
      const profile = instructionProfile(vm);
      assert.equal(profile.duration.totalMilliseconds, 1e308);
      assert(profile.methods.every(method => Number.isFinite(method.inclusiveMilliseconds)));
    } finally { vm.stop(); }
  });
}
