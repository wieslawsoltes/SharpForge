import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector} from '@sharpforge/cil';
import {Op} from '@sharpforge/bytecode';
import {methodBody,validateBody} from '../scripts/planning/schema/adapters.js';
import {mergeType} from '../scripts/planning/schema/lower-method-body.js';
import {validate} from '../scripts/planning/schema/validate.js';
const schema=JSON.parse(readFileSync(new URL('../planning/contracts/schema/method-body.schema.json',import.meta.url)));
const build=source=>{const c=compileToIL(source);assert(c.success,JSON.stringify(c.diagnostics));return c;};
function lowered(source){const c=build(source),inspector=new AssemblyInspector(c.assembly);return [...c.image.methods.map(m=>methodBody(m,'bytecode',{image:c.image})),...[...inspector.methods.keys()].map(t=>inspector.getMethod(t)).filter(m=>m.instructions.length).map(m=>methodBody(m,'cil',{inspector}))];}
for(const id of ['native-callback','nested-finally','parked-frame'])test('A00 typed neutral IR resolves both engines: '+id,()=>{
  const bodies=lowered(readFileSync(new URL('../planning/contracts/fixtures/safepoint/'+id+'.cs',import.meta.url),'utf8'));
  for(const body of bodies){assert.equal(body.typeState,'resolved');validate(schema,body);validateBody(body,{requireExecutable:true});assert(body.instructions.every(i=>i.resultType!==null));assert(body.instructions.every(i=>i.outputTypes.every(t=>typeof t==='string')));for(const instruction of body.instructions)for(const target of instruction.successors)assert(body.instructions[target]);}
  assert(bodies.some(b=>b.encoding==='bytecode'));assert(bodies.some(b=>b.encoding==='cil'));
  for(const encoding of ['bytecode','cil'])assert(bodies.filter(b=>b.encoding===encoding).some(b=>b.instructions.some(i=>i.opcode==='call'&&i.operands[0].parameters.length)));
});
test('A00 normalized loop operations and declared types do not depend on encoding',()=>{
  const bodies=lowered('class P { static int Main() { int n=0; while(n<3) { n=n+1; } return n; } }');
  for(const encoding of ['bytecode','cil']){const methods=bodies.filter(b=>b.encoding===encoding),operations=new Set(methods.flatMap(b=>b.instructions.map(i=>i.opcode)));for(const op of ['constant','load-local','store-local','compare','branch-if','binary','return'])assert(operations.has(op),encoding+' '+op);assert(methods.some(b=>b.safepoints.some(s=>s.kind===1)));for(const body of methods)validateBody(body,{requireExecutable:true});}
});
function imageWith(code){const method={id:0,name:'Main',qualifiedName:'P.Main',owner:'P',isStatic:true,returnType:'void',parameters:[],locals:[],handlers:[],code:Int32Array.from(code.flat())};return {formatVersion:1,methods:[method],constants:[true,42,'text',null],types:[],statics:[],sequencePoints:[],entryPoint:0};}
test('A00 source type propagation rejects conflicting branch joins',()=>{
  const image=imageWith([[Op.CONST,0,0],[Op.JFALSE,4,0],[Op.CONST,1,0],[Op.JUMP,5,0],[Op.CONST,2,0],[Op.POP,0,0],[Op.CONST,3,0],[Op.RET,0,0]]);
  assert.throws(()=>methodBody(image.methods[0],'bytecode',{image}),{code:'SCHEMA_TYPE_CONFLICT'});
});
test('A00 CIL type propagation rejects conflicting branch joins',()=>{
  const c=build('class P { static int Main() { if (true) return 1; return 2; } }'),inspector=new AssemblyInspector(c.assembly),original=[...inspector.methods.values()].find(m=>m.name==='Main'),method=inspector.getMethod(original.token);
  const bad={...method,signature:{...method.signature,returnType:'void'},codeSize:8,instructions:[{offset:0,name:'ldc.i4',operand:1},{offset:1,name:'brfalse',operand:4},{offset:2,name:'ldc.i4',operand:1},{offset:3,name:'br',operand:5},{offset:4,name:'ldnull'},{offset:5,name:'pop'},{offset:6,name:'ldc.i4',operand:0},{offset:7,name:'ret'}],handlers:[]};
  assert.throws(()=>methodBody(bad,'cil',{inspector}),{code:'SCHEMA_TYPE_CONFLICT'});
});
test('A00 malformed branches, handlers, signatures and unsupported instructions fail closed',()=>{
  const image=imageWith([[Op.JUMP,9,0]]);assert.throws(()=>methodBody(image.methods[0],'bytecode',{image}),{code:'SCHEMA_INVALID'});
  const c=build('Console.WriteLine("typed");');assert.throws(()=>methodBody(c.image.methods[0],'bytecode'),{code:'SCHEMA_CONTEXT'});
  const method=structuredClone(c.image.methods[0]);method.handlers=[{kind:'finally',start:0,end:999,target:0,handlerEnd:1}];assert.throws(()=>methodBody(method,'bytecode',{image:c.image}),{code:'SCHEMA_INVALID'});
  method.handlers=[];method.code[0]=999;assert.throws(()=>methodBody(method,'bytecode',{image:c.image}),{code:'SCHEMA_UNSUPPORTED'});
  const inspector=new AssemblyInspector(c.assembly),definition=[...inspector.methods.keys()][0],cil=inspector.getMethod(definition);assert.throws(()=>methodBody({...cil,handlers:[{kind:'filter'}]},'cil',{inspector}),{code:'SCHEMA_UNSUPPORTED'});
  assert.throws(()=>methodBody({...cil,codeSize:1,instructions:[{offset:0,name:'calli',operand:0}],handlers:[]},'cil',{inspector}),{code:'SCHEMA_UNSUPPORTED'});
});
test('A00 serialized executable IR rejects falsified types and flow edges',()=>{
  const body=lowered('Console.WriteLine("typed");')[0];validateBody(body,{requireExecutable:true});
  assert.throws(()=>validateBody({...body,typeState:'unresolved'},{requireExecutable:true}),{code:'SCHEMA_UNRESOLVED'});
  const missing=structuredClone(body);missing.instructions[0].resultType=null;assert.throws(()=>validate(schema,missing),{code:'SCHEMA_INVALID'});assert.throws(()=>validateBody(missing,{requireExecutable:true}),{code:'SCHEMA_UNRESOLVED'});
  const bad=structuredClone(body);bad.instructions[0].successors=[body.instructions.length];assert.throws(()=>validateBody(bad,{requireExecutable:true}),{code:'SCHEMA_INVALID'});
  const stack=structuredClone(body);stack.instructions[0].outputTypes.push('i32');assert.throws(()=>validateBody(stack,{requireExecutable:true}),{code:'SCHEMA_INVALID'});
  const missingEdge=structuredClone(body);missingEdge.instructions[0].successors=[];assert.throws(()=>validateBody(missingEdge,{requireExecutable:true}),{code:'SCHEMA_INVALID'});
  assert.equal(mergeType('null','ref:System.String'),'ref:System.String');assert.equal(mergeType('f32','f64'),'f64');assert.throws(()=>mergeType('i32','ref:System.String'),{code:'SCHEMA_TYPE_CONFLICT'});
});

