/** Live .NET 10 comparison; do not run until E01 integration is complete. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';

const run=promisify(execFile),dotnet=process.env.DOTNET_PATH??'dotnet',directory=await mkdtemp(join(tmpdir(),'sharpforge-a05-sync-'));
const options={encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'}},normalize=text=>text.replaceAll('\r\n','\n');
const source=await readFile(new URL('../tests/fixtures/a05/synchronization/Program.cs',import.meta.url),'utf8'),expected=await readFile(new URL('../tests/fixtures/a05/synchronization/expected.txt',import.meta.url),'utf8');
try {
  const sdk=(await run(dotnet,['--version'],options)).stdout.trim(),runtimeInfo=(await run(dotnet,['--info'],options)).stdout,commit=(await run('git',['rev-parse','HEAD'],{...options,cwd:new URL('..',import.meta.url)})).stdout.trim();
  assert(/^10\./.test(sdk),'The native synchronization profile is pinned to .NET 10');
  await writeFile(join(directory,'Synchronization.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><Optimize>false</Optimize><NuGetAudit>false</NuGetAudit></PropertyGroup></Project>');
  await writeFile(join(directory,'Program.cs'),source);
  await run(dotnet,['build',join(directory,'Synchronization.csproj'),'-c','Release','--nologo','-p:RestoreIgnoreFailedSources=true'],options);
  const assemblyPath=join(directory,'bin','Release','net10.0','Synchronization.dll'),assembly=new Uint8Array(await readFile(assemblyPath));
  const native=normalize((await run(dotnet,[assemblyPath],options)).stdout);assert.equal(native,expected,'Native .NET synchronization output');
  const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const outcomes=[];
  for(const quantum of [1,7,256])for(const [name,vm] of [['source',new VirtualMachine(compiled.image,{virtualTime:true,schedulerQuantum:quantum})],['emitted-cil',new CilVirtualMachine(compiled.assembly,{virtualTime:true,schedulerQuantum:quantum})],['roslyn-cil',new CilVirtualMachine(assembly,{virtualTime:true,schedulerQuantum:quantum})]]) {
    const result=await vm.runAsync();assert.equal(result.state,'terminated',name+': '+result.fault?.stack);assert.equal(result.output,native,name+' quantum '+quantum);outcomes.push({engine:name,quantum,instructions:vm.instructions,passed:true});
  }
  const report={passed:true,commit,node:process.version,sdk,runtimeInfo,platform:process.platform,architecture:process.arch,sourceSha256:createHash('sha256').update(source).digest('hex'),assemblySha256:createHash('sha256').update(assembly).digest('hex'),outcomes,nativeThreads:true,managedVmScheduling:'cooperative single JavaScript agent'};
  if(process.env.A05_SYNC_OUTPUT){const output=resolve(process.env.A05_SYNC_OUTPUT);await mkdir(output,{recursive:true});await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(output,'Synchronization.dll'),assembly);await writeFile(join(output,'Program.cs'),source);await writeFile(join(output,'expected.txt'),expected);await copyFile(join(directory,'bin','Release','net10.0','Synchronization.runtimeconfig.json'),join(output,'Synchronization.runtimeconfig.json'));}
  console.log(JSON.stringify(report,null,2));
} finally {await rm(directory,{recursive:true,force:true});}
