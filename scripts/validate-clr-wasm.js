import {resultPath} from './conformance/results.js';
/** Independent managed-runtime validation. Requires an existing .NET WASM publish directory.
 * No runtime binaries or third-party assemblies are copied into this project.
 * Usage: DOTNET_WASM_DIR=/path/to/published/_framework node scripts/validate-clr-wasm.js
 * This adapter was verified with the installed trimmed Mono .NET 9.0.17 runtime.
 */
import { readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { compileToIL } from '../packages/compiler/src/index.js';
import { clrExecutionCases } from '../tests/clr-fixtures.js';
import { runtimeFacade } from '../tests/support/trimmed-runtime-facade.js';
const directory=process.env.DOTNET_WASM_DIR;
if(!directory)throw new Error('Set DOTNET_WASM_DIR to an existing .NET 9 WASM framework directory. This project does not ship a .NET runtime.');
const root=resolve(directory),boot=JSON.parse(await readFile(join(root,'blazor.boot.json'),'utf8'));
const tests=clrExecutionCases.map(([name,source,expected],index)=>{const assemblyName='SharpForgeValidation'+index,compilation=compileToIL(source,{name:assemblyName});if(!compilation.success)throw new Error(JSON.stringify(compilation.diagnostics));return {name,assemblyName,expected,bytes:compilation.assembly};});
const config={...boot,mainAssemblyName:tests[0].assemblyName,assets:[],enableDownloadRetry:false};
for(const [key,behavior]of [['jsModuleNative','js-module-native'],['jsModuleRuntime','js-module-runtime'],['wasmNative','dotnetwasm'],['coreAssembly','assembly'],['assembly','assembly']]){
 for(const name of Object.keys(boot.resources[key]??{}))config.assets.push({name,behavior,virtualPath:boot.resources.fingerprinting?.[name]??name,resolvedUrl:pathToFileURL(join(root,name)).href,isCore:key==='coreAssembly'});
}
const hasFacade=config.assets.some(a=>/^System\.Runtime\.(?:dll|wasm)$/.test(a.virtualPath));
if(!hasFacade){const facade=runtimeFacade();config.assets.push({name:'System.Runtime.dll',virtualPath:'System.Runtime.dll',behavior:'assembly',buffer:facade.buffer});}
for(const t of tests)config.assets.push({name:t.assemblyName+'.dll',virtualPath:t.assemblyName+'.dll',behavior:'assembly',buffer:t.bytes.buffer});
const {default:create}=await import(pathToFileURL(join(root,'dotnet.js')));
const runtime=await create({config,imports:{require:createRequire(import.meta.url)},print:s=>console.log('CLR:',s),printErr:s=>console.error('CLR:',s)});
const results=[];
for(const t of tests){try{const actual=await runtime.runMain(t.assemblyName+'.dll',[]),passed=actual===t.expected;results.push({name:t.name,expected:t.expected,actual,passed});console.log(passed?'PASS':'FAIL',t.name);}catch(error){results.push({name:t.name,expected:t.expected,passed:false,error:String(error)});console.error('FAIL',t.name,String(error));}}
const report={timestamp:new Date().toISOString(),runtime:runtime.runtimeBuildInfo,referenceProfile:'net8',testOnlyTypeForwardingFacade:!hasFacade,scope:'46 output-free fixtures executed by independent Mono .NET WASM, not by SharpForge VM. The installed runtime is trimmed; Console and some BCL overloads are unavailable. No desktop CoreCLR/ILVerify claim.',results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};
await writeFile(await resultPath('clr-wasm-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${report.passed}/${results.length} independent CLR fixtures passed`);if(report.failed)process.exitCode=1;
