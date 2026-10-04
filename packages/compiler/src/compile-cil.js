import { emitPortablePdb, attachPortablePdb } from '@sharpforge/symbols';
import { emitAssemblyDetailed } from '@sharpforge/cil';
import { sourceTypeDefinitions } from './source-type-definitions.js';
import { sourceMemberDefinitions } from './source-member-definitions.js';

/** Reuse library compilation for netmodules, which have definitions but no managed entry point. */
export function cilCompilationOptions(options) {
  const { framework, embedSources, includeDebug, portablePdb, embeddedPdb, sourceLink, ...compilation } = options;
  if (compilation.outputKind === 'netmodule' || compilation.outputKind === 'module') compilation.outputKind = 'library';
  return compilation;
}

/** Emit the PE and optional Portable PDB from the compiler's existing library/executable IR. */
export function emitCompiledCil(result, options, parsedFiles) {
  const { embedSources = true, portablePdb = true, embeddedPdb = false, sourceLink = null } = options;
  const name = options.name ?? result.image.name;
  const outputKind = options.outputKind === 'module' ? 'netmodule' : options.outputKind;
  const typeDefinitions = options.typeDefinitions === undefined ? sourceTypeDefinitions(parsedFiles, result.image) : options.typeDefinitions;
  const memberDefinitions = options.memberDefinitions === undefined ? sourceMemberDefinitions(parsedFiles, result.image) : options.memberDefinitions;
  const emitted = emitAssemblyDetailed(result.image, { ...options, name, outputKind, typeDefinitions, memberDefinitions });
  const symbols = portablePdb ? emitPortablePdb(emitted.bytes, emitted.symbolData, { embedSources, sourceLink }) : null;
  const assembly = symbols ? attachPortablePdb(emitted.bytes, symbols.bytes, { path: name + '.pdb', embedded: embeddedPdb }) : emitted.bytes;
  return { ...result, assembly, pdb: symbols?.bytes ?? null, format: 'cil', metrics: { ...result.metrics, ...emitted.metrics,
    assemblyBytes: assembly.length, pdbBytes: symbols?.bytes.length ?? 0 } };
}