test('A00 null/reference joins resolve and incorrect stores/calls are rejected',()=>{
  const image=imageWith([[Op.CONST,0,0],[Op.JFALSE,4,0],[Op.CONST,3,0],[Op.JUMP,5,0],[Op.CONST,2,0],[Op.RET,0,0]]);image.methods[0].returnType='string';
  const body=methodBody(image.methods[0],'bytecode',{image});validateBody(body,{requireExecutable:true});assert.deepEqual(body.instructions[5].stackIn,['ref:System.String']);
  const badStore=imageWith([[Op.CONST,2,0],[Op.STLOC,0,0],[Op.POP,0,0],[Op.CONST,3,0],[Op.RET,0,0]]);badStore.methods[0].locals=[{type:'int'}];assert.throws(()=>methodBody(badStore.methods[0],'bytecode',{image:badStore}),{code:'SCHEMA_TYPE_CONFLICT'});
  const badCall=imageWith([[Op.CONST,2,0],[Op.CALL,1,1],[Op.RET,0,0]]);badCall.methods.push({...badCall.methods[0],id:1,name:'Accept',parameters:[{name:'x',type:'int'}]});assert.throws(()=>methodBody(badCall.methods[0],'bytecode',{image:badCall}),{code:'SCHEMA_TYPE_CONFLICT'});
});

test('A00 floating constant hints and signature-directed widening stay typed',()=>{
  const bodies=lowered('class P { static double Twice(double x) { return x+1; } static void Main() { double x=1.0; Console.WriteLine(Twice(x)); } }');
  for(const body of bodies){validate(schema,body);validateBody(body,{requireExecutable:true});}
  for(const encoding of ['bytecode','cil'])assert(bodies.filter(b=>b.encoding===encoding).some(b=>b.instructions.some(i=>i.opcode==='constant'&&i.operands[0]===1&&i.resultType==='f64')));
});
