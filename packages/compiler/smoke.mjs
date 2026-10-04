import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'compiler:compile', order: 40, async run(context) {
    const {compileToIL}=await import('@sharpforge/compiler');
    const {loadAssembly,formatAssembly}=await import('@sharpforge/cil');
    const {VirtualMachine}=await import('@sharpforge/runtime');
    const source='Console.WriteLine(6 * 7);',result=compileToIL(source,{name:'Isolated'});
    assert.equal(result.success,true,JSON.stringify(result.diagnostics));
    assert.deepEqual(Array.from(result.assembly.slice(0,2)),[77,90]);
    Object.assign(context, {compileToIL, loadAssembly, formatAssembly, VirtualMachine, source, result});
  }},
  {id: 'compiler:library-invocation', order: 520, async run(context) {
    const {compileToIL, CilVirtualMachine} = context;
    const library=compileToIL('class Library {public static int Bias=40;public static int Add(int a,int b){return a+b+Bias;}}',{outputKind:'library'});
    assert(library.success);
    assert.equal(new CilVirtualMachine(library.assembly,{methodToken:'Library::Add',arguments:[1,1]}).run().returnValue,42);
  }},
  {id: 'compiler:finally-checked-dispose', order: 690, async run(context) {
    const {compileToIL, VirtualMachine, CilVirtualMachine, formatILDocument, assembleILDocument} = context;
    const props=compileToIL('int F(){try{return new P().X;}finally{Console.WriteLine(1);}} Console.WriteLine(F()); class P { public int X{get;set;}=7; }');
    assert(props.success);
    assert.equal(new CilVirtualMachine(props.assembly).run().output,'1\n7\n');
    const checkedSource='using var lease=new Lease();int x=2147483647;try{Console.WriteLine(checked(x+1));}catch(Exception e){Console.WriteLine(42);} class Lease:IDisposable{public void Dispose(){Console.WriteLine("disposed");}}';
    const checkedIL=compileToIL(checkedSource);
    assert(checkedIL.success,JSON.stringify(checkedIL.diagnostics));
    for(const bytes of [checkedIL.assembly,assembleILDocument(formatILDocument(checkedIL.assembly)).bytes])assert.equal(new CilVirtualMachine(bytes).run().output,'42\ndisposed\n');
    assert.equal(new VirtualMachine(checkedIL.assembly).run().output,'42\ndisposed\n');
  }},
  {id: 'compiler:preview-collections', order: 2170, async run(context) {
    const {compileToIL, CilVirtualMachine} = context;
    const lc14=compileToIL('using System.Collections.Generic;List<int> a=[with(capacity: 8),1,2,3];Console.WriteLine(a.Count);',{langVersion:'preview'});
    assert(lc14.success,JSON.stringify(lc14.diagnostics));
    assert.equal(new CilVirtualMachine(lc14.assembly).run().output,'3\n');
  }},
  {id: 'compiler:execution-report', order: 10000, async run({source, result, executable, execution, report}) {
    report.execution = {source, output: execution.output, fault: execution.fault, assemblyBytes: result.assembly.length, format: 'ECMA-335', methodTokens: executable.il.methodTokens};
  }},
];
