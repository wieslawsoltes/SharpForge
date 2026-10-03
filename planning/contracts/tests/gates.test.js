import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { importGraph, parseImports } from '../../../scripts/planning/import-graph.js';
import { impactedTests } from '../../../scripts/planning/impacted-tests.js';
import { checkContractChange } from '../../../scripts/planning/check-contract-change.js';
import { contractGate } from '../../../scripts/planning/contract-gate.js';
const versions={framework:1,bytecode:1,value:1,metadata:1};
const write=(root,path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};

test('V8 parses escaped, multiline and re-export imports without executing modules or matching comments',()=>{
  assert.deepEqual(parseImports([{path:'a.js',source:`// import 'missing';\nconst text="import 'wrong'"; export {x} from './a.js'; import {\nx\n} from '@sharpforge/bytecode'; throw new Error('must not execute');`}])[0].imports,['./a.js','@sharpforge/bytecode']);
  assert.throws(()=>parseImports([{path:'broken.js',source:'import {'}]),/SyntaxError/);
});
test('graph resolves workspaces, recursive outside-root-directory dependencies and every JS including package bins',()=>{
  const root=mkdtempSync(join(tmpdir(),'sf-import-'));
  try {
    write(root,'packages/bytecode/package.json',JSON.stringify({name:'@sharpforge/bytecode',exports:{'.':'./src/index.js'}}));
    write(root,'packages/bytecode/src/index.js','export const x=1');
    write(root,'packages/bytecode/bin/run.js',"import '../src/index.js'");
    write(root,'scripts/fixture.js','export const n=1');
    write(root,'apps/cli/main.js',"export * from '@sharpforge/bytecode'; import '../../scripts/fixture.js'; import 'node:fs';");
    write(root,'tests/a.test.js',"import '../apps/cli/main.js'");
    const graph=importGraph(root); assert.deepEqual(graph.errors,[]); assert.equal(graph.modules.length,5); assert.deepEqual(importGraph(root),graph);
    write(root,'tests/a.test.js',"import '@sharpforge/missing'"); assert.match(importGraph(root).errors[0],/unresolved.*missing/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('reverse consumer selection covers transitive compiler runtime debugger, docs none, deleted modules conservative',()=>{
  const graph={errors:[],modules:[{path:'packages/bytecode/src/index.js',dependencies:[]},...['compiler','runtime','debugger'].flatMap(name=>[{path:`packages/${name}/src/index.js`,dependencies:['packages/bytecode/src/index.js']},{path:`tests/${name}.test.js`,dependencies:[`packages/${name}/src/index.js`]}])]};
  const manifests=['compiler','runtime','debugger'].map((name,i)=>({area:`A0${i}`,nodeGlobs:[`tests/${name}.test.js`]}));
  assert.equal(impactedTests({graph,manifests,files:['packages/bytecode/src/index.js']}).areas.length,3);
  assert.deepEqual(impactedTests({graph,manifests,files:['docs/a.md']}).areas,[]);
  assert.equal(impactedTests({graph,manifests,files:['packages/deleted.js']}).areas.length,3);
});
test('contract removal needs label and relevant version bump; append passes; duplicate IDs never pass',()=>{
  const path='planning/contracts/framework-ids.lock.json', before={[path]:[{id:1,name:'a'}]};
  const check=(after,labels=[],afterVersions=versions)=>checkContractChange({before,after,beforeVersions:versions,afterVersions,labels});
  assert.deepEqual(check({[path]:[...before[path],{id:2,name:'b'}]}).errors,[]);
  assert.equal(check({[path]:[]}).errors.length,2);
  assert.equal(check({[path]:[]},['contract-change'],{...versions,framework:2}).errors.length,0);
  assert.match(check({[path]:[...before[path],{id:1,name:'b'}]}).errors.join('\n'),/duplicate/);
  const schema='planning/contracts/schema/type-identity.json';
  const input={before:{[schema]:{type:'object',additionalProperties:false,properties:{a:{type:'string'}},required:['a']}},beforeVersions:versions,afterVersions:versions};
  assert.equal(checkContractChange({...input,after:{[schema]:{...input.before[schema],properties:{...input.before[schema].properties,b:{type:'number'}}}}}).errors.length,0);
  assert.match(checkContractChange({...input,after:{[schema]:{...input.before[schema],required:['a','b']}}}).errors.join('\n'),/version bump/);
});
test('schema constraints cannot hide as additive keys or exclusive-union array appends; revisions cannot be repointed',()=>{
  const path='planning/contracts/example.schema.json',check=(before,after)=>checkContractChange({before:{[path]:before},after:{[path]:after},beforeVersions:versions,afterVersions:versions});
  for(const [before,after] of [
    [{type:'string'},{type:'string',allOf:[{maxLength:0}]}],
    [{allOf:[]},{allOf:[{maxLength:0}]}],
    [{oneOf:[{type:'string'}]},{oneOf:[{type:'string'},{type:'string'}]}],
    [{type:'array'},{type:'array',uniqueItems:true}],
    [{type:'string'},{type:'string',not:{type:'string'}}],
    [{type:'object'},{type:'object',if:{required:['x']},then:{required:['y']}}],
  ])assert.equal(check(before,after).errors.length,2);
  const registry='planning/contracts/spec-revisions.json',before={schemaVersion:1,revisions:[{id:'csharp-14',version:'14'}]};
  assert.match(checkContractChange({before:{[registry]:before},after:{[registry]:{...before,revisions:[{id:'csharp-14',version:'15'}]}},beforeVersions:versions,afterVersions:{...versions,metadata:2},labels:['contract-change']}).errors.join('\n'),/immutable/);
});
test('gate emits every check including failure and stops on prior cancellation',()=>{
  const root=mkdtempSync(join(tmpdir(),'sf-gate-'));
  try { mkdirSync(join(root,'planning/contracts'),{recursive:true});
    const commands=[['bad','-e',"throw Error('ABI drift')"],['good','-e','console.log(42)']];
    const result=contractGate({root,commands}); assert.equal(result.checks.length,2); assert.equal(result.passed,false); assert.match(result.errors[0],/ABI drift/);
    assert.equal(contractGate({root,commands,signal:AbortSignal.abort()}).checks.length,0);
  } finally {rmSync(root,{recursive:true,force:true});}
});
