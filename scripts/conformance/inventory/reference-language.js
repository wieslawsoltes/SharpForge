import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { root,probeRoot,readJSON,sha256 } from './common.js';
import { resolveToolchain } from '../oracle/toolchain.js';
import { runProcess } from '../oracle/process.js';

export function referenceProbeContext(feature, langVersion = feature.langVersion) {
  return { langVersion: langVersion === '1.2' ? '1' : langVersion,
    target: feature.outputKind ?? 'library', features: feature.nativeFeatures ?? [] };
}

export function referenceProbeArguments(feature, { file, directory, references, langVersion } = {}) {
  const context = referenceProbeContext(feature, langVersion);
  return ['/noconfig', '/nostdlib+', '/nologo', `/target:${context.target}`, '/unsafe+', '/nullable:disable',
    `/langversion:${context.langVersion}`, '/deterministic+', ...context.features.map(value => `/features:${value}`),
    `/out:${path.join(directory, 'Probe.dll')}`, ...references.map(reference => `/reference:${reference}`), file];
}

export function referenceDiagnostics(output,directory,file) {
  // Roslyn can report independent warnings in different orders. Preserve each
  // complete diagnostic while comparing the collection in a stable order.
  return output.replaceAll(file,'Probe.cs').replaceAll(directory,'/_/inventory').replaceAll('\r\n','\n').trim().split('\n').filter(Boolean).sort();
}

/** Validate probe source fidelity with real pinned Roslyn. This is compiler-only
 * reference evidence, never execution evidence for SharpForge or native WinUI. */
export async function referenceLanguage({toolchain,signal}={}) {
  toolchain??=await resolveToolchain();
  const catalog=await readJSON(path.join(probeRoot,'csharp.json')), directory=await mkdtemp(path.join(os.tmpdir(),'sf-language-reference-')),results=[];
  const references=[...toolchain.references,path.join(path.dirname(toolchain.csc),'Microsoft.CodeAnalysis.dll'),path.join(path.dirname(toolchain.csc),'Microsoft.CodeAnalysis.CSharp.dll')];
  try {
    for(const feature of catalog.features) {
      const bytes=await readFile(path.join(root,feature.probe)),file=path.join(directory,'Probe.cs');await writeFile(file,bytes);
      const context=referenceProbeContext(feature);
      const args=referenceProbeArguments(feature,{file,directory,references});
      const result=await runProcess(toolchain.dotnet,[toolchain.csc,...args],{cwd:directory,signal,timeoutMs:30000});
      results.push({id:feature.id,sourceSHA256:sha256(bytes),...context,accepted:result.exitCode===0,exitCode:result.exitCode,diagnostics:referenceDiagnostics(result.stdout+result.stderr,directory,file)});
    }
    return {schemaVersion:1,scope:'Actual pinned Roslyn source validity with each fixture compilation target; no execution',compiler:toolchain.actual.roslyn,rows:results};
  } finally {await rm(directory,{recursive:true,force:true});}
}
