import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from '../managed-fixtures.js';

export const stopwatchType = 'System.Diagnostics.Stopwatch';

export function stopwatchContract(name, parameters = []) {
  const descriptor = findContracts(stopwatchType, name).find(item => item.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing Stopwatch.${name}(${parameters.join(',')})`);
  return descriptor;
}

let program;
export function stopwatchPlatform(engine, options = {}) {
  program ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(program.image, options) : new CilVirtualMachine(program.assembly, options);
  const platform = vm.platform;
  const reference = platform.invoke(stopwatchContract('.ctor'), []);
  const handle = platform.heap.createHandle(reference);
  const call = (name, parameters = [], values = []) => platform.invoke(stopwatchContract(name, parameters), [reference, ...values]);
  const staticCall = (name, parameters = [], values = []) => platform.invoke(stopwatchContract(name, parameters), values);
  const span = (value, name = 'TotalMilliseconds') => platform.native(platform.invoke(findContracts('System.TimeSpan', 'get_' + name)[0], [value]));
  return {vm, platform, reference, call, staticCall, span,
    stop() { platform.heap.releaseHandle(handle); vm.stop(); }};
}

/** Real Int64 constants and ordinary metadata calls, independent of source compilation and the emitted profile. */
export function stopwatchElapsedAssembly(row) {
  return managedFixture({fields: [{name: 'Elapsed', type: 'System.TimeSpan'}],
    methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
      writer.op('ldc.i8', BigInt(row.start)).op('ldc.i8', BigInt(row.end));
      writer.op('call', context.member(stopwatchType, 'GetElapsedTime', 'System.TimeSpan', ['long', 'long']));
      writer.op('stsfld', 0x04000000 | context.fields.Elapsed).op('ret');
    }}]});
}

export function stopwatchStateAssembly() {
  const fields = [['Watch', stopwatchType], ['Ticks', 'long'], ['Milliseconds', 'long'],
    ['Elapsed', 'System.TimeSpan'], ['Running', 'bool'], ['Text', 'string'], ['Stamp', 'long'],
    ['Since', 'System.TimeSpan'], ['NewWatch', stopwatchType]].map(([name, type]) => ({name, type}));
  return managedFixture({fields, methods: [{name: 'Main', result: 'void', maxStack: 2, body(writer, context) {
    const field = name => 0x04000000 | context.fields[name];
    const instance = (name, result = 'void') => writer.op('ldsfld', field('Watch'))
      .op('callvirt', context.member(stopwatchType, name, result, [], false));
    writer.op('newobj', context.member(stopwatchType, '.ctor', 'void', [], false)).op('stsfld', field('Watch'));
    for (const name of ['Start', 'Start', 'Stop', 'Reset', 'Restart', 'Stop', 'Stop']) instance(name);
    for (const [name, result, target] of [['get_ElapsedTicks', 'long', 'Ticks'], ['get_ElapsedMilliseconds', 'long', 'Milliseconds'],
      ['get_Elapsed', 'System.TimeSpan', 'Elapsed'], ['get_IsRunning', 'bool', 'Running'], ['ToString', 'string', 'Text']]) {
      instance(name, result).op('stsfld', field(target));
    }
    writer.op('call', context.member(stopwatchType, 'StartNew', stopwatchType)).op('stsfld', field('NewWatch'));
    writer.op('ldsfld', field('NewWatch')).op('callvirt', context.member(stopwatchType, 'Stop', 'void', [], false));
    writer.op('call', context.member(stopwatchType, 'GetTimestamp', 'long')).op('stsfld', field('Stamp'));
    writer.op('ldc.i8', 0n).op('call', context.member(stopwatchType, 'GetElapsedTime', 'System.TimeSpan', ['long']));
    writer.op('stsfld', field('Since')).op('ret');
  }}]});
}
