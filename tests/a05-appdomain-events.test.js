import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const source = readFileSync(new URL('./fixtures/a05/appdomain-events/Program.cs', import.meta.url), 'utf8');
const expected = readFileSync(new URL('./fixtures/a05/appdomain-events/expected.txt', import.meta.url), 'utf8');
function artifact(text = source) {
  const result = compileToIL(text);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function machine(engine, compiled, options = {}) {
  return engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
    : new VirtualMachine(engine === 'source' ? compiled.image : loadAssembly(compiled.assembly), options);
}
function completed(vm) {
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.output.replaceAll('\r\n', '\n'), expected);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.fault.message, 'terminal');
  return result;
}

for (const engine of ['source', 'reloaded-source', 'cil']) {
  test(`T04 ${engine}: first-chance, removal, cleanup and unhandled notifications retain order`, () => {
    completed(machine(engine, artifact()));
  });

  test(`T04 ${engine}: a suspended event retains its original fault across GC and portable restore`, async () => {
    const compiled = artifact();
    const original = machine(engine, compiled);
    for (let step = 0; step < 2000 && original.output.join('') !== 'first:caught\n'; step++) {
      original.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    assert(original.frames.some(frame => frame.exceptionEventContinuation));
    original.heap.collect();
    const saved = original.snapshot();
    const wire = await serializeSnapshot(original, saved, {json: true});
    original.stop();
    original.heap.collect();
    const fresh = machine(engine, compiled);
    await restoreSerializedSnapshot(fresh, wire);
    fresh.heap.collect();
    if (fresh.state === 'paused') fresh.state = 'running';
    completed(fresh);
    const malformed = await restoreSerializedSnapshot(machine(engine, compiled), wire);
    const invalid = malformed.snapshot();
    invalid.frames.find(frame => frame.exceptionEventContinuation).exceptionEventContinuation.index = 9999;
    const frames = malformed.frames;
    assert.throws(() => malformed.restore(invalid), /exception events cursor/);
    assert.equal(malformed.frames, frames);
  });

  test(`T04 ${engine}: rethrow raises first chance again, and fatal limits skip guest event handlers`, () => {
    const program = `using System;using System.Runtime.ExceptionServices;class P {
      static void First(object sender,FirstChanceExceptionEventArgs args){Console.WriteLine("first");}
      static void Main(){AppDomain.CurrentDomain.FirstChanceException+=First;
        try{try{throw new Exception("same");}catch{throw;}}catch{Console.WriteLine("caught");}}
    }`;
    const result = machine(engine, artifact(program)).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, 'first\nfirst\ncaught\n');
    const limit = machine(engine, artifact(source.replace('try { throw new Exception("caught"); }', 'try { while(true){} }')),
      {maxInstructions: 2000}).run();
    assert.equal(limit.state, 'faulted');
    assert.equal(limit.fault.name, 'InstructionLimitException');
    assert.equal(limit.output, '');
  });

  test(`T04 ${engine}: a failing unhandled observer cannot replace the terminating exception`, () => {
    const program = `using System;class P {
      static void Last(object sender,UnhandledExceptionEventArgs args){Console.WriteLine("observer");throw new Exception("observer fault");}
      static void Main(){AppDomain.CurrentDomain.UnhandledException+=Last;throw new Exception("original");}
    }`;
    const result = machine(engine, artifact(program)).run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.message, 'original');
    assert.equal(result.output, 'observer\n');
  });

  test(`T04 ${engine}: async-void faults notify once after the synchronous caller returns`, async () => {
    const program = `using System;using System.Threading.Tasks;using System.Runtime.ExceptionServices;class P {
      static void First(object sender,FirstChanceExceptionEventArgs args){Console.WriteLine("first");}
      static void Last(object sender,UnhandledExceptionEventArgs args){Console.WriteLine("unhandled");}
      static async void Fail(){await Task.Delay(1);throw new Exception("async");}
      static void Main(){AppDomain.CurrentDomain.FirstChanceException+=First;
        AppDomain.CurrentDomain.UnhandledException+=Last;Fail();Console.WriteLine("caller");}
    }`;
    const vm = machine(engine, artifact(program), {virtualTime: true});
    const result = await vm.runAsync();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.message, 'async');
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output, 'caller\nfirst\nunhandled\n');
  });
}
