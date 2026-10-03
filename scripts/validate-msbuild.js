import {resultPath} from './conformance/results.js';
/** Real SDK qualification only. No simulator is used; a missing SDK is a failed/unavailable gate. */
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {NativeWorkspace,NativeMSBuild} from '../packages/msbuild/src/node.js';
const repository=fileURLToPath(new URL('../',import.meta.url)),root=await mkdtemp(join(tmpdir(),'sharpforge-real-msbuild-')),results=[];
let engine,report={passed:false,simulated:false,available:false,checks:results};
try{
 await cp(join(repository,'examples/msbuild'),root,{recursive:true});const workspace=await NativeWorkspace.open(root);engine=new NativeMSBuild(workspace,{trusted:true,executable:process.env.SHARPFORGE_MSBUILD_EXECUTABLE??'dotnet',engine:process.env.SHARPFORGE_MSBUILD_ENGINE??'dotnet'});const probe=await engine.probe();report={...report,...probe};if(!probe.available)throw new Error(probe.error);
 async function run(project,action='build',options={},expected='succeeded'){const j=await engine.start({project,action,trusted:true,...options}),r=await engine.wait(j.id);results.push({project,action,status:r.status,error:r.error,diagnostics:r.diagnostics,invocation:r.invocation});assert.equal(r.status,expected,r.error??r.events.map(e=>e.text).join(''));return r;}
 const pipeline='IncrementalPipeline/Build.proj',app='SdkWorkspace/App/App.csproj';
 await run(pipeline);const copied=join(root,'IncrementalPipeline/bin/pipeline/alpha.copy.txt'),before=await stat(copied);await run(pipeline);assert.equal((await stat(copied)).mtimeMs,before.mtimeMs);results.push({check:'incremental target skips unchanged copy',passed:true});
 await run(pipeline,'target',{targets:['RunInline']});await run(pipeline,'target',{targets:['Diagnose']},'failed');
 await run('SdkWorkspace/Workspace.slnx','build',{restore:true,binaryLog:true,configuration:'Release',maxNodes:2});
 const generated=join(root,'SdkWorkspace/App/obj/Release/net10.0/BuildTag.g.cs'),generatedBefore=await stat(generated);await run('SdkWorkspace/Workspace.slnx','build',{configuration:'Release'});assert.equal((await stat(generated)).mtimeMs,generatedBefore.mtimeMs);results.push({check:'generated source target is incremental',passed:true});
 const evaluated=await run(app,'evaluate',{configuration:'Release'});assert.equal(evaluated.result.Properties.Configuration,'Release');assert.equal(evaluated.result.Properties.TargetFramework,'net10.0');assert(evaluated.result.Items.ProjectReference.length);assert(evaluated.artifacts.some(a=>a.kind==='evaluated-output'));
 await run(app,'preprocess');await run(app,'targets');await run(app,'target',{configuration:'Release',targets:['DumpBuildContract'],resultTargets:['DumpBuildContract']});
 const execute=dll=>{const p=spawnSync('dotnet',[join(root,dll)],{cwd:root,encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr);return p.stdout.trim();};assert.equal(execute('SdkWorkspace/App/bin/Release/net10.0/App.dll'),'Native MSBuild: 42 / generated 42');results.push({check:'native CLR executes separately compiled solution output',passed:true});
 await run('SdkWorkspace/Library/Library.csproj','pack',{restore:true,configuration:'Release'});await run(app,'publish',{restore:true,configuration:'Release'});await run(app,'clean',{configuration:'Release'});await run(app,'rebuild',{restore:true,configuration:'Release'});
 await run('LocalPackages/Producer/Producer.csproj','pack',{restore:true});await run('LocalPackages/Consumer/Consumer.csproj','restore');await run('LocalPackages/Consumer/Consumer.csproj');assert.equal(execute('LocalPackages/Consumer/bin/Debug/net10.0/Consumer.dll'),'42');results.push({check:'local NuGet package and central version restore',passed:true});
 await run('MultiTarget/MultiTarget.csproj','build',{restore:true});
 report.passed=true;
}catch(error){report.error=error.stack??error.message;process.exitCode=1;}
finally{await engine?.close();await rm(root,{recursive:true,force:true});await writeFile(await resultPath('msbuild-native-results.json'),JSON.stringify({...report,timestamp:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify(report,null,2));}
