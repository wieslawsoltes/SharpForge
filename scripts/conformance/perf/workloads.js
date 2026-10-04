import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {beginAllocation,finishAllocation} from './alloc.js';
export const adapters=Object.freeze([
 {id:'A05/vm-source',area:'A05',engine:'source',kind:'vm'},
 {id:'A05/vm-cil',area:'A05',engine:'cil',kind:'vm'},
 {id:'A08/dictionary-source',area:'A08',engine:'source',kind:'dictionary'},
 {id:'A08/dictionary-cil',area:'A08',engine:'cil',kind:'dictionary'},
 {id:'A10/compute-scalar',area:'A10',engine:'scalar',kind:'compute'},
 {id:'A10/compute-wasm',area:'A10',engine:'wasm-simd',kind:'compute'},
 {id:'A20/editor-index',area:'A20',engine:'node',kind:'editor'}
]);
export async function workload(root,adapter){
 const module=name=>import(pathToFileURL(join(root,'packages',name,'src/index.js')).href);
 if(['vm','dictionary'].includes(adapter.kind)){
  const [{compileToIL},{VirtualMachine,CilVirtualMachine}]=await Promise.all([module('compiler'),module('runtime')]);
  const source=adapter.kind==='vm'?'int sum=0;for(int i=0;i<500;i++){var n=new N(i);sum+=n.Value;if(i%50==0)GC.Collect();}Console.WriteLine(sum); class N{public int Value;public N(int n){Value=n;}}':'var d=new Dictionary<int,int>();for(int i=0;i<500;i++)d.Add(i,i+1);int sum=0;for(int i=0;i<500;i++)sum+=d[i];Console.WriteLine(sum);';
  const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const expected=adapter.kind==='vm'?'124750\n':'125250\n';
  return ()=>{const vm=adapter.engine==='source'?new VirtualMachine(compiled.image):new CilVirtualMachine(compiled.assembly),before=beginAllocation(vm),started=performance.now(),result=vm.run(),ms=performance.now()-started;assert.equal(result.state,'terminated');assert.equal(result.output,expected);return {ms,checksum:expected,metrics:finishAllocation(before,vm,500)};};
 }
 if(adapter.kind==='compute'){
  const {createSimdEngine}=await module('compute'),engine=createSimdEngine({backend:adapter.engine==='scalar'?'scalar':'wasm'}),a=Int32Array.from({length:100000},(_,i)=>i%17),b=Int32Array.from({length:100000},(_,i)=>i%7);
  if(adapter.engine!=='scalar'&&engine.backend!=='wasm-simd128')throw new Error('Requested actual Wasm SIMD backend unavailable: '+engine.backend);
  return ()=>{const before=beginAllocation(),start=performance.now(),value=engine.execute('add',a,b),ms=performance.now()-start;for(let i=0;i<value.length;i++)assert.equal(value[i],a[i]+b[i]);return {ms,checksum:'100000:'+value[99999],metrics:finishAllocation(before)};};
 }
 if(adapter.kind==='editor'){
  const {SyntaxHighlightIndex}=await module('editor'),text=Array.from({length:2000},(_,i)=>'int value'+i+'='+i+'; // line\n').join('');
  return ()=>{const before=beginAllocation(),start=performance.now(),index=new SyntaxHighlightIndex(text),ms=performance.now()-start,view=index.window({scrollTop:1000,height:440});assert(view.runs.length>0&&view.characters<3000);return {ms,checksum:String(index.lexed.tokens.length),metrics:finishAllocation(before)};};
 }
 throw new Error('Unknown registered workload '+adapter.kind);
}
