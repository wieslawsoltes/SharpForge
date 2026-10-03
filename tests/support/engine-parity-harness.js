import assert from 'node:assert/strict';
import {compile,compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {exceptionTypeName} from '../../packages/runtime/src/execution/exception-types.js';

export function validateParityAllowlist(entries,fixtureIds) {
  const seen=new Set();
  for(const entry of entries) {
    assert(fixtureIds.has(entry.fixture),`Unknown allowlisted fixture ${entry.fixture}`);
    assert(!seen.has(entry.fixture),`Duplicate allowlist entry ${entry.fixture}`);seen.add(entry.fixture);
    assert(typeof entry.owner==='string'&&entry.owner.trim(),`Missing owner for ${entry.fixture}`);
    assert(typeof entry.reason==='string'&&entry.reason.trim().length>20,`Missing concrete reason for ${entry.fixture}`);
    assert(/^https:\/\/github\.com\//.test(entry.issue),`Missing tracking issue for ${entry.fixture}`);
    assert(entry.outputReplacements?.length,`An allowance must target an output field: ${entry.fixture}`);
    for(const {pattern,replacement} of entry.outputReplacements) {
      assert(pattern instanceof RegExp&&typeof replacement==='string',`Invalid output rule for ${entry.fixture}`);
      assert(pattern.source.startsWith('^')&&pattern.source.endsWith('$')&&!/\.\*|\.\+/.test(pattern.source),`Output rules must match a specific whole line: ${entry.fixture}`);
    }
  }
}

export function compareEngineResults(fixture,results,allowlist=[],used=new Set()) {
  const entries=Object.entries(results);assert(entries.length>=2,'Parity needs independent engines');
  const allowance=allowlist.find(entry=>entry.fixture===fixture.id);
  const normalize=result=>({state:result.state,output:allowance?allowance.outputReplacements.reduce((output,{pattern,replacement})=>output.replace(pattern,replacement),result.output):result.output,exceptionType:result.exceptionType,exitCode:result.exitCode});
  const [baselineName,baseline]=entries[0];
  for(const [name,result] of entries.slice(1)) {
    assert.deepEqual(normalize(result),normalize(baseline),`${fixture.id}: ${name} differs from ${baselineName}${result.error?'\n'+result.error.message:''}`);
    if(allowance&&result.output!==baseline.output)used.add(allowance.fixture);
  }
  const expected={state:'terminated',exceptionType:null,exitCode:0,...fixture.expected};
  for(const [name,result] of entries)for(const [field,value] of Object.entries(expected))assert.deepEqual(result[field],value,`${fixture.id}: ${name} expected ${field}`);
}

const diagnosticCodes=compilation=>compilation.diagnostics.filter(diagnostic=>diagnostic.severity==='error').map(diagnostic=>diagnostic.code).sort();
export const canonicalFaultType=fault=>fault?exceptionTypeName(fault.name):null;
async function execute(create,signal) {
  let vm;
  try {
    vm=create();const result=await vm.runAsync({signal});
    return {state:result.state,output:result.output,exceptionType:canonicalFaultType(result.fault),
      diagnosticName:result.fault?.name??null,exitCode:result.exitCode};
  } catch(error) {
    return {state:vm?'host-error':'load-error',output:vm?.output.join('')??'',exceptionType:canonicalFaultType(error),
      diagnosticName:error.name,exitCode:vm?.exitCode??null,error:{message:error.message,stack:error.stack}};
  } finally {vm?.stop();}
}

export async function runParityFixture(fixture,{signal}={}) {
  const source=compile(fixture.source,fixture.compilationOptions),cil=compileToIL(fixture.source,fixture.compilationOptions);
  assert.equal(source.success,cil.success,`${fixture.id}: source/CIL compilation success`);
  assert.deepEqual(diagnosticCodes(source),diagnosticCodes(cil),`${fixture.id}: source/CIL diagnostics`);
  if(fixture.compileFailure) {
    assert.equal(source.success,false,`${fixture.id}: negative fixture unexpectedly compiled`);
    assert.equal(source.image,null);assert.equal(cil.image,null);assert.equal(cil.assembly,null);
    for(const code of fixture.diagnosticCodes??[])assert(diagnosticCodes(source).includes(code),`${fixture.id}: expected ${code}`);
    return null;
  }
  assert(source.success,`${fixture.id}: ${JSON.stringify(source.diagnostics)}`);
  const options={virtualTime:true,maxInstructions:2_000_000,...fixture.runtimeOptions};
  assert(Number.isSafeInteger(options.maxInstructions)&&options.maxInstructions>0,`${fixture.id}: a finite instruction budget is required`);
  // Each route owns a fresh heap/scheduler and is executed even if another route fails.
  const results={};
  results.source=await execute(()=>new VirtualMachine(source.image,options),signal);
  results['reloaded-source']=await execute(()=>new VirtualMachine(loadAssembly(cil.assembly),options),signal);
  results.cil=await execute(()=>new CilVirtualMachine(cil.assembly,options),signal);
  return results;
}
