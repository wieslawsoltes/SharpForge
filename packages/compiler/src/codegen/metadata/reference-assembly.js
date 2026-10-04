/**
 * A reference assembly from source symbols (SF-A02-T29): the declarations of a compilation as a PE/CLI image whose
 * metadata is complete and whose method bodies are `throw null`, the convention of .NET reference assemblies.
 *
 * This is the symbol-driven half of CIL generation: every declaration form the binder understands reaches metadata,
 * including the ones the execution profile cannot run (inheritance, interfaces, structs, enums, generics). It does not
 * emit the code of method bodies; `compileToIL` remains the executable path.
 *
 * Driven entirely through the public API of `@sharpforge/cil` (MetadataBuilder, writeMethodBody, writePE).
 */
import { MetadataBuilder, Writer, writeMethodBody, writePE, TEXT_RVA, CilError, addReferenceAssemblyAttribute } from '@sharpforge/cil';
import { DiagnosticId, formatMessage } from '../../diagnostics/codes.js';
import { diagnostic } from '@sharpforge/text';
import { parseCompilerInput } from '../../parse-input.js';
import { SemanticAnalysis } from '../../semantic-analysis.js';
import { adapterPseudo } from '../../semantic-integration.js';
import { SymbolMetadataWriter } from './symbol-metadata.js';
import { CustomAttributeWriter } from './custom-attributes.js';
import { MetadataEmitError } from './type-tokens.js';
import { referenceIdentitiesOf } from './reference-identities.js';

import { RecordPlan } from './record-plan.js';
import { refoutEnabled, RefoutPlan } from './refout-plan.js';

const CLI_HEADER_SIZE = 72;
/** `ldnull; throw`. */
const THROW_NULL = Uint8Array.of(0x14, 0x7a);

/**
 * Writes the reference assembly of an analysis that has run without errors.
 * @param analysis a SemanticAnalysis  @param {{name?: string, framework?: string, deterministic?: boolean, refout?: boolean}} [options]
 * @returns {{bytes: Uint8Array, writer: SymbolMetadataWriter}} the image and the writer (definition tokens by symbol)
 */
export function emitReferenceAssembly(analysis, options = {}) {
  const refout = refoutEnabled(options) ? new RefoutPlan(analysis) : null;
  const builder = new MetadataBuilder(options.name ?? 'Application', {
    framework: options.framework ?? 'net8',
    assemblyReferences: referenceIdentitiesOf(analysis),
  });
  const section = new Writer().zero(CLI_HEADER_SIZE);
  // Every body is the same two instructions, so all methods share one body, as Roslyn shares identical small bodies.
  const bodyRva = TEXT_RVA + section.length;
  section.bytes(writeMethodBody(THROW_NULL, 0, 1, []));
  const records = new RecordPlan(analysis.core),
    synthesized = { types: [], extend: (type, plan) => {
      records.extend(type, plan);
      refout?.filter(type, plan);
    } },
    writer = new SymbolMetadataWriter(builder, analysis, { bodyRva, synthesized }).write();
  new CustomAttributeWriter(writer, analysis).write();
  if (refout && !refout.hasMarker) {
    const marker = 'System.Runtime.CompilerServices.ReferenceAssemblyAttribute';
    addReferenceAssemblyAttribute(builder, writer.tokens.assemblyOf({}, marker));
  }
  section.pad();
  const metadataOffset = section.length,
    metadata = builder.finish(null, section.finish());
  section.bytes(metadata);
  const bytes = writePE(section.finish(), metadataOffset, metadata.length, 0, { outputKind: 'library', deterministic: options.deterministic ?? true });
  return { bytes, writer };
}

/**
 * Compiles source to a reference assembly.
 * @param {string|object|object[]} input what `compile` accepts  @param {object} [options] compilation options and `name`;
 *   `refout: true` strips inaccessible members and adds ReferenceAssemblyAttribute, while the default keeps every declaration
 * @returns {{success: boolean, assembly: Uint8Array|null, diagnostics: object[]}} `assembly` is null when the program
 *   has errors, or when a declaration cannot be written to metadata (reported as SF3001)
 */
export function compileToReferenceAssembly(input, options = {}) {
  const files = parseCompilerInput(input, options),
    analysis = new SemanticAnalysis(files, options),
    // The files also carry the execution profile's diagnostics (SFxxxx); only the syntax errors apply here.
    syntax = files.flatMap(file => (file.diagnostics ?? []).filter(d => /^CS\d{4}$/.test(d.code) && !adapterPseudo(d))),
    diagnostics = [...syntax, ...analysis.run().diagnostics];
  if (diagnostics.some(d => d.severity === 'error')) return { success: false, assembly: null, diagnostics };
  try {
    return { success: true, assembly: emitReferenceAssembly(analysis, options).bytes, diagnostics };
  } catch (error) {
    if (!(error instanceof MetadataEmitError) && !(error instanceof CilError)) throw error;
    const failure = diagnostic(files[0].source, 0, 1, DiagnosticId.SF3001, formatMessage(DiagnosticId.SF3001, [error.message]));
    return { success: false, assembly: null, diagnostics: [...diagnostics, failure] };
  }
}
