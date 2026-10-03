import {emitPortablePdb,attachPortablePdb,SymbolError} from '@sharpforge/symbols';
import {emitAssemblyDetailed,CilError} from '@sharpforge/cil';
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
  const {framework='net8',embedSources=true,includeDebug=true,portablePdb=true,embeddedPdb=false,sourceLink=null,...compileOptions}=options;
  const result=compile(input,compileOptions);if(!result.success)return {...result,assembly:null,format:'cil'};
  try {const emitted=emitAssemblyDetailed(result.image,{...options,name:compileOptions.name??result.image.name});const symbols=portablePdb?emitPortablePdb(emitted.bytes,emitted.symbolData,{embedSources,sourceLink}):null;const assembly=symbols?attachPortablePdb(emitted.bytes,symbols.bytes,{path:(compileOptions.name??result.image.name)+'.pdb',embedded:embeddedPdb}):emitted.bytes;return {...result,assembly,pdb:symbols?.bytes??null,format:'cil',metrics:{...result.metrics,...emitted.metrics,assemblyBytes:assembly.length,pdbBytes:symbols?.bytes.length??0}};}
  catch(error){if(!(error instanceof CilError)&&!(error instanceof SymbolError))throw error;const source=result.image.sources[0],d=diagnostic(new SourceText(source?.text??'',source?.uri??'Program.cs'),0,1,'SF3001',formatMessage('SF3001',[error.message]));return {...result,success:false,image:null,assembly:null,format:'cil',diagnostics:[...result.diagnostics,d],metrics:{...result.metrics,errors:result.metrics.errors+1}};}
}
