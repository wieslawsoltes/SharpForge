import {resultPath} from './conformance/results.js';
/** Full-framework .NET host differential tests; requires an installed dotnet runtime.
 * Unlike the WASM fixture, this uses the real installed framework without a test facade.
 */
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileToIL } from '../packages/compiler/src/index.js';
import { createRuntimeConfig } from '../packages/cil/src/index.js';
import { clrExecutionCases } from '../tests/clr-fixtures.js';
import { samples } from '../apps/studio/samples.js';
import { cilExecutionCases } from '../tests/cil-fixtures.js';
const dotnet=process.env.DOTNET_PATH??'dotnet',probe=spawnSync(dotnet,['--list-runtimes'],{encoding:'utf8'});
if(probe.error||probe.status!==0)throw new Error('An installed .NET 8+ runtime is required. Set DOTNET_PATH to its dotnet host.');
const directory=await mkdtemp(join(tmpdir(),'sharpforge-clr-')),results=[];
const release05=samples.filter(s=>['properties','readonly-properties','finally','finally-loop','structural-refactoring','safe-watches','analyzer-tasks'].includes(s.id)).map(s=>({name:'0.5 '+s.name,source:s.files.map(f=>f.text).join('\n'),code:0,output:s.expectedOutput}));
const cases=[...release05,...clrExecutionCases.map(([name,source,code])=>({name,source,code,output:''})),...cilExecutionCases.map(([name,source,output])=>({name:'Console: '+name,source,code:0,output}))];
try{for(let i=0;i<cases.length;i++){
 const t=cases[i],name='Validation'+i,result=compileToIL(t.source,{name});if(!result.success)throw new Error(JSON.stringify(result.diagnostics));
 const path=join(directory,name+'.dll');await writeFile(path,result.assembly);await writeFile(join(directory,name+'.runtimeconfig.json'),JSON.stringify(createRuntimeConfig()));
 const run=spawnSync(dotnet,[path],{encoding:'utf8',timeout:15000,env:{...process.env,DOTNET_NOLOGO:'1'}}),expectedStatus=process.platform==='win32'?t.code:t.code&255;
 const output=run.stdout?.replaceAll('\r\n','\n'),passed=run.status===expectedStatus&&output===t.output;results.push({name:t.name,passed,expectedStatus,status:run.status,expectedOutput:t.output,output,stderr:run.stderr,error:run.error?.message});console.log(passed?'PASS':'FAIL',t.name);
}}finally{await rm(directory,{recursive:true,force:true});}
const report={timestamp:new Date().toISOString(),host:probe.stdout,results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};await writeFile(await resultPath('dotnet-results.json'),JSON.stringify(report,null,2)+'\n');console.log(`${report.passed}/${results.length} full-framework fixtures passed`);if(report.failed)process.exitCode=1;
