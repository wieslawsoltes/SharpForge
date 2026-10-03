import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';

const source=readFileSync(new URL('./fixtures/a05/synchronization/Program.cs',import.meta.url),'utf8');
const expected=readFileSync(new URL('./fixtures/a05/synchronization/expected.txt',import.meta.url),'utf8');
const pending='using System.Threading;class P{static object gate=new object();static void Wake(){Thread.Sleep(10);Monitor.Enter(gate);Monitor.Pulse(gate);Monitor.Exit(gate);}static void Main(){Thread worker=new Thread(Wake);worker.Start();Monitor.Enter(gate);Monitor.Enter(gate);Console.WriteLine(Monitor.Wait(gate));Monitor.Exit(gate);Console.WriteLine(Monitor.IsEntered(gate));Monitor.Exit(gate);worker.Join();}}';
const make=(engine,text,options={})=>{const compiled=compileToIL(text);assert(compiled.success,JSON.stringify(compiled.diagnostics));return engine==='source'?new VirtualMachine(compiled.image,{virtualTime:true,schedulerQuantum:7,...options}):new CilVirtualMachine(compiled.assembly,{virtualTime:true,schedulerQuantum:7,...options});};

for(const engine of ['source','cil']) {
  test(`A05 T30 ${engine}: reentrant Monitor ping-pong, atomic increments and volatile publication`,async()=>{
    const vm=make(engine,source),result=await vm.runAsync();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,expected);
    assert.equal(vm.sync.blocks.size,0);
  });
  test(`A05 T30 ${engine}: lock lowers to a reentrant monitor with finally cleanup`,async()=>{
    const text='using System.Threading;class P{static void Main(){object gate=new object();try{lock(gate){lock(gate){Console.WriteLine(Monitor.IsEntered(gate));throw new Exception();}}}catch(Exception error){}Console.WriteLine(Monitor.IsEntered(gate));}}';
    const result=await make(engine,text).runAsync();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'True\nFalse\n');
  });
  test(`A05 T30 ${engine}: snapshot restores wait queues, timeout state and original recursion`,async()=>{
    const vm=make(engine,pending);vm.run();assert.equal(vm.state,'waiting');assert(vm.sync.blocks.size>0);
    const snapshot=vm.snapshot(),first=await vm.runAsync();assert.equal(first.output,'True\nTrue\n');
    vm.restore(snapshot);vm.heap.collect();const replay=await vm.runAsync();assert.equal(replay.state,'terminated',replay.fault?.stack);assert.equal(replay.output,first.output);
  });
  test(`A05 T30 ${engine}: cancellation clears synchronization roots and pending contexts`,async()=>{
    const vm=make(engine,pending);vm.run();assert.equal(vm.state,'waiting');const controller=new AbortController();controller.abort();
    await assert.rejects(vm.runAsync({signal:controller.signal}),{name:'OperationCanceledException'});assert.equal(vm.sync.blocks.size,0);assert.equal([...vm.sync.roots()].length,0);
    assert(vm.scheduler.threads().every(context=>['completed','canceled','faulted'].includes(context.status)));
  });
}
