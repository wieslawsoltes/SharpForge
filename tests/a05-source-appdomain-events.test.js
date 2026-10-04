import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const prefix = 'using System;using System.Runtime.ExceptionServices;';
const sources = {
  subscriptions: `class P {
    void First(object sender,FirstChanceExceptionEventArgs args){Console.WriteLine(args.Exception.Message);}
    static void Main(){P target=new P();
      AppDomain.CurrentDomain.FirstChanceException+=target.First;
      AppDomain.CurrentDomain.FirstChanceException+=target.First;
      AppDomain.CurrentDomain.FirstChanceException-=target.First;
      AppDomain.CurrentDomain.FirstChanceException+=null;
      try{throw new Exception("caught");}catch(Exception){Console.WriteLine("done");}}}
  `,
  lambda: `class P {static void Main(){int calls=0;
    AppDomain.CurrentDomain.FirstChanceException+=(sender,args)=>{calls++;Console.WriteLine(args.Exception.Message);};
    try{throw new Exception("one");}catch(Exception){}
    try{throw new Exception("two");}catch(Exception){}
    Console.WriteLine(calls);}}
  `,
  variables: `class P {
    void First(object sender,FirstChanceExceptionEventArgs args){Console.WriteLine("first:"+args.Exception.Message);}
    static void Second(object sender,FirstChanceExceptionEventArgs args){Console.WriteLine("second");}
    static void Main(){P target=new P();EventHandler<FirstChanceExceptionEventArgs> first=target.First,second=Second;
      Console.WriteLine(first==target.First);
      EventHandler<FirstChanceExceptionEventArgs> combined=first+second+first;
      AppDomain.CurrentDomain.FirstChanceException+=combined;
      AppDomain.CurrentDomain.FirstChanceException-=first+second;
      try{throw new Exception("saved");}catch(Exception){}
      AppDomain.CurrentDomain.FirstChanceException-=first;
      int calls=0;EventHandler<FirstChanceExceptionEventArgs> capture=(sender,args)=>{calls++;};
      AppDomain.CurrentDomain.FirstChanceException+=capture;
      try{throw new Exception("counted");}catch(Exception){}
      AppDomain.CurrentDomain.FirstChanceException-=capture;
      try{throw new Exception("removed");}catch(Exception){}
      Console.WriteLine(calls);}}
  `,
  terminal: `class P {
    static void Last(object sender,UnhandledExceptionEventArgs args){
      Console.WriteLine(Object.ReferenceEquals(sender,null));Console.WriteLine(args.IsTerminating);}
    static void Main(){AppDomain.CurrentDomain.UnhandledException+=Last;throw new Exception("terminal");}}
  `
};
const create = (compiled, engine) => engine === 'cil' ? new CilVirtualMachine(compiled.assembly, {virtualTime: true})
  : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, {virtualTime: true});

for (const engine of ['source', 'reload', 'cil']) {
  for (const [name, output] of [['subscriptions', 'caught\ndone\n'], ['lambda', 'one\ntwo\n2\n'], ['variables', 'True\nfirst:saved\n1\n']]) {
    test(`${engine}: AppDomain ${name} execute guest delegates with exact subscription identity`, () => {
      const compiled = compileToIL(prefix + sources[name]);
      assert(compiled.success, JSON.stringify(compiled.diagnostics));
      const vm = create(compiled, engine);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, output);
      } finally { vm.stop(); }
    });
  }

  test(`${engine}: suspended unhandled guest callback survives local and portable replay`, async () => {
    const compiled = compileToIL(prefix + sources.terminal);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = create(compiled, engine);
    for (let step = 0; step < 3000 && !vm.frames.some(frame => frame.exceptionEventContinuation?.phase === 'unhandled'); step++)
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert(vm.frames.some(frame => frame.exceptionEventContinuation?.phase === 'unhandled'));
    const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
    vm.stop();vm.heap.collect();
    const fresh = create(compiled, engine);
    await restoreSerializedSnapshot(fresh, wire);
    vm.restore(saved);
    for (const replay of [vm, fresh]) {
      replay.heap.collect();
      if (replay.state === 'paused') replay.state = 'running';
      const result = replay.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.message, 'terminal');
      assert.equal(result.output, 'True\nTrue\n');
      replay.stop();
    }
  });
}
