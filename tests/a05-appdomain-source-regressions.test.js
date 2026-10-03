import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const compiledPrograms = new Map();
function compiled(source) {
  if (!compiledPrograms.has(source)) {
    const artifact = compileToIL(source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    compiledPrograms.set(source, artifact);
  }
  return compiledPrograms.get(source);
}
function machine(engine, source) {
  const artifact = compiled(source);
  return engine === 'cil' ? new CilVirtualMachine(artifact.assembly, {virtualTime: true})
    : new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), {virtualTime: true});
}

const subscriptions = `using System;using System.Runtime.ExceptionServices;
class P {
  void First(object sender,FirstChanceExceptionEventArgs args){Console.WriteLine(args.Exception.Message);}
  static void Main(){Action semantic=()=>{};semantic();P target=new P();
    AppDomain.CurrentDomain.FirstChanceException+=target.First;
    AppDomain.CurrentDomain.FirstChanceException+=target.First;
    AppDomain.CurrentDomain.FirstChanceException-=target.First;
    AppDomain.CurrentDomain.FirstChanceException+=null;
    try{throw new Exception("caught");}catch(Exception){Console.WriteLine("done");}}
}`;

function asynchronous(returnType, semantic) {
  return `using System;using System.Threading.Tasks;using System.Runtime.ExceptionServices;
  class P {
    static void First(object sender,FirstChanceExceptionEventArgs args){Console.WriteLine("first");}
    static void Last(object sender,UnhandledExceptionEventArgs args){Console.WriteLine("unhandled");}
    static async ${returnType} Fail(){await Task.Delay(1);throw new Exception("async");}
    static void Main(){${semantic ? 'Action semantic=()=>{};semantic();' : ''}
      AppDomain.CurrentDomain.FirstChanceException+=First;
      AppDomain.CurrentDomain.UnhandledException+=Last;Fail();Console.WriteLine("caller");}
  }`;
}

const terminating = `using System;class P {
  static void Last(object sender,UnhandledExceptionEventArgs args){
    Console.WriteLine(Object.ReferenceEquals(sender,null));Console.WriteLine(args.IsTerminating);}
  static void Main(){AppDomain.CurrentDomain.UnhandledException+=Last;throw new Exception("terminal");}
}`;

for (const engine of ['source', 'reloaded-source', 'cil']) {
  test(`T04 ${engine}: semantic event lowering preserves instance method identity and null handlers`, () => {
    const result = machine(engine, subscriptions).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, 'caught\ndone\n');
  });

  for (const semantic of [false, true]) {
    test(`T04 ${engine}: ${semantic ? 'semantic' : 'legacy'} async void posts a terminating fault`, async () => {
      const result = await machine(engine, asynchronous('void', semantic)).runAsync();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.message, 'async');
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.output, 'caller\nfirst\nunhandled\n');
    });
  }

  test(`T04 ${engine}: an unobserved async Task keeps task-owned fault semantics`, async () => {
    const result = await machine(engine, asynchronous('Task', true)).runAsync();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, 'caller\nfirst\n');
  });

  test(`T04 ${engine}: an unhandled observer restores its null sender and original fault`, async () => {
    const original = machine(engine, terminating);
    for (let step = 0; step < 2000 && !original.frames.some(frame => frame.exceptionEventContinuation?.phase === 'unhandled'); step++) {
      original.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    assert(original.frames.some(frame => frame.exceptionEventContinuation?.phase === 'unhandled'));
    const wire = await serializeSnapshot(original, original.snapshot(), {json: true});
    original.stop();
    const fresh = machine(engine, terminating);
    await restoreSerializedSnapshot(fresh, wire);
    fresh.heap.collect();
    const invalid = fresh.snapshot();
    const continuation = invalid.frames.find(frame => frame.exceptionEventContinuation)?.exceptionEventContinuation;
    continuation.args[0] = new Map(invalid.platform.singletons).get('AppDomain.CurrentDomain');
    assert.throws(() => fresh.restore(invalid), /exception events arguments/);
    const result = fresh.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.message, 'terminal');
    assert.equal(result.output, 'True\nTrue\n');
  });
}
