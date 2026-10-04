/**
 * `compileToAssembly` (SF-A02-T30): source to an ECMA-335 assembly through the direct CIL pipeline - semantic
 * analysis, then metadata from symbols and method bodies from bound trees. The bytecode image is not involved.
 *
 * A valid program that uses a construct the emitter has no code for yet gets one SF2200 naming the construct and no
 * assembly; a declaration metadata cannot hold gets SF3001.
 */
import { CilError } from '@sharpforge/cil';
import { SymbolError } from '@sharpforge/symbols';
import { diagnostic } from '@sharpforge/text';
import { DiagnosticId, formatMessage } from '../../diagnostics/codes.js';
import { parseCompilerInput } from '../../parse-input.js';
import { SemanticAnalysis } from '../../semantic-analysis.js';
import { adapterPseudo } from '../../semantic-integration.js';
import { MetadataEmitError } from '../../codegen/metadata/type-tokens.js';
import { emitAssemblyFromAnalysis } from './assembly-emitter.js';
import { UnsupportedInCil } from './unsupported.js';
import { IlBuilderError } from './il-builder.js';

const isSyntaxError = entry => /^CS\d{4}$/.test(entry.code) && !adapterPseudo(entry);

/** The diagnostic for a failure of emission, at the construct when its position is known, else at the start of the program. */
function emissionFailure(error, files) {
  const unsupported = error instanceof UnsupportedInCil,
    file = files.find(candidate => candidate.source.uri === error.uri) ?? files[0],
    span = error.syntax?.span ?? error.syntax,
    start = span?.start ?? 0,
    length = span?.start === undefined ? 1 : Math.max(1, span.end - span.start),
    code = error.diagnosticCode ?? (unsupported ? DiagnosticId.SF2200 : DiagnosticId.SF3001),
    args = error.diagnosticArguments ?? [unsupported ? error.construct : error.message];
  return diagnostic(file.source, start, length, code, formatMessage(code, args), 'error');
}

/**
 * Compiles source to an assembly with real method bodies.
 * @param {string|object|object[]} input what `compile` accepts
 * @param {object} [options] compilation options, `name`, `outputKind` ('library' for no entry point), and optional
 *   `portablePdb`, `embeddedPdb`, `embedSources`, and `sourceLink`; symbols are disabled unless explicitly requested
 * @returns {{success: boolean, assembly: Uint8Array|null, pdb: Uint8Array|null, diagnostics: object[], format: 'cil'}}
 *   `assembly` and `pdb` are null when the program has errors or cannot be emitted (SF2200, SF3001)
 */
export function compileToAssembly(input, options = {}) {
  const files = parseCompilerInput(input, options),
    analysis = new SemanticAnalysis(files, options),
    // The files also carry the execution profile's diagnostics (SFxxxx); only the syntax errors apply here.
    syntax = files.flatMap(file => (file.diagnostics ?? []).filter(isSyntaxError)),
    diagnostics = [...syntax, ...analysis.run().diagnostics],
    failed = extra => ({ success: false, assembly: null, pdb: null, diagnostics: [...diagnostics, ...extra], format: 'cil' });
  if (diagnostics.some(entry => entry.severity === 'error')) return failed([]);
  try {
    const emitted = emitAssemblyFromAnalysis(analysis, options);
    return { success: true, assembly: emitted.bytes, pdb: emitted.pdb, diagnostics, format: 'cil' };
  } catch (error) {
    const known = [UnsupportedInCil, MetadataEmitError, CilError, IlBuilderError, SymbolError].some(kind => error instanceof kind);
    if (!known) throw error;
    return failed([emissionFailure(error, files)]);
  }
}
