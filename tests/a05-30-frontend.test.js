import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL} from '@sharpforge/compiler';
import {parse} from '@sharpforge/syntax';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';

test('A05 T30 parser retains lock, byref modifiers and synchronization method type arguments',()=>{
  const parsed=parse('object gate=new object();lock(gate){Monitor.Enter(gate,ref flag);Interlocked.Exchange<string>(ref text,"next");Volatile.Read(in count);}');
  assert.deepEqual(parsed.diagnostics,[]);
  const locked=parsed.root.statements[1];assert.equal(locked.kind,'Lock');
  const calls=locked.body.statements.map(statement=>statement.expression);
  assert.equal(calls[0].args[1].kind,'RefArgument');assert.equal(calls[0].args[1].modifier,'ref');
  assert.deepEqual(calls[1].target.typeArguments,['string']);assert.equal(calls[2].args[0].modifier,'in');
});

for(const [name,source] of [
  ['unassigned local','int value;Interlocked.Exchange(ref value,1);'],
  ['constant location','const int value=1;Interlocked.Exchange(ref value,2);'],
  ['non-location','Interlocked.Exchange(ref (1+2),3);'],
  ['missing ref','int value=1;Interlocked.Exchange(value,2);'],
  ['wrong ref width','long value=1L;Interlocked.Exchange<int>(ref value,2);'],
  ['out instead of ref','int value=1;Interlocked.Exchange(out value,2);'],
  ['readonly write','int value=1;Volatile.Write(in value,2);'],
  ['generic Volatile value type','int value=1;Volatile.Read<int>(ref value);'],
  ['lock value type','lock(1){}'],
  ['property reference','Box box=new Box();Interlocked.Exchange(ref box.Value,2);']
])test(`A05 T30 frontend rejects ${name}`,()=>{
  const result=compile('using System.Threading;class Box{public int Value{get;set;}}class P{static void Main(){'+source+'}}');
  assert.equal(result.success,false);assert(result.diagnostics.some(diagnostic=>diagnostic.severity==='error'));
});

test('A05 T30 byref lowering distinguishes local, static, field, array and readonly addresses',()=>{
  const source='using System.Threading;class Box{public int Value;}class P{static int global;static void Main(){int local=0;Box box=new Box();int[] array=new int[1];Interlocked.Increment(ref local);Interlocked.Increment(ref global);Interlocked.Increment(ref box.Value);Interlocked.Increment(ref array[0]);Volatile.Read(in local);}}';
  const compiled=compile(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const kinds=new Set();for(const method of compiled.image.methods)for(let at=0;at<method.code.length;at+=3)if(method.code[at]===Op.ADDRESS)kinds.add(method.code[at+1]);
  for(const kind of [0,1,2,3,4])assert(kinds.has(kind),'Address kind '+kind);
});

const evaluationOrder='using System.Threading;class Box{public int Value;}class P{static Box box=new Box();static int calls;static Box Receiver(){calls++;return box;}static int Value(){calls++;return 9;}static void Main(){Interlocked.Exchange(ref Receiver().Value,Value());Console.WriteLine(calls);Console.WriteLine(box.Value);object gate=new object();try{lock(gate){throw new Exception();}}catch(Exception error){}Console.WriteLine(Monitor.IsEntered(gate));}}';
for(const engine of ['source','cil'])test(`A05 T30 ${engine}: receiver evaluation and lock cleanup occur once`,async()=>{
  const compiled=compileToIL(evaluationOrder);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine==='source'?new VirtualMachine(compiled.image):new CilVirtualMachine(compiled.assembly),result=await vm.runAsync();
  assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'2\n9\nFalse\n');
});

for(const engine of ['source','cil'])test(`A05 T30 ${engine}: generic atomic reference calls preserve declared reference types`,async()=>{
  const source='using System.Threading;class P{static void Main(){string text="old";Console.WriteLine(Interlocked.Exchange<string>(ref text,"new"));Console.WriteLine(Volatile.Read<string>(ref text));}}';
  const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine==='source'?new VirtualMachine(compiled.image):new CilVirtualMachine(compiled.assembly),result=await vm.runAsync();
  assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'old\nnew\n');
});

for(const engine of ['source','cil'])test(`A05 T30 ${engine}: lock target is evaluated once and remains stable after reassignment`,async()=>{
  const source='using System.Threading;class P{static int calls;static object first=new object();static object second=new object();static object Gate(){calls++;return first;}static void Main(){object target=Gate();lock(target){target=second;Console.WriteLine(Monitor.IsEntered(first));}Console.WriteLine(Monitor.IsEntered(first));Console.WriteLine(calls);}}';
  const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine==='source'?new VirtualMachine(compiled.image):new CilVirtualMachine(compiled.assembly),result=await vm.runAsync();
  assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'True\nFalse\n1\n');
});
