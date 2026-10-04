import {DiagnosticId} from '../diagnostics/codes.js';
import { CilError } from '@sharpforge/cil';
import { PEAssemblySymbol, importAssembly } from './pe-symbols.js';

/** Decode each supplied reference once and report invalid metadata as CS0009, including unused references. */
export function readCompilationReferences(references) {
  const prepared = [], diagnostics = [];
  for (const [index, reference] of references.entries()) {
    const display = reference?.display ?? `<reference ${index + 1}>`;
    try {
      const assembly = reference?.assembly instanceof PEAssemblySymbol ? reference.assembly
        : importAssembly(reference?.bytes, { filePath: display, ...reference?.options });
      prepared.push({ ...reference, assembly });
    } catch (error) {
      if (!(error instanceof CilError || error instanceof RangeError || error instanceof TypeError)) throw error;
      diagnostics.push({ code: DiagnosticId.CS0009, args: [display, error.message] });
    }
  }
  return { references: prepared, diagnostics };
}
