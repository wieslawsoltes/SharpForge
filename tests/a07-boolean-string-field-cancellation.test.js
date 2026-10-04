import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {fieldReference} from './fixtures/a07/readonly-fields.js';
import {booleanFieldHost, booleanFieldEngines, assertStringInitializationReleased, observeAllocation} from './fixtures/a07/boolean-string-fields.js';

for (const engine of booleanFieldEngines) {
  for (const kind of ['field', 'literal']) {
    for (const completed of [false, true]) {
      test(`String cancellation ${engine}/${kind}, completed ${completed}: host stop prevents publication and restore permits retry`, () => {
        const host = booleanFieldHost(engine, {weakStringInterning: true});
        const {vm} = host;
        let undo = () => {};
        try {
          const saved = vm.snapshot();
          if (completed) {
            assert.equal(vm.run().state, 'terminated');
            assert.equal(vm.platform.bclHost.isExecutionStopped(vm.platform), false);
            const existing = kind === 'field' ? host.read() : host.literal();
            assert.equal(vm.heap.get(existing).data, 'True', 'Natural Main completion still permits ordinary host reads');
          }
          let stopped = 0;
          undo = observeAllocation(host, () => {
            stopped++;
            vm.stop();
            assert.throws(() => vm.snapshot(), /synchronous host callbacks/);
            assert.throws(() => vm.restore(saved), /synchronous host callbacks/);
          });
          const result = kind === 'field' ? host.read('FalseString') : host.literal('False');
          assert.equal(stopped, 1);
          assert.equal(result, null);
          assert.equal(vm.state, 'terminated');
          assert.equal(vm.platform.bclHost.isExecutionStopped(vm.platform), true);
          assert.equal(host.has('FalseString'), false);
          assert.equal(vm.strings.has('False'), false);
          assert.equal(vm.fault, null);
          assert.equal(vm.pendingFault, null);
          assertStringInitializationReleased(host);
          undo();
          assert.doesNotThrow(() => vm.snapshot());
          vm.restore(saved);
          assert.equal(vm.platform.bclHost.isExecutionStopped(vm.platform), false);
          const retry = kind === 'field' ? host.read('FalseString') : host.literal('False');
          assert.equal(vm.heap.get(retry).data, 'False');
          assertStringInitializationReleased(host);
        } finally { undo(); host.stop(); }
      });
    }

    test(`String cancellation ${engine}/${kind}: explicit stop wins over a later observer exception`, () => {
      const host = booleanFieldHost(engine, {weakStringInterning: true});
      const undo = observeAllocation(host, () => { host.vm.stop(); throw new Error('Stopped allocation observer'); });
      try {
        assert.equal(kind === 'field' ? host.read() : host.literal(), null);
        assert.equal(host.has('TrueString'), false);
        assert.equal(host.vm.strings.has('True'), false);
        assert.equal(host.vm.fault, null);
        assert.equal(host.vm.pendingFault, null);
        assertStringInitializationReleased(host);
      } finally { undo(); host.stop(); }
    });
  }
}

function independentInstructions(kind) {
  return managedFixture({methods: [{name: 'Main', result: 'void', body(writer, context) {
    if (kind === 'field') {
      writer.op('ldsfld', fieldReference(context, {owner: 'System.Boolean', name: 'TrueString', type: 'string'}));
    } else if (kind === 'literal') writer.op('ldstr', 0x70000000 | context.md.userString('True'));
    else writer.op('ldc.i4.0').op('newarr', context.resolve('System.Char'))
      .op('newobj', context.member('System.String', '.ctor', 'void', ['char[]'], false));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret');
  }}]});
}

function instructionVM(engine, kind) {
  if (engine === 'cil') return new CilVirtualMachine(independentInstructions(kind), {weakStringInterning: true});
  const expression = kind === 'field' ? 'System.Boolean.TrueString' : '"True"';
  const program = compileToIL(`class Program { static void Main() { System.Console.WriteLine(${expression}); } }`);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return new VirtualMachine(engine === 'reload' ? loadAssembly(program.assembly) : program.image, {weakStringInterning: true});
}

for (const engine of booleanFieldEngines) {
  // String(char[]) is an existing direct-CIL intrinsic, without a source constructor contract.
  const kinds = engine === 'cil' ? ['field', 'literal', 'empty-string-constructor'] : ['field', 'literal'];
  for (const kind of kinds) {
    test(`String cancellation ${engine}/${kind}: a real allocating instruction cannot repopulate retired stacks`, () => {
      const vm = instructionVM(engine, kind);
      const host = {vm};
      const saved = vm.snapshot();
      const text = kind === 'empty-string-constructor' ? '' : 'True';
      let stopped = 0, frames = [], stacks = [];
      const undo = observeAllocation(host, () => {
        const reference = vm.heap.pins.at(-1);
        if (!reference || vm.heap.get(reference).kind !== 'string' || vm.heap.get(reference).data !== text) return;
        stopped++;
        frames = [...vm.frames];
        stacks = engine === 'cil' ? frames.map(frame => frame.stack) : [vm.stack];
        vm.stop();
      });
      try {
        const result = vm.run();
        assert.equal(stopped, 1);
        assert.equal(result.state, 'terminated');
        assert.equal(result.fault, null);
        assert.equal(result.output, '', 'Execution stops before the following Console call');
        assert.equal(vm.strings.has(text), false);
        assert.equal(vm.frames.length, 0);
        for (const stack of stacks) assert.equal(stack.length, 0, 'No result is pushed into retired storage');
        assertStringInitializationReleased(host);
        undo();
        vm.restore(saved);
        const replay = vm.run();
        assert.equal(replay.state, 'terminated', replay.fault?.stack);
        assert.equal(replay.output, text + '\n');
      } finally { undo(); vm.stop(); }
    });
  }
}
