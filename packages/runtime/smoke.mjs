import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'runtime:source-vm', order: 100, async run(context) {
    const {loadAssembly, formatAssembly, VirtualMachine, result} = context;
    const executable=loadAssembly(result.assembly),vm=new VirtualMachine(executable),execution=vm.run();
    assert.equal(execution.output,'42\n');
    assert.equal(execution.fault,null);
    assert.match(formatAssembly(result.assembly),/System.Console::WriteLine/);
    const direct=new VirtualMachine(result.assembly).run();
    assert.equal(direct.output,'42\n');
    Object.assign(context, {executable, vm, execution});
  }},
  {id: 'runtime:async-delay', order: 1520, async run(context) {
    const {compileToIL, CilVirtualMachine} = context;
    const ac=compileToIL('using System.Threading.Tasks;class P{static async Task Main(){await Task.Delay(1);Console.WriteLine(42);}}');
    assert(ac.success);
    assert.equal((await new CilVirtualMachine(ac.assembly,{virtualTime:true}).runAsync()).output,'42\n');
  }},
  {id: 'runtime:closed-bcl', order: 2040, async run(context) {
    const {compileToIL, VirtualMachine, CilVirtualMachine} = context;
    const bc=compileToIL('using System.Collections.Generic;using System.Text;var a=new List<int>() {3,1,2};a.Sort();var s=new StringBuilder();foreach(var i in a)s.Append($"{i:D2}");Console.WriteLine(s.ToString());');
    assert(bc.success,JSON.stringify(bc.diagnostics));
    assert.equal(new VirtualMachine(bc.image).run().output,'010203\n');
    assert.equal(new CilVirtualMachine(bc.assembly).run().output,'010203\n');
  }},
  {id: 'runtime:json-serialization', order: 2200, async run(context) {
    const {compileToIL, VirtualMachine} = context;
    const jc14=compileToIL('using System.Text.Json;Console.WriteLine(JsonSerializer.Serialize(new int[]{20,22}));');
    assert(jc14.success);
    assert.equal(new VirtualMachine(jc14.image).run().output,'[20,22]\n');
  }},
];
