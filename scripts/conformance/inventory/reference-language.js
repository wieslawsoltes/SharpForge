import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { root,probeRoot,readJSON,sha256 } from './common.js';
import { resolveToolchain } from '../oracle/toolchain.js';
import { runProcess } from '../oracle/process.js';

/** Validate probe source fidelity with real pinned Roslyn. This is compiler-only
 * reference evidence, never execution evidence for SharpForge or native WinUI. */
export async function referenceLanguage({toolchain,signal}={}) {
  toolchain??=await resolveToolchain();
  const catalog=await readJSON(path.join(probeRoot,'csharp.json')), directory=await mkdtemp(path.join(os.tmpdir(),'sf-language-reference-')),results=[];
  const references=[...toolchain.references,path.join(path.dirname(toolchain.csc),'Microsoft.CodeAnalysis.dll'),path.join(path.dirname(toolchain.csc),'Microsoft.CodeAnalysis.CSharp.dll')];
  try {
    for(const feature of catalog.features) {
      const bytes=await readFile(path.join(root,feature.probe)),file=path.join(directory,'Probe.cs');await writeFile(file,bytes);
      const language=feature.langVersion==='1.2'?'1':feature.langVersion;
      const args=['/noconfig','/nostdlib+','/nologo',`/target:${feature.outputKind??'library'}`,'/unsafe+','/nullable:disable',`/langversion:${language}`,'/deterministic+',...(feature.nativeFeatures??[]).map(value=>`/features:${value}`),`/out:${path.join(directory,'Probe.dll')}`,...references.map(reference=>`/reference:${reference}`),file];
      const result=await runProcess(toolchain.dotnet,[toolchain.csc,...args],{cwd:directory,signal,timeoutMs:30000});
      const output=(result.stdout+result.stderr).replaceAll(file,'Probe.cs').replaceAll(directory,'/_/inventory').replaceAll('\r\n','\n');
      results.push({id:feature.id,sourceSHA256:sha256(bytes),langVersion:language,target:feature.outputKind??'library',features:feature.nativeFeatures??[],accepted:result.exitCode===0,exitCode:result.exitCode,diagnostics:output.trim().split('\n').filter(Boolean)});
    }
    return {schemaVersion:1,scope:'Actual pinned Roslyn source validity; library compilation only',compiler:toolchain.actual.roslyn,rows:results};
  } finally {await rm(directory,{recursive:true,force:true});}
}
