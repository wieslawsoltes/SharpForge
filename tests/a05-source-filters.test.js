import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileToIL
} from '@sharpforge/compiler';
import {
  loadAssembly
} from '@sharpforge/cil';
import {
  VirtualMachine,
  CilVirtualMachine,
  serializeSnapshot,
  restoreSerializedSnapshot
} from '@sharpforge/runtime';

const cases = [{
    name: 'cross-frame filters precede cleanup',
    members: 'static void Fail(){try{Console.WriteLine("throw");throw new Exception("original");}' +
      'finally{Console.WriteLine("cleanup");}}' +
      'static bool Accept(){Console.WriteLine("filter");return true;}',
    body: 'try{Fail();}catch(Exception e)when(Accept()){Console.WriteLine(e.Message);}',
    output: 'throw\nfilter\ncleanup\noriginal\n'
  },
  {
    name: 'filter faults resume the original search after their own cleanup',
    members: 'static bool Bad(){try{throw new Exception("ignored");}finally{Console.WriteLine("filter cleanup");}}',
    body: 'try{throw new Exception("original");}catch(Exception e)when(Bad()){Console.WriteLine("wrong");}' +
      'catch(Exception e){Console.WriteLine(e.Message);}',
    output: 'filter cleanup\noriginal\n'
  },
  {
    name: 'nonmatching typed filters have no side effects',
    members: 'static bool Bad(){Console.WriteLine("wrong filter");return true;}',
    body: 'try{int zero=0;Console.WriteLine(1/zero);}' +
      'catch(ArgumentException e)when(Bad()){Console.WriteLine("wrong catch");}' +
      'catch(ArithmeticException e){Console.WriteLine(e.GetType().Name);}',
    output: 'DivideByZeroException\n'
  },
  {
    name: 'catch closures retain a fresh cell after the handler exits',
    members: '',
    body: 'Func<string> get=null;try{throw new Exception("captured");}' +
      'catch(Exception e){get=()=>e.Message;}Console.WriteLine(get());',
    output: 'captured\n'
  },
  {
    name: 'filter closures and the accepted body share the same catch cell',
    members: '',
    body: 'Func<string> get=null;try{throw new Exception("filter capture");}' +
      'catch(Exception e)when((get=()=>e.Message)!=null){Console.WriteLine(e.Message);}' +
      'Console.WriteLine(get());',
    output: 'filter capture\nfilter capture\n'
  },
  {
    name: 'filters share captured locals and rethrow preserves exception identity',
    members: '',
    body: 'int count=0;try{try{throw new Exception("same");}' +
      'catch(Exception e)when(++count==1){Console.WriteLine(count);throw;}}' +
      'catch(Exception e){Console.WriteLine(e.Message);}',
    output: '1\nsame\n'
  }
];

function build(item) {
  const source = 'using System;class Program{' + item.members + 'static void Main(){' + item.body + '}}';
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  return compiled;
}

const engines = {
  source: artifact => new VirtualMachine(artifact.image),
  reload: artifact => new VirtualMachine(loadAssembly(artifact.assembly)),
  cil: artifact => new CilVirtualMachine(artifact.assembly)
};

for (const [engine, create] of Object.entries(engines)) {
  for (const item of cases) test('T04 source filters ' + engine + ': ' + item.name, () => {
    const vm = create(build(item));
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, item.output);
  });

  test('T04 source filters ' + engine + ': portable replay retains the suspended search and locals', async () => {
    const artifact = build(cases[0]);
    const original = create(artifact);
    for (let steps = 0; steps < 1000 && !original.frames.some(frame => frame.filterSearch); steps++) {
      original.runSlice({
        instructionBudget: 1,
        timeBudgetMs: 1000
      });
    }
    assert(original.frames.some(frame => frame.filterSearch));
    const payload = await serializeSnapshot(original, original.snapshot(), {
      json: true
    });
    original.stop();
    original.heap.collect();
    const fresh = create(artifact);
    await restoreSerializedSnapshot(fresh, payload);
    const filter = fresh.frames.find(frame => frame.filterSearch);
    assert.equal(filter.locals, fresh.frames.find(frame => frame.id === filter.filterOwnerId).locals);
    fresh.heap.collect();
    assert.equal(fresh.run().output, cases[0].output);
    assert.equal(fresh.state, 'terminated', fresh.fault?.stack);
  });
}
