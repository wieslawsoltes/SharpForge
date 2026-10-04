import {DiagnosticId} from './diagnostics/codes.js';
import {cilCompilationOptions,emitCompiledCil} from './compile-cil.js';
import {SymbolError} from '@sharpforge/symbols';
import {CilError} from '@sharpforge/cil';
import {SourceText,diagnostic} from '@sharpforge/text';
import {parseCompilerInput} from './parse-input.js';
import {Compilation} from './compilation.js';
import {formatMessage} from './diagnostics/codes.js';
export function compile(input, options = {}) {
  return new Compilation(parseCompilerInput(input, options), options).build();
}

/** Compile to the portable PE/CLI artifact without changing the lightweight IDE analysis API.
 * Errors are returned as diagnostics; image remains available only as a compiler/debugging IR.
 */
export function compileToIL(input,options={}) {
  const compileOptions=cilCompilationOptions(options);
  const result=compile(input,compileOptions);if(!result.success)return {...result,assembly:null,format:'cil'};
  try {return emitCompiledCil(result,options);}
  catch(error){if(!(error instanceof CilError)&&!(error instanceof SymbolError))throw error;const source=result.image.sources[0],d=diagnostic(new SourceText(source?.text??'',source?.uri??'Program.cs'),0,1,DiagnosticId.SF3001,formatMessage(DiagnosticId.SF3001,[error.message]));return {...result,success:false,image:null,assembly:null,format:'cil',diagnostics:[...result.diagnostics,d],metrics:{...result.metrics,errors:result.metrics.errors+1}};}
}
