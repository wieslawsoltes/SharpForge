import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { root,probeRoot,sha256 } from './common.js';
import { resolveToolchain } from '../oracle/toolchain.js';
import { runProcess } from '../oracle/process.js';

// Catalog releases are ordered explicitly: minor releases cannot be found with parseInt.
// ISO-1 represents both C# 1.0 and 1.2, not two historical compiler implementations:
// https://learn.microsoft.com/dotnet/csharp/language-reference/compiler-options/language#langversion
const releases = ['1.0', '1.2', '2.0', '3.0', '4.0', '5.0', '6.0', '7.0', '7.1', '7.2', '7.3',
  '8.0', '9.0', '10.0', '11.0', '12.0', '13.0', '14.0', '15.0'];

export function languageBoundary(feature) {
  const version = /^\d+$/.test(feature.version) ? `${feature.version}.0` : feature.version;
  const index = releases.indexOf(version);
  if (index < 0) throw new Error(`Unknown inventory language release: ${feature.version}`);
  if (index === 0) return { langVersion: null, kind: 'first-release', reason: 'No earlier catalog language release exists.' };
  return { langVersion: releases[index - 1], kind: version === '1.2' ? 'shared-iso-1' : 'adjacent-release',
    reason: version === '1.2' ? 'Pinned Roslyn uses ISO-1 for both C# 1.0 and 1.2; this cannot qualify their historical behavior difference.'
      : 'Expected acceptance comes from this same probe on pinned Roslyn; a historical/API feature need not reject the previous language version.' };
}

export const malformedProbeSource = source => source + '\nclass __Invalid { void M( }';

export function referenceProbeContext(feature, langVersion = feature.langVersion) {
  return { langVersion: ['1.0', '1.2'].includes(langVersion) ? '1' : langVersion,
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

// Command-line, input/reference and output failures do not describe a feature's language boundary.
const infrastructureCodes = new Set(['CS0006', 'CS0009', 'CS0016', 'CS0041', 'CS0042', 'CS1504', 'CS1562',
  'CS1566', 'CS1617', 'CS1719', 'CS1902', 'CS1926', 'CS2001', 'CS2006', 'CS2007', 'CS2011', 'CS2012',
  'CS2015', 'CS2016', 'CS2021', 'CS2033', 'CS2041', 'CS2046', 'CS7064', 'CS7093', 'CS8035', 'CS8771', 'CS8772']);

export function assertNativeDecision(observation, id) {
  const diagnostics = observation?.diagnostics;
  if (typeof observation?.accepted !== 'boolean' || observation.exitCode !== (observation.accepted ? 0 : 1) ||
      observation.signal !== null || !Array.isArray(diagnostics) || diagnostics.some(text => typeof text !== 'string')) {
    throw new Error(`Native language probe did not return a compiler decision: ${id}`);
  }
  const errors = diagnostics.flatMap(text => [...text.matchAll(/\berror (CS\d+):/g)].map(match => match[1]));
  if (observation.accepted === !!errors.length || errors.some(code => infrastructureCodes.has(code))) {
    throw new Error(`Native language probe returned an invalid or infrastructure decision: ${id}`);
  }
}

export async function referenceFeatureProbes(feature, source, { toolchain, references, directory, signal, run = runProcess }) {
  const file = path.join(directory, 'Probe.cs');
  async function capture(text, langVersion) {
    await writeFile(file, text);
    const context = referenceProbeContext(feature, langVersion);
    const args = referenceProbeArguments(feature, { file, directory, references, langVersion });
    const result = await run(toolchain.dotnet, [toolchain.csc, ...args], { cwd: directory, signal, timeoutMs: 30000 });
    const diagnostics = referenceDiagnostics(result.stdout + result.stderr, directory, file);
    const observation = { sourceSHA256: sha256(text), ...context, accepted: result.exitCode === 0,
      exitCode: result.exitCode, signal: result.signal ?? null, diagnostics };
    assertNativeDecision(observation, `${feature.id} (${langVersion})`);
    return observation;
  }
  const boundary = languageBoundary(feature);
  const positive = await capture(source, feature.langVersion);
  const malformed = await capture(malformedProbeSource(source), feature.langVersion);
  if (malformed.accepted) throw new Error(`Native malformed probe was accepted: ${feature.id}`);
  const previous = boundary.langVersion ? await capture(source, boundary.langVersion) : null;
  return { id: feature.id, ...positive, malformed, boundary: previous };
}

/** Validate probe source fidelity with real pinned Roslyn. This is compiler-only
 * reference evidence, never execution evidence for SharpForge or native WinUI. */
export async function referenceLanguage({toolchain,signal}={}) {
  toolchain??=await resolveToolchain();
  const catalogBytes=await readFile(path.join(probeRoot,'csharp.json')), catalog=JSON.parse(catalogBytes), directory=await mkdtemp(path.join(os.tmpdir(),'sf-language-reference-')),results=[];
  const references=[...toolchain.references,path.join(path.dirname(toolchain.csc),'Microsoft.CodeAnalysis.dll'),path.join(path.dirname(toolchain.csc),'Microsoft.CodeAnalysis.CSharp.dll')];
  try {
    for(const feature of catalog.features) {
      const source=await readFile(path.join(root,feature.probe),'utf8');
      results.push(await referenceFeatureProbes(feature,source,{toolchain,references,directory,signal}));
    }
    return {schemaVersion:1,scope:'Actual pinned Roslyn positive, malformed and adjacent-version compilation; no execution or historical compiler emulation',
      compiler:toolchain.actual.roslyn,referenceAssemblies:toolchain.actual.referenceAssemblies,catalogSHA256:sha256(catalogBytes),rows:results};
  } finally {await rm(directory,{recursive:true,force:true});}
}
