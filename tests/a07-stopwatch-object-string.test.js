import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const owner = 'System.Diagnostics.Stopwatch';
const timestamps = [9_007_199_254_740_993n, 9_007_200_754_740_993n, 9_007_201_254_740_993n];
const engines = {
  source: (program, options) => new VirtualMachine(program.image, options),
  reload: (program, options) => new VirtualMachine(loadAssembly(program.assembly), options),
  cil: (program, options) => new CilVirtualMachine(program.assembly, options)
};

const source = `using System; using System.Diagnostics;
  var watch = new Stopwatch();
  object value = watch;
  Console.WriteLine(value.ToString());
  Console.WriteLine(Convert.ToString(value)); Console.WriteLine(value);
  watch.Start();
  Console.WriteLine(value.ToString()); Console.WriteLine(watch.IsRunning);
  Console.WriteLine(Convert.ToString(value)); Console.WriteLine(value);
  watch.Stop();
  Console.WriteLine(value.ToString()); Console.WriteLine(watch.ElapsedTicks); Console.WriteLine(watch.IsRunning);
  watch.Reset(); Console.WriteLine(value.ToString());
`;
const compiledOutput = ['00:00:00', owner, owner, '00:00:01.5000000', 'True', owner, owner,
  '00:00:02', '2000000000', 'False', '00:00:00'].join('\n') + '\n';

for (const pipeline of ['bound', 'legacy']) {
  for (const [engine, create] of Object.entries(engines)) {
    test(`Stopwatch Object.ToString ${pipeline}/${engine}: running and stopped overrides preserve Convert and Console formatting`, () => {
      const program = compileToIL(source, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const inspector = new AssemblyInspector(program.assembly);
      const calls = inspector.callGraph().filter(call => call.callee)
        .map(call => ({...call, member: inspector.resolveToken(call.callee)}));
      const objectCalls = calls.filter(call => call.member.owner === 'System.Object' && call.member.name === 'ToString');
      assert.equal(objectCalls.length, 4);
      assert(objectCalls.every(call => call.kind === 'callvirt' && !call.member.signature.isStatic &&
        call.member.signature.parameters.length === 0));
      const convertCalls = calls.filter(call => call.member.owner === 'System.Convert' && call.member.name === 'ToString');
      assert.equal(convertCalls.length, 2);
      assert(convertCalls.every(call => call.kind === 'call' && call.member.signature.isStatic));
      let reads = 0;
      const vm = create(program, {stopwatchClock: () => timestamps[reads++]});
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, compiledOutput);
        assert.equal(reads, 3, 'Only Start, the running virtual ToString and Stop read the clock');
      } finally { vm.stop(); }
    });
  }
}

/** Object member references and call opcodes are authored without a source compiler or emitted profile. */
function objectStringAssembly() {
  return managedFixture({name: 'StopwatchObjectString', methods: [{name: 'Main', result: 'void', locals: [owner],
    maxStack: 1, body(writer, context) {
      const print = type => writer.op('call', context.member('System.Console', 'WriteLine', 'void', [type]));
      const instance = (name, result = 'void') => writer.op('ldloc.0')
        .op('callvirt', context.member(owner, name, result, [], false));
      const render = () => {
        for (const kind of ['callvirt', 'call']) {
          writer.op('ldloc.0').op(kind, context.member('System.Object', 'ToString', 'string', [], false));
          print('string');
        }
        writer.op('ldloc.0').op('call', context.member('System.Convert', 'ToString', 'string', ['object']));
        print('string');
        writer.op('ldloc.0'); print('object');
        instance('get_IsRunning', 'bool'); print('bool');
      };
      writer.op('newobj', context.member(owner, '.ctor', 'void', [], false)).op('stloc.0');
      instance('Start'); render();
      instance('Stop'); render();
      instance('get_ElapsedTicks', 'long'); print('long');
      writer.op('ret');
    }}]});
}

test('Stopwatch Object.ToString independent CIL: only virtual Object calls dispatch while Convert and Console retain type names', () => {
  let reads = 0;
  const vm = new CilVirtualMachine(objectStringAssembly(), {stopwatchClock: () => timestamps[reads++]});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, ['00:00:01.5000000', owner, owner, owner, 'True',
      '00:00:02', owner, owner, owner, 'False', '2000000000'].join('\n') + '\n');
    assert.equal(reads, 3, 'Nonvirtual Object calls and Convert/Console formatting must not read the clock');
  } finally { vm.stop(); }
});
