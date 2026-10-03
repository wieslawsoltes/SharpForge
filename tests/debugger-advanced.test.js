import test from 'node:test';import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';import {DebugSession,CilDebugSession} from '@sharpforge/debugger';
const compilation=text=>{const c=compileToIL(text);assert(c.success,JSON.stringify(c.diagnostics));return c;};
const program=`class N {
 public int Value;
 public N(int value){Value=value;}
 public int Add(int x){return Value+x;}
 public int Twice { get {return Value*2;} set {Value=value/2;} }
}
class P {
 static int total;
 public static int F(int x){total+=x; GC.Collect(); return total;}
 public static int Forever(){while(true){} return 0;}
 public static int Bad(){total=99; Console.WriteLine("not committed"); throw new Exception("bad");}
 public static string Make(int n){GC.Collect(); return "item"+n;}
 public static string Join(string a,string b){GC.Collect();return a+b;}
 static void Main(){
 var n=new N(5);
 int x=2;
 Console.WriteLine(n.Value);
 }
}`;
for(const direct of [false,true]){
 const kind=direct?'CIL':'source';const session=(text=program,line=17,options={})=>{const c=compilation(text),s=direct?new CilDebugSession(c.assembly,options):new DebugSession(c.image,options);if(line)s.setBreakpoints('Program.cs',[{line}]);s.start(false);s.runUntilStop();return s;};
 test(`${kind}: explicit function calls preserve paused stack and control flow`,()=>{const s=session(),before=s.stackTrace();assert.throws(()=>s.evaluateFunction('P.F(1)'),/consent/);assert.throws(()=>s.evaluate('P.F(1)'),/not allowed|cannot execute/i);const v=s.evaluateFunction('P.F(3)+P.F(2)',{allowSideEffects:true});assert.equal(v.result,'8');assert.deepEqual(s.stackTrace(),before);s.resume();assert.equal(s.runUntilStop().output,'5\n');});
 test(`${kind}: methods, constructors, initializers, getters and setters execute real target code`,()=>{const s=session(),ev=e=>s.evaluateFunction(e,{allowSideEffects:true});assert.equal(ev('new N(7){Value=10}.Add(4)').result,'14');assert.equal(ev('n.Twice').result,'10');assert.equal(ev('n.Twice=20').result,'20');assert.equal(ev('n.Add(5)').result,'15');assert.equal(ev('x+=3').result,'5');assert.equal(ev('new int[]{1,2,3}[2]').result,'3');s.resume();assert.equal(s.runUntilStop().output,'10\n');});
 test(`${kind}: effectful expression receiver/argument order and GC roots`,()=>{const s=session(),r=s.evaluateFunction('P.Join(P.Make(1),P.Make(2))',{allowSideEffects:true});assert.equal(r.result,'"item1item2"');s.vm.heap.collect();assert.equal(s.vm.value(r.reference),'item1item2');s.resume();s.runUntilStop();assert.equal(s.evaluationHandles.length,0);});
 test(`${kind}: evaluation rollback restores target state, output and history`,()=>{const s=session(program,17,{recordHistory:true}),before=s.vm.snapshot(),h=s.history.length;const r=s.evaluateFunction('P.F(6)',{allowSideEffects:true,commit:false});assert.equal(r.result,'6');assert.equal(r.committed,false);assert.equal(s.vm.instructions,before.instructions);assert.equal(s.history.length,h);assert.equal(s.evaluateFunction('P.F(1)',{allowSideEffects:true}).result,'1');});
 test(`${kind}: throwing evaluation and instruction exhaustion roll back`,()=>{const s=session(),old=s.vm.instructions;assert.throws(()=>s.evaluateFunction('P.Bad()',{allowSideEffects:true}),/bad/);assert.equal(s.vm.output.join(''),'');assert.equal(s.vm.state,'paused');assert.equal(s.vm.instructions,old);assert.throws(()=>s.evaluateFunction('P.Forever()',{allowSideEffects:true,maxInstructions:1000,timeBudgetMs:500}),/budget/);assert.equal(s.evaluateFunction('P.F(1)',{allowSideEffects:true}).result,'1');});
 test(`${kind}: cancellation, syntax and budget failures are nonmutating`,()=>{const s=session(),old=s.vm.instructions,controller=new AbortController();controller.abort();assert.throws(()=>s.evaluateFunction('P.F(1)',{allowSideEffects:true,signal:controller.signal}),/cancelled/);for(const options of [{maxInstructions:0},{maxInstructions:2000000},{timeBudgetMs:0},{timeBudgetMs:2001}])assert.throws(()=>s.evaluateFunction('P.F(1)',{allowSideEffects:true,...options}),/budget/);assert.throws(()=>s.evaluateFunction('(',{allowSideEffects:true}));assert.equal(s.vm.instructions,old);});
 test(`${kind}: checked expressions and short circuits apply to called results`,()=>{const s=session(),ev=e=>s.evaluateFunction(e,{allowSideEffects:true});assert.equal(ev('false && P.F(20)>0').result,'False');assert.equal(ev('P.F(1)').result,'1');assert.equal(ev('-(P.F(1)+2)').result,'-4');assert.throws(()=>ev('checked(P.F(1)+2147483647)'),/overflow/i);assert.equal(ev('P.F(0)').result,'2');});
 test(`${kind}: Set Next Statement skips a write and preserves live values`,()=>{const s=session('int x=1;\nx=2;\nx=3;\nConsole.WriteLine(x);',2);const before=s.vm.instructions;s.setNextStatement({uri:'Program.cs',line:4,expectedInstructions:before});assert.equal(s.vm.instructions,before);assert.equal(s.evaluate('x').value,1);assert.equal(s.stackTrace()[0].line,4);s.resume();assert.equal(s.runUntilStop().output,'1\n');});
 test(`${kind}: Set Next Statement rejects another method and stale stop`,()=>{const s=session(),pc=s.vm.top.pc,h=s.history.length;assert.throws(()=>s.setNextStatement({uri:'Program.cs',line:9}),/another method/);assert.throws(()=>s.setNextStatement({uri:'Program.cs',line:17,expectedInstructions:-1}),/changed/);assert.equal(s.vm.top.pc,pc);assert.equal(s.history.length,h);});
 test(`${kind}: Set Next Statement cannot escape protected cleanup`,()=>{const s=session('int x=1;\ntry {\nx=2;\n} finally {\nx=3;\n}\nConsole.WriteLine(x);',3);assert.throws(()=>s.setNextStatement({uri:'Program.cs',line:7}),/boundary/);s.resume();assert.equal(s.runUntilStop().output,'3\n');});
 test(`${kind}: Hot Reload replaces inactive bodies without restarting heap`,()=>{const text='class P { static int Value(int x){return x+1;} static void Main(){\nint x=2;\nConsole.WriteLine(Value(x));\n}}',s=session(text,3,{recordHistory:true}),next=compilation(text.replace('return x+1;','int y=x*3;return y+5;'));const st=s.applyChanges(direct?next.assembly:next.image,{expectedVersion:0});assert.equal(s.codeVersion,1);assert.equal(s.history.length,0);assert.equal(s.evaluate('x').value,2);assert.throws(()=>s.applyChanges(direct?next.assembly:next.image,{expectedVersion:0}),/version/);s.resume();assert.equal(s.runUntilStop().output,'11\n');});
 test(`${kind}: Hot Reload literal update in active method retains local values`,()=>{const text='int x=1;\nx=2;\nConsole.WriteLine(x);',s=session(text,2),next=compilation(text.replace('x=2','x=9'));s.applyChanges(direct?next.assembly:next.image);assert.equal(s.evaluate('x').value,1);s.resume();assert.equal(s.runUntilStop().output,'9\n');});
 test(`${kind}: rude edits reject without losing old program or breakpoints`,()=>{const text='int x=1;\nx=2;\nConsole.WriteLine(x);',s=session(text,2),pc=s.vm.top.pc,next=compilation(text.replace('x=2;','int z=9;x=z;'));assert.throws(()=>s.applyChanges(direct?next.assembly:next.image),/Rude edit/);assert.equal(s.vm.top.pc,pc);assert.equal(s.codeVersion??0,0);s.resume();assert.equal(s.runUntilStop().output,'2\n');});
}
test('source: Set Next Statement rejects skipped definite assignment',()=>{const c=compilation('int x=1;\nConsole.WriteLine(x);'),s=new DebugSession(c.image).start();s.runUntilStop();assert.throws(()=>s.setNextStatement({uri:'Program.cs',line:2}),/unassigned/);});
test('CIL: Set Next Statement rejects entering a nonempty-stack expression',()=>{const c=compilation('int x=1;\nConsole.WriteLine(x+2);'),s=new CilDebugSession(c.assembly);s.setBreakpoints('Program.cs',[{line:2}]);s.start(false);s.runUntilStop();const m=s.vm.top.method,ret=m.instructions.find(i=>i.name==='add');assert.throws(()=>s.setNextStatement({reference:`il:${m.token.toString(16).padStart(8,'0')}:${ret.offset.toString(16).padStart(8,'0')}`}),/stack|boundary/);});
