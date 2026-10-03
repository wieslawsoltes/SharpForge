import { AssemblyInspector } from './inspector.js';
import { readPE } from './pe.js';
import { readSignature, token, decodeCoded } from './metadata.js';
import { decodeInstructions } from './opcodes.js';
import { text } from './binary.js';
const hex=value=>'0x'+value.toString(16).padStart(8,'0');
const label=value=>'IL_'+value.toString(16).padStart(4,'0');
/** Inspection only: does not load or execute the assembly. Supports the opcode profile this package emits. */
export function disassembleAssembly(bytes,{methodToken=null,...options}={}) {const a=new AssemblyInspector(bytes,options).summary();return {...a,methods:a.methods.filter(m=>methodToken===null||m.token===methodToken)};}
/** Human-readable inspection listing, deliberately not advertised as lossless ilasm source. */
export function formatAssembly(bytes,options={}) {
  const assembly=disassembleAssembly(bytes,options),lines=[`// ${assembly.format}: ${assembly.name}`,`// ${assembly.bytes} bytes; entry point ${hex(assembly.entryPoint)}`,`// Inspection listing. Binary PE/CLI is the executable artifact; #SF holds browser debug maps.`];
  for(const m of assembly.methods){if(m.error){lines.push('',`// ${hex(m.token)} ${m.owner}::${m.name}: ${m.error}`);continue;}lines.push('',`// ${hex(m.token)}  ${m.owner}`,`.method ${m.signature.isStatic?'static':'instance'} ${m.signature.returnType} ${m.name}(${m.signature.parameters.join(', ')})`,'{');if(m.isEntryPoint)lines.push('  .entrypoint');lines.push(`  .maxstack ${m.maxStack}`);if(m.locals.length)lines.push('  .locals init ('+m.locals.map((t,i)=>`[${i}] ${t}`).join(', ')+')');for(const i of m.instructions){if(i.point)lines.push(`  // SEQ ${i.point.uri}:${i.point.line}:${i.point.column}`);lines.push(`  ${i.label}:  ${i.name.padEnd(12)} ${i.operandText}`.trimEnd());}for(const h of m.handlers)lines.push(`  // ${h.kind??'catch'}: try ${label(h.start)}..${label(h.end)}, handler ${label(h.target)}..${label(h.handlerEnd)}`);lines.push('}');}
  return lines.join('\n')+'\n';
}
/** SDK-free .NET host configuration for the standard net8 reference profile. */
export function createRuntimeConfig({version='8.0.0',rollForward='LatestMajor'}={}) {
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new TypeError('A numeric .NET runtime version is required');
  if(!['Disable','LatestPatch','Minor','LatestMinor','Major','LatestMajor'].includes(rollForward))throw new TypeError('Invalid .NET roll-forward policy');
  return {runtimeOptions:{tfm:`net${version.split('.').slice(0,2).join('.')}`,framework:{name:'Microsoft.NETCore.App',version},rollForward,configProperties:{'System.Globalization.Invariant':true}}};
}
