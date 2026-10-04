import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {stopwatchPlatform} from './fixtures/stopwatch.js';
import {managedFixture} from './managed-fixtures.js';

const operations = [
  {name: 'GetTimestamp', invoke: watch => watch.staticCall('GetTimestamp')},
  {name: 'StartNew', invoke: watch => watch.staticCall('StartNew')},
  {name: 'GetElapsedTime', invoke: watch => watch.staticCall('GetElapsedTime', ['long'], [0n])},
  {name: 'Start', invoke: watch => watch.call('Start')},
  ...['Stop', 'Restart', 'get_ElapsedTicks', 'get_ElapsedMilliseconds', 'get_Elapsed', 'ToString']
    .map(name => ({name, running: true, invoke: watch => watch.call(name)})),
  {name: 'Object.ToString', running: true, marker: true,
    invoke: watch => watch.platform.bclHost.invokeObjectToString(watch.platform, watch.reference)}
];

function canceledPlatformCall(engine, operation, exit) {
  let cancel = false, stopped;
  const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
    if (!cancel) return 1000n;
    const reference = watch.platform.stopwatchClockState.reference ?? watch.reference;
    const data = [...watch.platform.record(reference).data];
    watch.vm.stop();
    stopped = {reference, data, allocations: watch.platform.heap.stats.allocations,
      bytes: watch.platform.heap.stats.allocatedBytes, writes: watch.vm.writeRevision};
    if (exit === 'throw') throw new Error('Host stopped and then threw');
    return 1_500_000_000n;
  }});
  try {
    if (operation.running) watch.call('Start');
    else watch.staticCall('GetTimestamp');
    cancel = true;
    const result = operation.invoke(watch);
    assert(stopped, operation.name);
    assert.deepEqual(result, operation.marker ? {handled: true, value: null, canceled: true} : null);
    assert.equal(watch.vm.state, 'terminated');
    assert.equal(watch.vm.fault, null);
    assert.equal(watch.vm.pendingFault, null);
    assert.deepEqual(watch.platform.record(stopped.reference).data, stopped.data, operation.name);
    assert.equal(watch.platform.heap.stats.allocations, stopped.allocations, operation.name);
    assert.equal(watch.platform.heap.stats.allocatedBytes, stopped.bytes, operation.name);
    assert.equal(watch.vm.writeRevision, stopped.writes, operation.name);
    assert.equal(watch.platform.stopwatchClockState.previous, 1000n, operation.name);
    assert.equal(watch.platform.stopwatchClockState.reading, false);
    assert.equal(watch.platform.stopwatchClockState.reference, null);
    assert.equal(watch.platform.heap.pins.length, 0);
  } finally { watch.stop(); }
}

for (const engine of ['source', 'cil']) {
  test(`Stopwatch ${engine}: clock host-stop cancels every pending operation before writes or result allocation`, () => {
    for (const exit of ['return', 'throw']) {
      for (const operation of operations) canceledPlatformCall(engine, operation, exit);
    }
  });
}

const engines = {
  source: (program, options) => new VirtualMachine(program.image, options),
  reload: (program, options) => new VirtualMachine(loadAssembly(program.assembly), options),
  cil: (program, options) => new CilVirtualMachine(program.assembly, options)
};

function assertGuestCancellation(create, program, exit) {
  let vm, reads = 0, stopped;
  vm = create(program, {stopwatchClock: () => {
    if (++reads === 1) return 1000n;
    const reference = vm.platform.stopwatchClockState.reference;
    const data = [...vm.platform.record(reference).data], stack = vm.inspector ? vm.top.stack : vm.stack;
    vm.stop();
    stopped = {reference, data, stack, allocations: vm.heap.stats.allocations,
      bytes: vm.heap.stats.allocatedBytes, writes: vm.writeRevision};
    if (exit === 'throw') throw new Error('Host stopped and then threw');
    return -1n; // Cancellation precedes both timestamp validation and diagnostic translation.
  }});
  try {
    const result = vm.run();
    assert.equal(reads, 2);
    assert(stopped);
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.fault, null);
    assert.equal(result.output, '');
    assert.equal(vm.pendingFault, null);
    assert.equal(vm.frames.length, 0);
    assert.equal(vm.allFrames().length, 0);
    assert.equal(vm.stack?.length ?? 0, 0);
    assert.equal(stopped.stack.length, 0, 'A canceled result must not enter its retired caller stack');
    assert.deepEqual(vm.platform.record(stopped.reference).data, stopped.data);
    assert.equal(vm.heap.stats.allocations, stopped.allocations);
    assert.equal(vm.heap.stats.allocatedBytes, stopped.bytes);
    assert.equal(vm.writeRevision, stopped.writes);
    assert.equal(vm.platform.stopwatchClockState.previous, 1000n);
    assert.equal(vm.platform.stopwatchClockState.reading, false);
    assert.equal(vm.platform.stopwatchClockState.reference, null);
    assert.equal(vm.heap.pins.length, 0);
    assert.equal(vm.run().output, '');
  } finally { vm.stop(); }
}

for (const pipeline of ['bound', 'legacy']) {
  for (const [engine, create] of Object.entries(engines)) {
    test(`Stopwatch cancellation ${pipeline}/${engine}: a real host stop publishes no elapsed or virtual string result`, () => {
      for (const expression of ['watch.Elapsed.TotalMilliseconds', 'value.ToString()']) {
        const program = compileToIL(`using System; using System.Diagnostics;
          var watch = new Stopwatch(); object value = watch; watch.Start();
          try { Console.WriteLine(${expression}); }
          catch (Exception error) { Console.WriteLine("caught"); }
          Console.WriteLine("after");`, {pipeline});
        assert.equal(program.success, true, JSON.stringify(program.diagnostics));
        for (const exit of ['return', 'throw']) assertGuestCancellation(create, program, exit);
      }
    });
  }
}

function cancellationAssembly() {
  const owner = 'System.Diagnostics.Stopwatch';
  return managedFixture({name: 'StopwatchCancellation', methods: [{name: 'Main', result: 'void',
    locals: [owner], maxStack: 1, body(writer, context) {
      writer.op('newobj', context.member(owner, '.ctor', 'void', [], false)).op('stloc.0');
      writer.op('ldloc.0').op('callvirt', context.member(owner, 'Start', 'void', [], false));
      writer.op('ldloc.0').op('callvirt', context.member('System.Object', 'ToString', 'string', [], false));
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
      writer.op('ldstr', 0x70000000 + context.md.userString('after'));
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret');
    }}]});
}

test('Stopwatch cancellation independent CIL: a clock host-stop aborts Object virtual dispatch and its caller', () => {
  const program = {assembly: cancellationAssembly()};
  for (const exit of ['return', 'throw']) assertGuestCancellation(engines.cil, program, exit);
});
