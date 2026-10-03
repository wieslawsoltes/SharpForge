import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverLanguageFixtures} from './support/engine-parity-fixtures.js';
import {engineParityAllowlist} from './support/engine-parity-allowlist.js';
import {validateParityAllowlist,compareEngineResults,runParityFixture,canonicalFaultType} from './support/engine-parity-harness.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const {fixtures,catalogs}=await discoverLanguageFixtures(root),used=new Set();
validateParityAllowlist(engineParityAllowlist,new Set(fixtures.map(fixture=>fixture.id)));
test('engine parity discovers every catalog family',()=>{
  for(const catalog of ['tests/fixtures/language/compiler.js','tests/fixtures/language/release05.js','tests/fixtures/language/release06.js','tests/fixtures/language/language14.js','tests/cil-fixtures.js#cilExecutionCases','tests/clr-fixtures.js#clrExecutionCases','apps/studio/samples.js'])assert(catalogs.includes(catalog),catalog);
  assert(fixtures.length>100);assert(fixtures.some(fixture=>fixture.compileFailure));
});
for(const fixture of fixtures)test('engine parity: '+fixture.id,{timeout:30000},async context=>{
  const results=await runParityFixture(fixture,{signal:context.signal});
  if(results)compareEngineResults(fixture,results,engineParityAllowlist,used);
});
test('engine parity allowlist contains no stale divergences',()=>{
  for(const entry of engineParityAllowlist)assert(used.has(entry.fixture),`Remove obsolete allowance: ${entry.fixture}`);
});

test('engine parity automatically includes a newly added catalog and fixture row',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sharpforge-parity-discovery-'));
  try {
    const fixturesDirectory=join(directory,'tests/fixtures/language');await mkdir(fixturesDirectory,{recursive:true});
    await writeFile(join(directory,'package.json'),'{"type":"module"}');
    await writeFile(join(fixturesDirectory,'added.js'),'export const languageFixtures=[{id:"new/one",source:"Console.WriteLine(1);"},{id:"new/two",source:"Console.WriteLine(2);"}];');
    const discovered=await discoverLanguageFixtures(directory);
    assert.deepEqual(discovered.fixtures.map(fixture=>fixture.id),['new/one','new/two']);
  } finally {await rm(directory,{recursive:true,force:true});}
});
const success={state:'terminated',output:'42\n',exceptionType:null,exitCode:0};
test('engine parity preserves explicit raw fault-name assertions after managed alias normalization',()=>{
  const fixture={id:'resource fault',expected:{state:'faulted',output:'',
    exceptionType:'System.ExecutionEngineException',diagnosticName:'InstructionLimitException'}};
  const source={...success,...fixture.expected};
  compareEngineResults(fixture,{source,cil:{...source}});
  assert.throws(()=>compareEngineResults(fixture,{source,cil:{...source,diagnosticName:'System.ExecutionEngineException'}}),
    /cil expected diagnosticName/);
});
const sampleAllowance={fixture:'sample/gc',owner:'A05 runtime (@wieslawsoltes)',reason:'Synthetic comparator test permits only representation-dependent heap byte counts.',issue:'https://github.com/wieslawsoltes/SharpForge/issues/724',outputReplacements:[{pattern:/^(Before|After): \d+ bytes$/gm,replacement:'$1: <heap-bytes> bytes'}]};
test('engine parity canonicalizes known System exceptions while retaining user type identity',()=>{
  assert.equal(canonicalFaultType({name:'Exception'}),canonicalFaultType({name:'System.Exception'}));
  assert.equal(canonicalFaultType({name:'Contoso.Exception'}),'Contoso.Exception');
  assert.equal(canonicalFaultType({name:'CustomFault'}),'CustomFault');
  assert.equal(canonicalFaultType(null),null);
});
for(const [field,value] of [['output','41\n'],['exceptionType','System.Exception'],['exitCode',1],['state','waiting']])test('engine parity rejects a '+field+' difference',()=>{
  assert.throws(()=>compareEngineResults({id:'probe'},{source:success,cil:{...success,[field]:value}}),assert.AssertionError);
});
test('engine parity compares fault types even when both engines fault',()=>{
  const fixture={id:'fault',expected:{state:'faulted',exceptionType:'System.DivideByZeroException'}};
  const source={...success,state:'faulted',exceptionType:'System.DivideByZeroException'};
  assert.throws(()=>compareEngineResults(fixture,{source,cil:{...source,exceptionType:'System.OverflowException'}}),assert.AssertionError);
});
test('engine parity allowances retain surrounding output, fault types and exit codes',()=>{
  const fixture={id:'sample/gc'},source={...success,output:'Before: 80 bytes\nCollections: 1\nAfter: 16 bytes\n'},cil={...source,output:'Before: 96 bytes\nCollections: 1\nAfter: 24 bytes\n'};
  compareEngineResults(fixture,{source,cil},[sampleAllowance]);
  for(const changed of [{...cil,exitCode:1},{...cil,exceptionType:'System.Exception'},{...cil,output:cil.output.replace('Collections: 1','Collections: 2')}])assert.throws(()=>compareEngineResults(fixture,{source,cil:changed},[sampleAllowance]),assert.AssertionError);
});
test('engine parity requires an owner, reason and exact fixture for every allowance',()=>{
  const entry=sampleAllowance,ids=new Set([entry.fixture]);
  for(const changed of [{...entry,owner:''},{...entry,reason:''},{...entry,fixture:'*'},{...entry,outputReplacements:[{pattern:/^.*$/gm,replacement:''}]}])assert.throws(()=>validateParityAllowlist([changed],ids),assert.AssertionError);
});
test('engine parity observed heap allowances reject new values and unrelated changes',()=>{
  for(const [id,sourceOutput,cilOutput,unexpected] of [
    ['sample/gc','Before: 136 bytes\nCollections: 1\nAfter: 216 bytes\n','Before: 136 bytes\nCollections: 1\nAfter: 352 bytes\n','Before: 136 bytes\nCollections: 1\nAfter: 999 bytes\n'],
    ['sample/particles','Managed memory: 1178 bytes\n','Managed memory: 1498 bytes\n','Managed memory: 9999 bytes\n']
  ]) {
    const fixture={id},source={...success,output:sourceOutput},cil={...success,output:cilOutput};
    compareEngineResults(fixture,{source,cil},engineParityAllowlist);
    assert.throws(()=>compareEngineResults(fixture,{source,cil:{...cil,output:unexpected}},engineParityAllowlist),assert.AssertionError);
  }
});
