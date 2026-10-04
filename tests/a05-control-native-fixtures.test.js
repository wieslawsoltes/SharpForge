import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

for (const name of ['exception-event-identity', 'synchronization']) {
  const directory = new URL(`./fixtures/a05/${name}/`, import.meta.url);
  const source = readFileSync(new URL('Program.cs', directory), 'utf8');
  const expected = readFileSync(new URL('expected.txt', directory), 'utf8');
  const compiled = compileToIL(source);
  assert(compiled.success, `${name}: ${JSON.stringify(compiled.diagnostics)}`);
  for (const engine of ['source', 'reload', 'cil']) {
    test(`${engine}: retained ${name} native fixture has its exact deterministic trace`, async () => {
      const options = {virtualTime: true, maxInstructions: 100000};
      const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
        : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
      try {
        const result = await vm.runAsync();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, expected);
        assert.equal(result.exitCode, 0);
        if (name === 'synchronization') {
          assert.equal(vm.sync.blocks.size, 0);
          assert.deepEqual(vm.sync.deadlocks().cycles, []);
          assert.equal([...vm.scheduler.contexts.values()].filter(context => context.status === 'waiting').length, 0);
        }
      } finally { vm.stop(); }
    });
  }
}
