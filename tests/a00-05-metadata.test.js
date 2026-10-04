import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {compileToIL} from '@sharpforge/compiler';import {AssemblyInspector} from '@sharpforge/cil';import {readPortablePdb} from '@sharpforge/symbols';import {serializeImage,verifyImage} from '@sharpforge/bytecode';import {types,canonicalType} from '@sharpforge/framework';
import {coverageText} from '../scripts/planning/schema/example-coverage.js';
import {validate,SchemaError} from '../scripts/planning/schema/validate.js';import {generate,stable} from '../scripts/planning/gen-schema-fixtures.js';import {typeIdentity,validateTypeSemantics,validateSignature,validateSpan,sourceSpan,validateBody,SymbolTable,symbolId} from '../scripts/planning/schema/adapters.js';
const base=new URL('../planning/contracts/',import.meta.url);const schema=name=>JSON.parse(readFileSync(new URL('schema/'+name+'.schema.json',base)));const fixtures=name=>JSON.parse(readFileSync(new URL('fixtures/schema/'+name+'.json',base)));
test('A00 all golden schemas regenerate byte-identically',()=>{const first=generate(),second=generate();assert.deepEqual(first,second);for(const [name,text]of first)assert.equal(text,readFileSync(new URL('fixtures/schema/'+name,base),'utf8'),name);});
test('A00 forty type/signature identities and every canonical registered type',()=>{const identities=fixtures('type-identities');assert.equal(identities.length,40);for(const doc of identities){validate(schema('type-identity'),doc);doc.identity.kind?validateTypeSemantics(doc.identity):validateSignature(doc.identity);}for(const name of types.keys()){const identity=typeIdentity(canonicalType(name));validate(schema('type-identity'),{schemaVersion:1,identity});validateTypeSemantics(identity);}assert.throws(()=>typeIdentity('List`2<int>'),{code:'SCHEMA_INVALID'});assert.throws(()=>validateSignature({...identities[36].identity,explicitThis:true}),{code:'SCHEMA_INVALID'});});
test('A00 generic identities preserve array ranks and explicit or inferred arity',()=>{
  const integer={kind:'named',assembly:'System.Runtime',name:'System.Int32',arity:0,arguments:[]};
  const expected={kind:'named',assembly:'Example.Assembly',name:'Example.Box`1',arity:1,arguments:[{kind:'array',element:integer,rank:2}]};
  for(const text of ['Example.Box<int[,]>','Example.Box`1<int[,]>']){
    const identity=typeIdentity(text,'Example.Assembly');assert.deepEqual(identity,expected);
    validate(schema('type-identity'),{schemaVersion:1,identity});validateTypeSemantics(identity);
  }
  assert.deepEqual(typeIdentity('Example.Box<int[,]>[]&','Example.Assembly'),
    {kind:'byref',rank:1,element:{kind:'array',rank:1,element:expected}});
});
test('A00 nested generic identities retain canonical aliases and compound arguments',()=>{
  const integer={kind:'named',assembly:'System.Runtime',name:'System.Int32',arity:0,arguments:[]};
  const text={kind:'named',assembly:'System.Runtime',name:'System.String',arity:0,arguments:[]};
  const box={kind:'named',assembly:'Example.Assembly',name:'Example.Box`1',arity:1,arguments:[{kind:'array',rank:1,element:{kind:'array',rank:3,element:integer}}]};
  const expected={kind:'named',assembly:'System.Runtime',name:'System.Collections.Generic.Dictionary`2',arity:2,arguments:[
    {kind:'array',rank:2,element:text},
    {kind:'named',assembly:'System.Runtime',name:'System.Collections.Generic.List`1',arity:1,arguments:[box]}
  ]};
  for(const spelling of ['Dictionary<string[,],List<Example.Box<int[,,][]>>>',
    'System.Collections.Generic.Dictionary`2<string[,],System.Collections.Generic.List`1<Example.Box`1<int[,,][]>>>']){
    const identity=typeIdentity(spelling,'Example.Assembly');assert.deepEqual(identity,expected);
    validate(schema('type-identity'),{schemaVersion:1,identity});validateTypeSemantics(identity);
  }
  for(const [alias,name]of [['HashSet','System.Collections.Generic.HashSet'],['Queue','System.Collections.Generic.Queue'],
    ['Stack','System.Collections.Generic.Stack'],['IComparer','System.Collections.Generic.IComparer'],
    ['Task','System.Threading.Tasks.Task'],['Vector','System.Numerics.Vector'],['Action','System.Action'],['Func','System.Func']]){
    assert.deepEqual(typeIdentity(alias+'<int[,]>'),{kind:'named',assembly:'System.Runtime',name:name+'`1',arity:1,arguments:[{kind:'array',rank:2,element:integer}]});
  }
  assert.deepEqual(typeIdentity('Enumerator`1<int>'),
    {kind:'named',assembly:'SharpForge',name:'SharpForge.Runtime.Enumerator`1',arity:1,arguments:[integer]});
});
test('A00 compound identities reject mismatched delimiters and generic arities',()=>{
  for(const text of ['Example.Box`2<int[,]>','Example.Box`1<int[,],string>',
    'Example.Box<int[,>','Example.Box<int]>', 'Example.Box<int[>]>','Example.Box<int[,]>>',
    'Example.Box<int[,],>','Example.Box<>','int[,]extra'])assert.throws(()=>typeIdentity(text),{code:'SCHEMA_INVALID'},text);
});
test('A00 symbols resolve overloads, generics, explicit members and scoped declarations',()=>{const records=fixtures('symbols'),table=new SymbolTable(records.map(r=>r.declaration));for(const r of records){assert.equal(symbolId(r.declaration),r.id);assert.deepEqual(table.resolve(r.id),r.declaration);if(r.declaration.token)assert.equal(table.fromToken(r.declaration.module,r.declaration.token),r.id);}assert.throws(()=>new SymbolTable([records[0].declaration,records[0].declaration]),{code:'SCHEMA_INVALID'});assert.throws(()=>table.fromToken('WrongModule',100663297),{code:'SCHEMA_INVALID'});});
test('A00 both engines export three example bodies and source spans',()=>{for(const name of ['native-callback','nested-finally','parked-frame']){const bodies=fixtures(name+'.bodies');assert(bodies.some(b=>b.encoding==='cil'));assert(bodies.some(b=>b.encoding==='bytecode'));for(const body of bodies){validate(schema('method-body'),body);validateBody(body,{requireExecutable:true});assert.equal(body.typeState,'resolved');}validate(schema('bytecode-image.v2'),fixtures(name+'.image'));for(const span of fixtures(name+'.spans')){validate(schema('source-span'),span);validateSpan(span);}const pretended=structuredClone(bodies[0]);pretended.instructions[0].resultType=null;assert.throws(()=>validate(schema('method-body'),pretended),{code:'SCHEMA_INVALID'});assert.throws(()=>validateBody(pretended,{requireExecutable:true}),{code:'SCHEMA_UNRESOLVED'});const bad=structuredClone(bodies[0]);bad.exceptionRegions=[{kind:'finally',start:0,end:bad.instructions.length+1,handlerStart:0,handlerEnd:1,catchType:null,filterStart:null}];assert.throws(()=>validateBody(bad),{code:'SCHEMA_INVALID'});}});
test('A00 external Portable PDB and UTF-16 source spans share schema',()=>{const pdb=readPortablePdb(readFileSync(new URL('./fixtures/portable-pdb/Documents.pdb',import.meta.url)));let count=0;for(const m of pdb.methods)for(const p of m.points){const doc=pdb.documents[p.document-1];const record=sourceSpan(p,undefined,doc.name);validate(schema('source-span'),record);validateSpan(record);count++;}assert(count>0);const source='𝄞\r\nhello';const span=sourceSpan({uri:'unicode.cs',offset:0,start:4,end:9},source);assert.equal(span.startLine,2);assert.equal(span.startColumn,1);assert.equal(span.endColumn,6);validateSpan(span);assert.throws(()=>validateSpan({...span,end:0}),{code:'SCHEMA_INVALID'});});
test('A00 actual PE #SF stream follows includeDebug contract',()=>{for(const includeDebug of [false,true]){const c=compileToIL('Console.WriteLine("metadata");',{includeDebug});assert(c.success);const inspector=new AssemblyInspector(c.assembly);assert.equal(inspector.metadata.streams.has('#SF'),includeDebug);if(includeDebug){const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inspector.metadata.streams.get('#SF')));assert.equal(record.format,'SharpForge.CIL');assert.equal(record.version,1);assert.deepEqual(Object.keys(record).sort(),['entry','format','framework','methods','name','sequencePoints','sources','statics','types','version'].sort());}}});
test('A00 schema malformed/version/unknown-keyword errors remain distinct',()=>{const s=schema('type-identity'),valid=fixtures('type-identities')[0];assert.throws(()=>validate(s,{...valid,schemaVersion:2}),{code:'SCHEMA_VERSION'});assert.throws(()=>validate(s,{schemaVersion:1,identity:{kind:'unknown'}}),{code:'SCHEMA_INVALID'});assert.throws(()=>validate({unsupportedKeyword:1},{}),{code:'SCHEMA_DEFINITION'});assert.throws(()=>validate({$ref:'#/missing'},{}),{code:'SCHEMA_DEFINITION'});assert.throws(()=>validate({type:'array',items:{type:'integer'}},[1,2],{maxNodes:1}),{code:'SCHEMA_LIMIT'});});
test('A00 examples corpus produced images satisfy schema; flow errors remain verifier-only',()=>{const report=coverageText();assert.equal(report,readFileSync(new URL('example-schema-coverage.json',base),'utf8'));assert(JSON.parse(report).emitted>20);const c=compileToIL('Console.WriteLine(1);');c.image.methods[0].code[0]=999;assert(verifyImage(c.image).length);validate(schema('bytecode-image.v2'),JSON.parse(serializeImage(c.image)));});
test('A00 schema const and enum compare unordered JSON objects and ordered arrays',()=>{
  const expected={left:{a:1,b:2},right:[true,null,'x']};
  const reordered={right:[true,null,'x'],left:{b:2,a:1}};
  for(const contract of [{const:expected},{enum:[false,expected]}]){
    assert.equal(validate(contract,reordered),reordered);
    for(const different of [{...reordered,right:[null,true,'x']},{...reordered,left:{a:1,b:'2'}},
      {...reordered,left:{a:1}},{...reordered,extra:0}])assert.throws(()=>validate(contract,different),{code:'SCHEMA_INVALID'});
  }
  const special=JSON.parse('{"__proto__":{"z":0,"a":1},"a,b":2}');
  validate({const:special},JSON.parse('{"a,b":2,"__proto__":{"a":1,"z":0}}'));
});
test('A00 schema uniqueItems uses JSON equality without serialization collisions',()=>{
  const contract={type:'array',uniqueItems:true};
  assert.throws(()=>validate(contract,[{a:1,b:{c:2,d:3}},{b:{d:3,c:2},a:1}]),{code:'SCHEMA_INVALID'});
  assert.throws(()=>validate(contract,[0,-0]),{code:'SCHEMA_INVALID'});
  validate(contract,[0,'0',false,null,{},[],{a:1},{a:'1'},[1,2],[2,1]]);
  for(const value of [undefined,NaN,Infinity,-Infinity,1n,Symbol('value'),()=>0]){
    assert.throws(()=>validate(contract,[value]),{code:'SCHEMA_INVALID'});
    assert.throws(()=>validate({const:[null]},[value]),{code:'SCHEMA_INVALID'});
  }
  let invoked=false;const custom={toJSON(){invoked=true;return null;}};
  assert.throws(()=>validate({const:null},custom),{code:'SCHEMA_INVALID'});assert.equal(invoked,false);
});
test('A00 schema composition supports object-valued discriminator constants and enums',()=>{
  for(const keyword of ['anyOf','oneOf'])for(const tag of [{const:{a:1,b:2}},{enum:[{a:1,b:2}]}]){
    const contract={[keyword]:[{type:'object',properties:{kind:tag},required:['kind']},
      {type:'object',properties:{kind:{const:'text'}},required:['kind']}]};
    validate(contract,{kind:{b:2,a:1}});validate(contract,{kind:'text'});
    assert.throws(()=>validate(contract,{kind:{a:1,b:3}}),{code:'SCHEMA_INVALID'});
  }
});
test('A00 schema equality traversal consumes the depth and node budgets',()=>{
  assert.throws(()=>validate({const:{a:1,b:2}},{b:2,a:1},{maxNodes:5}),{code:'SCHEMA_LIMIT'});
  const deep={a:{b:{c:1}}};assert.throws(()=>validate({enum:[deep]},deep,{maxDepth:2}),{code:'SCHEMA_LIMIT'});
  const cycle={};cycle.self=cycle;
  assert.throws(()=>validate({uniqueItems:true},[cycle]),error=>error instanceof SchemaError&&error.code==='SCHEMA_LIMIT');
});
