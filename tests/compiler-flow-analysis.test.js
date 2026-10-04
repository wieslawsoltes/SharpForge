import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceText} from '@sharpforge/text';
import {parse} from '@sharpforge/syntax';
import {compile,Compilation} from '@sharpforge/compiler';
import {VirtualMachine} from '@sharpforge/runtime';
import {buildControlFlowGraph,BasicBlock,ControlFlowGraph} from '../packages/compiler/src/flow/cfg.js';
import {computeReachableBlocks,analyzeReachability} from '../packages/compiler/src/flow/reachability.js';
import {analyzeDefiniteAssignment,writeConsideredUse} from '../packages/compiler/src/flow/definite-assignment.js';
import {analyzeMethodFlow} from '../packages/compiler/src/flow/method-flow.js';
import {BoundBlock,BoundExpressionStatement,BoundAssignmentOperator,BoundParameter,BoundLiteral,BoundReturnStatement,BoundIfStatement,BoundCall,BoundLocalDeclaration,BoundMultipleLocalDeclarations,BoundLocal} from '../packages/compiler/src/bound/nodes.js';
import {ParameterSymbol,LocalSymbol} from '../packages/compiler/src/symbols/members.js';
import {RefKind} from '../packages/compiler/src/symbols/types.js';
import {frameworkBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {loadFixtures,loadPinned} from '../packages/compiler/test/differential/corpus.js';
import {runFixture} from '../packages/compiler/test/differential/harness.js';
const bind=(source,name='<Main>')=>{const compilation=new Compilation([parse(new SourceText(source,'Program.cs'))],{pipeline:'bound'}),result=compilation.build(),unit=compilation.boundPipeline.units.find(u=>u.method.name===name);return {compilation,result,unit,body:unit.body,graph:buildControlFlowGraph(unit.body)};};
const codes=(source,options)=>compile(source,options).diagnostics.map(d=>d.code);
const fixtures=loadFixtures(),pinned=loadPinned();
for(const [feature,workId,minimum] of [['flow-reachability','A02-T33',30],['flow-assignment','A02-T34',30],['flow-unused','A02-T34',20]]){
  test(`${workId} ${feature} fixtures match Roslyn diagnostics, spans and program output`,()=>{
    const own=fixtures.filter(f=>f.feature===feature);assert(own.length>=minimum,`${own.length} fixtures`);
    for(const fixture of own){const row=runFixture(fixture,pinned.results.get(fixture.id));assert.equal(row.unsupported,false,fixture.id+': '+JSON.stringify(row.details));assert.equal(row.diagnostics,true,fixture.id+' errors: '+JSON.stringify(row.details));assert.equal(row.warnings,true,fixture.id+' warnings: '+JSON.stringify(row.details));
      if(fixture.kind==='output'){assert.equal(row.bytecode,true,fixture.id+' bytecode: '+JSON.stringify(row.details));assert.equal(row.cil,true,fixture.id+' cil: '+JSON.stringify(row.details));}}
  });
}
test('A02-T33 the control-flow graph has blocks, edges and statement positions',()=>{
  const {graph,body}=bind('int i=0;while(i<3){if(i==1)break;i++;}Console.WriteLine(i);');assert(graph instanceof ControlFlowGraph);assert(graph.blocks.every(b=>b instanceof BasicBlock&&b.terminator));assert.equal(graph.entry,graph.blocks[0]);assert.equal(graph.exit.terminator.kind,'end');
  const reachable=computeReachableBlocks(graph);assert(reachable.has(graph.exit));const loop=body.statements[1],head=graph.blocks.find(b=>b.terminator.kind==='branch'&&b.terminator.condition===loop.condition);
  assert(head,'the loop condition ends a block with a two-way branch');assert(head.predecessors.length>=2,'entry and back edge reach the loop head');assert.equal(graph.blocksOf(loop).length,1);assert(graph.blocksOf(body.statements[2]).every(b=>reachable.has(b)));
  for(const block of graph.blocks)for(const s of block.successors)assert(s.predecessors.includes(block),'edges are recorded in both directions');
  assert.deepEqual(graph.entry.ops.map(o=>o.kind+':'+o.variable.name),['write:i']);assert.deepEqual([...graph.locals].map(l=>l.name),['i']);
});
test('A02-T33 constant conditions prune edges; code after them is unreachable',()=>{
  const forever=bind('while(true){Console.WriteLine(1);}Console.WriteLine(2);'),reach=analyzeReachability(forever.graph,forever.body);
  assert.equal(reach.endReachable,false);assert.equal(reach.isReachable(forever.body.statements[1]),false);assert.equal(reach.isReachable(forever.body.statements[0]),true);assert.deepEqual(reach.diagnostics.map(d=>d.code),['CS0162']);assert.equal(reach.diagnostics[0].node,forever.body.statements[1].syntax);
  const never=bind('if(false)Console.WriteLine(1);Console.WriteLine(2);');assert.equal(analyzeReachability(never.graph,never.body).isReachable(never.body.statements[0].consequence),false);
  const partial=bind('bool b=int.Parse("1")>0;if(false&&b)Console.WriteLine(1);'),r=analyzeReachability(partial.graph,partial.body);assert.deepEqual(r.diagnostics,[],'a constant operand of && does not make the guarded code unreachable (Roslyn)');
  assert(partial.graph.blocks.some(b=>b.terminator.kind==='branch'&&b.terminator.dead==='whenTrue'),'but the edge is dead for definite assignment');
});
test('A02-T33 reachability replaces alwaysReturns for CS0161 and reports CS0162, CS0163 and CS8070',()=>{
  const method=body=>`class P{static int F(int x){${body}} static void Main(){Console.WriteLine(F(1));}}`;
  assert.deepEqual(codes(method('if(x>0)return 1;')),['CS0161']);assert.deepEqual(codes(method('while(true){if(x>0)return x;x++;}')),[],'an endless loop never reaches the end (the legacy check reported CS0161)');
  // The legacy method compiler's own check still reports CS0161 here; it stands only where the semantic analysis cannot take over (no `System` in scope).
  assert.deepEqual(codes(method('while(true){if(x>0)return x;x++;}'),{pipeline:'legacy',implicitUsings:false}),['CS0161']);
  assert.deepEqual(codes(method('while(true){if(x>0)return x;x++;}'),{pipeline:'legacy'}),[],'as Roslyn: the semantic analysis replaces the legacy answer');
  assert.equal(new VirtualMachine(compile(method('while(true){if(x>0)return x;x++;}'),{pipeline:'legacy'}).image).run().output,'1\n','and the program prints what .NET prints');
  assert.deepEqual(codes(method('while(true){if(x>0)break;x++;}')),['CS0161']);
  assert.deepEqual(codes(method('switch(x){case 1:if(x>0)break;return 1;default:return 0;}')),['CS0161'],'a break inside a returning section reaches the end (the legacy check accepted this)');
  assert.deepEqual(codes(method('try{return x;}finally{Console.WriteLine(0);}')),[]);assert.deepEqual(codes(method('throw new Exception("x");')),[]);
  assert.deepEqual(codes('return;Console.WriteLine(1);'),['CS0162']);assert.deepEqual(codes('return;Console.WriteLine(1);',{pipeline:'legacy'}),[],'the legacy compiler emitted no CS0162');
  const warning=compile('return;Console.WriteLine(1);');assert.equal(warning.success,true);assert.deepEqual(warning.diagnostics.map(d=>[d.severity,d.start,d.length,d.message]),[['warning',7,7,'Unreachable code detected']]);
  assert.deepEqual(codes('int k=1;switch(k){case 1:Console.WriteLine(1);case 2:break;}'),['CS0163']);assert.deepEqual(codes('int k=1;switch(k){case 1:break;case 2:Console.WriteLine(2);}'),['CS8070']);
  const d=compile('int k=1;switch(k){case 1:Console.WriteLine(1);case 2:break;}').diagnostics[0];assert.equal(d.message,"Control cannot fall through from one case label ('case 1:') to another");assert.deepEqual([d.start,d.length],[18,7]);
  assert.deepEqual(codes('int k=1;switch(k){case 1:while(true){}case 2:break;}'),[],'a section that cannot complete does not fall through');
});
test('A02-T34 block states are available for every reachable block',()=>{
  const {graph}=bind('bool b=int.Parse("1")>0;int x;int y=0;if(b){x=1;}else{y=2;}Console.WriteLine(y);'),result=analyzeDefiniteAssignment(graph);
  const names=state=>[...state].map(v=>v.name).sort();assert.deepEqual(names(result.entryStates.get(graph.entry)),[]);assert.deepEqual(names(result.exitStates.get(graph.entry)),['b','y']);
  const join=graph.blocks.find(b=>b.predecessors.length===2&&result.entryStates.has(b));assert.deepEqual(names(result.entryStates.get(join)),['b','y'],'x is assigned on one branch only');
  assert.deepEqual(result.diagnostics.map(d=>d.code+':'+d.args[0]),['CS0219:x'],'x is written but never read');assert.equal(result.unassignedReads.length,0);
});
test('A02-T34 definite assignment follows branches, loops, try/finally and when-true/when-false states',()=>{
  const first=source=>{const d=compile('bool b=int.Parse("1")>0;'+source).diagnostics.filter(x=>x.severity==='error');return d.map(x=>x.code+':'+x.message.match(/'([^']+)'/)?.[1]);};
  assert.deepEqual(first('int x;if(b)x=1;Console.WriteLine(x);'),['CS0165:x']);assert.deepEqual(first('int x;if(b)x=1;else x=2;Console.WriteLine(x);'),[]);
  assert.deepEqual(first('int x;if(b&&(x=1)>0)Console.WriteLine(x);'),[]);assert.deepEqual(first('int x;if(b||(x=1)>0)Console.WriteLine(x);'),['CS0165:x']);assert.deepEqual(first('int x;if(!(b&&(x=1)>0))return;Console.WriteLine(x);'),[]);
  assert.deepEqual(first('int x;while(true){x=1;break;}Console.WriteLine(x);'),[],'the legacy analysis rejected this');assert.deepEqual(first('int x;do{x=1;}while(b);Console.WriteLine(x);'),[]);
  assert.deepEqual(first('int x;try{x=1;}catch(Exception){}Console.WriteLine(x);'),['CS0165:x']);assert.deepEqual(first('int x;try{}finally{x=1;}Console.WriteLine(x);'),[]);assert.deepEqual(first('int x;try{x=1;}finally{Console.WriteLine(x);}'),['CS0165:x']);
  assert.deepEqual(first('int x;if(b){return;}else{x=1;}Console.WriteLine(x);'),[]);assert.deepEqual(first('int x;x+=1;'),['CS0165:x']);assert.deepEqual(first('int x;Console.WriteLine(x);Console.WriteLine(x);'),['CS0165:x'],'reported once');
  assert.deepEqual(first('int x;return;Console.WriteLine(x);'),[],'unreachable code reads nothing');
  assert.deepEqual(compile('int x;if(true)x=1;Console.WriteLine(x);',{pipeline:'legacy',implicitUsings:false}).diagnostics.map(d=>d.code),['CS0165'],'the legacy analysis ignored constant conditions');
  const constant=compile('int x;if(true)x=1;Console.WriteLine(x);',{pipeline:'legacy'});assert.deepEqual(constant.diagnostics.map(d=>d.code),[],'as Roslyn: the semantic analysis replaces the legacy answer');
  assert.equal(new VirtualMachine(constant.image).run().output,'1\n','and the program prints what .NET prints');
  const d=compile('int value;Console.WriteLine(value);').diagnostics[0];assert.deepEqual([d.code,d.start,d.length,d.message],['CS0165',28,5,"Use of unassigned local variable 'value'"]);
});
test('A02-T34 unused-variable warnings follow the Roslyn write-is-a-use rule',()=>{
  const warnings=source=>compile(source).diagnostics.filter(d=>d.severity==='warning').map(d=>d.code+':'+d.message.match(/'([^']+)'/)?.[1]);
  assert.deepEqual(warnings('int a;Console.WriteLine(1);'),['CS0168:a']);assert.deepEqual(warnings('int a=1;Console.WriteLine(1);'),['CS0219:a']);assert.deepEqual(warnings('int a=int.Parse("1");Console.WriteLine(1);'),[]);
  assert.deepEqual(warnings('string s=null;object o=null;Console.WriteLine(1);'),['CS0219:s','CS0219:o']);assert.deepEqual(warnings('try{}catch(Exception e){}'),['CS0168:e']);assert.deepEqual(warnings('foreach(int v in new int[]{1}){}'),[]);
  assert.deepEqual(warnings('const int K=1;int v=1;switch(v){case K:break;}'),[],'a constant used in a case label is used');
  const d=compile('int unused = 1;Console.WriteLine(1);').diagnostics[0];assert.deepEqual([d.code,d.severity,d.start,d.length],['CS0219','warning',4,6],'reported on the identifier');
  const int=frameworkBridge().typeFromName('int'),object=frameworkBridge().typeFromName('object'),literal=(value,type)=>new BoundLiteral(null,{value},type,{constantValue:{value}});
  assert.equal(writeConsideredUse(int,literal(1,int)),false);assert.equal(writeConsideredUse(object,literal(null,null)),false);assert.equal(writeConsideredUse(object,new BoundLocal(null,{local:new LocalSymbol({name:'q',type:object})},object)),true);assert.equal(writeConsideredUse(int,null),true);
});
test('A02-T34 out parameters must be assigned before they are read and before the method returns',()=>{
  // The current parser rejects `out`, so the analysis is exercised on hand-built bound trees.
  const int=frameworkBridge().typeFromName('int'),result=new ParameterSymbol({name:'result',type:int,refKind:RefKind.Out}),input=new ParameterSymbol({name:'input',type:int}),at=n=>({kind:'Name',uri:'a.cs',start:n,end:n+1});
  const read=(p,n)=>new BoundParameter(at(n),{parameter:p},int),assign=(p,value,n)=>new BoundExpressionStatement(at(n),{expression:new BoundAssignmentOperator(at(n),{left:new BoundParameter(at(n),{parameter:p},int),right:value},int)}),one=new BoundLiteral(null,{value:1},int);
  const analyze=statements=>{const body=new BoundBlock(at(0),{locals:[],statements}),graph=buildControlFlowGraph(body);return analyzeDefiniteAssignment(graph,{parameters:[result,input],exitNode:at(99)}).diagnostics.map(d=>d.code+':'+d.args[0]+'@'+d.node.start);};
  assert.deepEqual(analyze([assign(result,read(input,5),4)]),[]);assert.deepEqual(analyze([]),['CS0177:result@99'],'never assigned: reported at the method');
  assert.deepEqual(analyze([assign(input,read(result,7),6),assign(result,one,9)]),['CS0269:result@7'],'read before assignment');
  const guarded=new BoundIfStatement(at(10),{condition:read(input,11),consequence:new BoundReturnStatement(at(12),{expression:null}),alternative:null});
  assert.deepEqual(analyze([guarded,assign(result,one,20)]),['CS0177:result@12'],'an early return leaves it unassigned');assert.deepEqual(analyze([assign(result,one,2),guarded]),[]);
});
test('A02-T33/T34 flow analysis runs per method and reports through the compilation',()=>{
  const {compilation,unit}=bind('int x;if(int.Parse("1")>0)x=1;Console.WriteLine(x);return;x=2;'),before=compilation.diagnostics.length,flow=analyzeMethodFlow(compilation,unit.method,unit.body,unit.binder);
  assert.deepEqual(compilation.diagnostics.slice(before).map(d=>d.code),['CS0162','CS0165']);assert.equal(flow.reachability.endReachable,false);assert(flow.graph.blocks.length>4);assert.equal(flow.assignment.unassignedReads[0].variable.name,'x');
  assert.equal(analyzeMethodFlow(compilation,unit.method,null,unit.binder),null);
});
