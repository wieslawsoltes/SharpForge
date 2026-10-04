import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const prefix = 'using System;using System.Threading;';
const factories = {
  source: compiled => new VirtualMachine(compiled.image, {virtualTime: true}),
  reload: compiled => new VirtualMachine(loadAssembly(compiled.assembly), {virtualTime: true}),
  cil: compiled => new CilVirtualMachine(compiled.assembly, {virtualTime: true})
};
const cases = [
  ['lock evaluates once, reenters and releases ownership', `
    class Gate {} class P {
      static Gate gate = new Gate(); static int calls;
      static Gate Get(){calls++;return gate;}
      static void Main(){
        lock(Get()){Console.WriteLine(Monitor.IsEntered(gate));lock(gate){Console.WriteLine(Monitor.IsEntered(gate));}}
        Console.WriteLine(Monitor.IsEntered(gate));Console.WriteLine(calls);
      }
    }`, 'True\nTrue\nFalse\n1\n'],
  ['lock cleanup survives return and exception', `
    class Gate {} class P {
      static Gate gate = new Gate();
      static int Get(){lock(gate){return 7;}}
      static void Main(){Console.WriteLine(Get());Console.WriteLine(Monitor.IsEntered(gate));
        try{lock(gate){throw new InvalidOperationException("saved");}}catch(InvalidOperationException){Console.WriteLine("caught");}
        Console.WriteLine(Monitor.IsEntered(gate));}
    }`, '7\nFalse\ncaught\nFalse\n'],
  ['Monitor lockTaken and ownership diagnostics', `
    class Gate {} class P {static void Main(){
      var gate=new Gate();bool taken=false;Monitor.Enter(gate,ref taken);Console.WriteLine(taken);Monitor.Exit(gate);
      try{Monitor.Exit(gate);}catch(SynchronizationLockException){Console.WriteLine("unowned");}
      try{Monitor.Enter(null);}catch(ArgumentNullException){Console.WriteLine("null");}
      taken=true;try{Monitor.Enter(gate,ref taken);}catch(ArgumentException){Console.WriteLine("flag");}
      Console.WriteLine(Monitor.IsEntered(gate));
    }}`, 'True\nunowned\nnull\nflag\nFalse\n'],
  ['Interlocked scalar and Volatile Boolean storage', `
    class P {static void Main(){int value=1;Console.WriteLine(Interlocked.Increment(ref value));
      Console.WriteLine(Interlocked.CompareExchange(ref value,7,2));Console.WriteLine(value);
      Console.WriteLine(Interlocked.Add(ref value,3));
      bool flag=false;Volatile.Write(ref flag,true);Console.WriteLine(Volatile.Read(ref flag));
      Thread.MemoryBarrier();Interlocked.MemoryBarrier();
    }}`, '2\n2\n7\n10\nTrue\n'],
  ['closed generic atomic calls retain exact byref and return types', `
    class P {static void Main(){string text="first";
      Console.WriteLine(Interlocked.Exchange<string>(ref text,"second"));
      Console.WriteLine(Interlocked.CompareExchange<string>(ref text,"third","second"));
      Console.WriteLine(Volatile.Read<string>(ref text));Volatile.Write<string>(ref text,"fourth");Console.WriteLine(text);
    }}`, 'first\nsecond\nthird\nfourth\n']
];

for (const [name, source, expected] of cases) for (const [engine, create] of Object.entries(factories)) {
  test(`${engine}: ${name}`, () => {
    const compiled = compileToIL(prefix + source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = create(compiled);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, expected);
      assert.equal(vm.sync.blocks.size, 0, 'Completed programs retain no owned monitor block');
    } finally { vm.stop(); }
  });
}

test('generic synchronization reference constraints and wrong byref arguments reject during binding', () => {
  for (const source of [
    'class P {static void Main(){int value=1;Volatile.Read<int>(ref value);}}',
    'class P {static void Main(){int flag=0;Monitor.Enter("gate",ref flag);}}',
    'class P {static void Main(){int value=1;Interlocked.Increment(value);}}'
  ]) {
    const compiled = compileToIL(prefix + source);
    assert.equal(compiled.success, false);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  }
});
