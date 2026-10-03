import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector} from '@sharpforge/cil';
import {writeFile,readFile} from 'node:fs/promises';
const main='class ExternalProgram {\n public static void Main(){\n  int value=20;\n  value=value+22;\n  Console.WriteLine(value);\n }\n}\n';
const c=compileToIL([{uri:'external/ExternalProgram.cs',text:main}],{includeDebug:false,embeddedPdb:true,name:'PortableSymbols'});
if(!c.success)throw new Error(JSON.stringify(c.diagnostics));const inspector=new AssemblyInspector(c.assembly);
await writeFile('examples/managed/PortableSymbols.dll',c.assembly);await writeFile('examples/managed/PortableSymbols.pdb',c.pdb);await writeFile('examples/managed/PortableSymbols.cs',main);
await writeFile('examples/managed/PortableSymbols.fixture.json',JSON.stringify({entryToken:[...inspector.methods.values()].find(m=>m.name==='Main').token,sourcePath:'external/ExternalProgram.cs'},null,2)+'\n');
console.log('Built PortableSymbols.dll and matching sidecar/embedded Portable PDB, without #SF metadata.');
