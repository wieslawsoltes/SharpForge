import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const synchronization = `using System;
using System.Threading;
class P {
  static object gate = new object();
  static int evaluated;
  static object Gate() { evaluated++; return gate; }
  static int Work() {
    lock (Gate()) {
      int value = 4;
      Interlocked.Add(ref value, 3);
      Console.WriteLine(Volatile.Read(in value));
      string text = "old";
      Console.WriteLine(Interlocked.Exchange<string>(ref text, "new"));
      Console.WriteLine(Volatile.Read<string>(ref text));
      return 9;
    }
  }
  static void Main() {
    Console.WriteLine(Work());
    Console.WriteLine(Monitor.IsEntered(gate));
    Console.WriteLine(evaluated);
  }
}`;

function machine(compiled, engine) {
  return engine === 'cil' ? new CilVirtualMachine(compiled.assembly)
    : new VirtualMachine(engine === 'reloaded' ? loadAssembly(compiled.assembly) : compiled.image);
}

for (const pipeline of ['legacy', 'bound']) {
  for (const engine of ['source', 'reloaded', 'cil']) {
    test(`T30 ${pipeline}/${engine}: generic atomic refs and lock return cleanup use the composed compiler`, async () => {
      const compiled = compileToIL(synchronization, {pipeline});
      assert(compiled.success, JSON.stringify(compiled.diagnostics));
      assert.notEqual(compiled.semantic?.generated, true, 'The registered synchronization profile must bind directly');
      const result = await machine(compiled, engine).runAsync();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, '7\nold\nnew\n9\nFalse\n1\n');
    });
  }
}

const threads = `using System;
using System.Threading;
class Worker {
  int amount;
  public Worker(int amount) { this.amount = amount; }
  public void Run() { Interlocked.Add(ref P.total, amount); }
}
class P {
  public static int total;
  static void Main() {
    Worker worker = new Worker(7);
    Thread thread = new Thread(worker.Run);
    thread.Start();
    thread.Join();
    Console.WriteLine(total);
    Console.WriteLine(Monitor.IsEntered(new object()));
  }
}`;
for (const engine of ['source', 'reloaded', 'cil']) {
  test(`T30 ${engine}: registered Thread constructor retains a method-group receiver`, async () => {
    const compiled = compileToIL(threads);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const result = await machine(compiled, engine).runAsync();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '7\nFalse\n');
  });
}

test('T30 composed legacy address emitter remains available to Decimal out parameters', async () => {
  const compiled = compileToIL('decimal value; Console.WriteLine(decimal.TryParse("12.5", out value)); Console.WriteLine(value);',
    {pipeline: 'legacy'});
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const result = await machine(compiled, 'source').runAsync();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, 'True\n12.5\n');
});
