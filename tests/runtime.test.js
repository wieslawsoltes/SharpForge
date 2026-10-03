import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagedHeap,VirtualMachine } from '@sharpforge/runtime';
import { image,execute,output } from './helpers.js';

test('heap: unreachable object cycles are reclaimed',()=>{const h=new ManagedHeap(),a=h.object('Node',[null]),b=h.object('Node',[a]);h.get(a).data[0]=b;const stats=h.collect();assert.equal(stats.freedThisCollection,2);assert.equal(stats.liveBytes,0);assert.throws(()=>h.get(a),{name:'InvalidReferenceException'});});
test('heap: roots retain entire reachable graph',()=>{const h=new ManagedHeap(),leaf=h.string('leaf'),a=h.object('Node',[leaf]);h.rootProvider=()=>[a];assert.equal(h.collect().freedThisCollection,0);assert.equal(h.get(leaf).data,'leaf');h.rootProvider=()=>[];assert.equal(h.collect().freedThisCollection,2);});
test('heap: references in newly allocated object survive reserve collection',()=>{const h=new ManagedHeap({maxBytes:512,initialThreshold:60});const text=h.string('payload'),parent=h.object('Node',[text]);assert.equal(h.get(text).data,'payload');assert.equal(h.get(parent).data[0],text);assert(h.stats.collections>=1);});
test('heap: native pins unwind after failures',()=>{const h=new ManagedHeap(),r=h.object('N',[]);assert.throws(()=>h.withRoots([r],()=>{assert.equal(h.collect().freedThisCollection,0);throw new Error('expected');}));assert.equal(h.pins.length,0);assert.equal(h.collect().freedThisCollection,1);});
test('heap: generations reject stale handles after slot reuse',()=>{const h=new ManagedHeap(),a=h.object('A',[]);h.collect();const b=h.object('B',[]);assert.equal(a.h,b.h);assert.notEqual(a.g,b.g);assert.throws(()=>h.get(a),{name:'InvalidReferenceException'});assert.equal(h.get(b).type,'B');});
test('heap: budgets are enforced',()=>{const h=new ManagedHeap({maxBytes:128});const a=h.array('int',10);h.rootProvider=()=>[a];assert.throws(()=>h.object('N',[a]),{name:'OutOfMemoryException'});assert.throws(()=>h.array('int',-1),{name:'OverflowException'});assert.throws(()=>h.array('int',1000001),{name:'OutOfMemoryException'});});
test('heap: snapshots are independent after mutation and collection',()=>{const h=new ManagedHeap(),a=h.object('N',[7]),snapshot=h.snapshot();h.get(a).data[0]=8;h.collect();h.restore(snapshot);assert.equal(h.get(a).data[0],7);h.get(a).data[0]=99;h.restore(snapshot);assert.equal(h.get(a).data[0],7);});
test('heap: iterative marking handles deep graphs',()=>{const h=new ManagedHeap({maxBytes:2_000_000});let last=null;h.rootProvider=()=>[last];for(let i=0;i<10000;i++)last=h.object('N',[last]);assert.equal(h.collect().liveObjects,10000);last=null;assert.equal(h.collect().freedThisCollection,10000);});
test('VM: compiler clears temporary roots after object assignment',()=>{output('var a=new N();var b=new N();a.Next=b;b.Next=a;a=null;b=null;GC.Collect();Console.WriteLine(GC.GetTotalMemory());class N{public N Next;}','0\n');});
test('VM: collection preserves locals, stack arguments and static roots',()=>{output('class N{public string Text;}class P{static N Root;static string Check(N arg){GC.Collect();return arg.Text;}static void Main(){Root=new N(){Text="alive"};Console.WriteLine(Check(Root));GC.Collect();Console.WriteLine(Root.Text);}}','alive\nalive\n');});
test('VM: scoped references no longer root dead objects',()=>{output('{var a=new N();} GC.Collect(); Console.WriteLine(GC.GetTotalMemory()); class N{}','0\n');});
for(const [name,source,type] of [
 ['null field','N x=null;Console.WriteLine(x.X);class N{public int X;}','NullReferenceException'],
 ['array bounds','int[] a=new int[1];Console.WriteLine(a[1]);','IndexOutOfRangeException'],
 ['negative array','int[] a=new int[-1];','OverflowException'],
 ['divide zero','int x=0;Console.WriteLine(1/x);','DivideByZeroException'],
 ['Int32 division overflow','int n=-2147483648;Console.WriteLine(n/-1);','OverflowException'],
 ['parse overflow','Console.WriteLine(int.Parse("2147483648"));','OverflowException'],
 ['invalid parse','Console.WriteLine(int.Parse("not a number"));','FormatException'],
 ['substring range','string s="abc";Console.WriteLine(s.Substring(10));','ArgumentOutOfRangeException'],
 ['throw null','throw null;','NullReferenceException']
])test('VM fault: '+name,()=>{const r=execute(source);assert.equal(r.state,'faulted');assert.equal(r.fault.name,type);});
test('VM: instruction budget is uncatchable',()=>{const r=execute('while(true){try{while(true){}}catch(Exception e){}}',{maxInstructions:1000});assert.equal(r.state,'faulted');assert.equal(r.fault.name,'InstructionLimitException');assert(r.stats.instructions<=1001);});
test('VM: output budget enforced',()=>{const r=execute('while(true){Console.WriteLine("0123456789");}',{maxOutputCharacters:100});assert.equal(r.fault.name,'OutputLimitException');assert(r.output.length<=100);});
test('VM: stack budget enforced',()=>{const r=execute('void F(){F();}F();',{maxFrames:20});assert.equal(r.state,'faulted');assert.equal(r.fault.name,'StackOverflowException');});
test('VM: runSlice yields at instruction budget',()=>{const vm=new VirtualMachine(image('int total=0;for(int i=0;i<100;i++){total+=i;}Console.WriteLine(total);'));vm.runSlice({instructionBudget:10,timeBudgetMs:1000});assert.equal(vm.state,'running');assert.equal(vm.instructions,10);assert.equal(vm.run().output,'4950\n');});
test('VM: stopped execution never continues',()=>{const vm=new VirtualMachine(image('while(true){}'));vm.runSlice({instructionBudget:20});vm.stop();assert.equal(vm.state,'terminated');assert.equal(vm.frames.length,0);assert.equal(vm.runSlice(),'terminated');});
test('VM: snapshot restores output and numeric state',()=>{const vm=new VirtualMachine(image('int x=1;Console.WriteLine(x);x=2;Console.WriteLine(x);'));vm.runSlice({instructionBudget:5,timeBudgetMs:1000});const snapshot=vm.snapshot(),first=vm.run();vm.restore(snapshot);assert.equal(vm.run().output,first.output);});

test('VM: Math.Abs honors selected int versus double overload',()=>{assert.equal(execute('int x=-2147483648;Console.WriteLine(Math.Abs(x));').fault.name,'OverflowException');output('double x=-2147483648.0;Console.WriteLine(Math.Abs(x));','2147483648\n');});
