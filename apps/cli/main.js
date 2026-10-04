#!/usr/bin/env node
import {NetworkPolicy} from '../../packages/network/src/index.js';
import {readPortablePdb,loadSymbols,emitPortablePdb} from '../../packages/symbols/src/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { loadDiskProject } from './project.js';
import { helpText } from './help.js';
import { readAssemblyOptions, compileDotnetAssembly, writeDotnetAssembly } from './assembly.js';
import { compile, compileToIL } from '../../packages/compiler/src/index.js';
import { VirtualMachine, CilVirtualMachine } from '../../packages/runtime/src/index.js';
import { serializeImage, deserializeImage, disassemble } from '../../packages/bytecode/src/index.js';
import { formatAssembly, createRuntimeConfig, AssemblyInspector, decompileAssembly, decompileMethod, selectMethod, formatILDocument, assembleILDocument, verifyCilAssembly } from '../../packages/cil/src/index.js';
const args=process.argv.slice(2),command=args.shift();
if(command==='msbuild'){const {runMSBuildCLI}=await import('../../packages/msbuild/src/cli.js');try{const result=await runMSBuildCLI(args);if(typeof result==='number')process.exitCode=result;}catch(error){console.error(error.message);process.exitCode=1;}}
const workspaceCommands=['templates','new','zip','unzip'];
if(workspaceCommands.includes(command)){try{await (await import('./workspace.js')).runWorkspaceCLI(command,args);}catch(error){console.error(error.message);process.exitCode=1;}}
if(command!=='msbuild'&&!workspaceCommands.includes(command)){
function option(name,fallback){const at=args.indexOf(name);if(at<0)return fallback;if(at===args.length-1||args[at+1].startsWith('-'))throw new Error(`Missing value for ${name}`);return args.splice(at,2)[1];}
function flag(name){const at=args.indexOf(name);if(at<0)return false;args.splice(at,1);return true;}
async function sources(paths){return Promise.all(paths.map(async path=>({uri:path.replaceAll('\\','/'),text:await readFile(path,'utf8')})));}
function diagnostics(result){for(const d of result.diagnostics)console.error(`${d.uri}(${d.range.start.line+1},${d.range.start.character+1}): ${d.severity} ${d.code}: ${d.message}`);}
let runtimeOptions={};
async function run(image){const vm=new VirtualMachine(image,{...runtimeOptions,onOutput:text=>process.stdout.write(text)}),execution=await vm.runAsync();if(execution.fault){console.error(`${execution.fault.name}: ${execution.fault.message}`);process.exitCode=1;}else process.exitCode=execution.exitCode;vm.stop();}
function printIR(image){for(const m of disassemble(image)){console.log('\n'+m.name);for(const i of m.instructions)console.log(`${i.offset.toString(16).padStart(4,'0')}  ${i.op.padEnd(10)} ${i.a}, ${i.b}${i.point?'  // '+i.point.uri+':'+i.point.line:''}`);}}
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
async function runManaged(bytes,options){const vm=new CilVirtualMachine(bytes,{...runtimeOptions,...options,onOutput:text=>process.stdout.write(text)}),result=await vm.runAsync();if(result.fault){console.error(`${result.fault.name}: ${result.fault.message}`);process.exitCode=1;}else{if(command==='invoke'||options.methodToken)console.log('Return: '+json(result.returnValue));process.exitCode=command==='invoke'||options.methodToken?0:result.exitCode;}vm.stop();}
try{
 const langVersion=option('--lang-version',undefined),allowedOrigins=[];while(args.includes('--allow-origin'))allowedOrigins.push(option('--allow-origin'));const computeBackend=option('--compute-backend','auto'),computeWorkers=Number(option('--compute-workers','2'));if(!['auto','wasm','scalar'].includes(computeBackend)||!Number.isInteger(computeWorkers)||computeWorkers<1||computeWorkers>8)throw new Error('Invalid compute configuration');new NetworkPolicy({allowedOrigins});runtimeOptions={network:{allowedOrigins},compute:{backend:computeBackend,workers:computeWorkers}};
 const checked=flag('--checked'),embeddedPdb=flag('--embedded-pdb'),pdbOutput=option('--pdb',undefined);
 const root=option('--root',undefined),startup=option('--project',undefined),configuration=option('--configuration','Debug'),target=option('--target','exe');if(!['exe','library'].includes(target))throw new Error('--target must be exe or library');
 const explicitOutput=args.includes('-o'),method=option('--method',undefined),hostArgsText=option('--args',undefined),hostArgs=hostArgsText===undefined?undefined:JSON.parse(hostArgsText),managedIL=flag('--managed-il'),maxInstructions=Number(option('--max-instructions','20000000'));if(hostArgs!==undefined&&!Array.isArray(hostArgs))throw new Error('--args must be a JSON array');if(!Number.isSafeInteger(maxInstructions)||maxInstructions<1)throw new Error('Invalid instruction limit');runtimeOptions.maxInstructions=maxInstructions;
 const format=option('--format','cil'),framework=option('--framework','net8'),output=option('-o',format==='ir'?'application.sfb.json':'application.dll'),name=option('--name',basename(output).replace(/\.sfb\.json$|\.dll$/i,'')),noSources=flag('--no-sources'),nativeOnly=flag('--native-only');
 if(!['cil','ir','dotnet'].includes(format))throw new Error('Format must be cil (PE/CLI), dotnet (.NET assembly) or ir (legacy JSON)');const dotnet=readAssemblyOptions(option,args,format);if(format==='dotnet'&&command!=='compile')throw new Error('--format dotnet is for compile');
 if(args.some(a=>a.startsWith('-')))throw new Error('Unknown option: '+args.find(a=>a.startsWith('-')));
 if(command==='project-info'){if(args.length!==1)throw new Error('Provide one .csproj or .slnx');const loaded=await loadDiskProject(args[0],{root,configuration,startup});console.log(json(loaded.snapshot));if(loaded.diagnostics.some(d=>d.severity==='error'))process.exitCode=1;
 }else if(command==='symbols'){if(args.length!==1)throw new Error('Provide a .pdb or managed .dll/.exe');const bytes=new Uint8Array(await readFile(args[0])),symbols=/\.pdb$/i.test(args[0])?readPortablePdb(bytes):loadSymbols(bytes,pdbOutput?new Uint8Array(await readFile(pdbOutput)):null);console.log(json({id:symbols.idHex,documents:symbols.documents.map(({embedded,...d})=>({...d,hash:[...d.hash]})),methods:symbols.methods,stateMachines:symbols.stateMachines,scopes:symbols.scopes}));
 }else if(['inspect','verify','decompile','il-export','il-assemble','invoke'].includes(command)){
  if(args.length!==1)throw new Error('Provide one managed .dll/.exe or SharpForge.IL/1 document');
  if(command==='il-assemble'){const artifact=assembleILDocument(await readFile(args[0],'utf8'));await writeFile(output,artifact.bytes);console.log(`Wrote ${output}: ${artifact.bytes.length} bytes; rebuilt ${artifact.methods} IL bodies`);for(const warning of artifact.warnings)console.error(warning);}
  else{const bytes=new Uint8Array(await readFile(args[0])),inspector=new AssemblyInspector(bytes);let text;
   if(command==='inspect')text=json(inspector.summary());
   else if(command==='verify'){const report=verifyCilAssembly(inspector,{methodToken:method,arguments:hostArgs});text=json(report);if(!report.success)process.exitCode=1;}
   else if(command==='decompile')text=method?decompileMethod(inspector,selectMethod(inspector,method,hostArgs)).source:decompileAssembly(inspector).source;
   else if(command==='il-export')text=formatILDocument(bytes);
   else await runManaged(bytes,{methodToken:method,arguments:hostArgs,maxInstructions});
   if(text!==undefined){if(explicitOutput)await writeFile(output,text);else process.stdout.write(text+'\n');}
  }
 }else if(['run','check','compile','disasm'].includes(command)){
  if(!args.length)throw new Error('Provide one or more .cs source files');
  if(command==='disasm'&&args.length===1&&/\.(dll|exe)$/i.test(args[0])){process.stdout.write(formatAssembly(new Uint8Array(await readFile(args[0]))));}
  else{
   if(command==='run'&&nativeOnly)throw new Error('--native-only assemblies omit the browser loader profile; use compile and a .NET host instead');
   const projectInput=args.length===1&&/\.(csproj|slnx)$/i.test(args[0])?await loadDiskProject(args[0],{root,configuration,startup}):null;
   if(langVersion&&projectInput)throw new Error('--lang-version is for loose files; set LangVersion in each csproj');
   if(checked&&projectInput)throw new Error('--checked is for loose source files; set CheckForOverflowUnderflow in each csproj');
   if(projectInput){console.error('Project preview: source-combined references; no MSBuild tasks, NuGet restore or separate binary linking.');for(const d of projectInput.diagnostics)console.error(`${d.path}: ${d.severity} ${d.code}: ${d.message}`);if(projectInput.diagnostics.some(d=>d.severity==='error'))throw new Error('Project evaluation failed; no output was emitted');}
   const outputKind=projectInput?.project.outputType.toLowerCase()==='library'?'library':projectInput?'exe':target,compileOptions={name:projectInput?.project.name??name,outputKind,...(projectInput?projectInput.system.compilationOptions(projectInput.project.path):{checkOverflow:checked,langVersion:langVersion??'14'})};
   const input=projectInput?.files??await sources(args),result=format==='dotnet'?compileDotnetAssembly(input,compileOptions,dotnet):command==='check'||format==='ir'?compile(input,compileOptions):compileToIL(input,{...compileOptions,framework,embedSources:!noSources,includeDebug:!nativeOnly,embeddedPdb});
   diagnostics(result);
   if(!result.success)process.exitCode=1;
   else if(format==='dotnet')console.log(await writeDotnetAssembly(result,output,outputKind));
   else if(command==='run'){if(outputKind==='library'){if(!method)throw new Error('Library has no entry point; use --method TYPE::METHOD --args JSON');if(format!=='cil')throw new Error('Library invocation requires --format cil');await runManaged(result.assembly,{methodToken:method,arguments:hostArgs,maxInstructions});}else await run(format==='cil'?result.assembly:result.image);}
   else if(command==='compile'){
    await writeFile(output,format==='cil'?result.assembly:serializeImage(result.image));if(format==='cil'&&result.pdb)await writeFile(pdbOutput??output.replace(/\.(dll|exe)$/i,'')+'.pdb',result.pdb);
    if(format==='cil'&&framework==='net8'&&outputKind!=='library'){const configPath=output.replace(/\.dll$/i,'')+'.runtimeconfig.json';await writeFile(configPath,JSON.stringify(createRuntimeConfig(),null,2)+'\n');}
    console.log(`Wrote ${output}: ${format==='cil'?result.assembly.length+' bytes ECMA-335 PE/CLI':result.metrics.instructions+' legacy IR instructions'}`);
   }else if(command==='disasm'){if(format==='cil')process.stdout.write(formatAssembly(result.assembly));else printIR(result.image);}
   else console.log(`No errors. ${result.metrics.files} files; ${result.metrics.instructions} internal instructions. IL emission was not needed for analysis.`);
  }
 }else if(command==='exec'){
  if(args.length!==1)throw new Error('Provide one .dll or legacy .sfb.json image');const bytes=new Uint8Array(await readFile(args[0]));if(bytes[0]===0x4d&&bytes[1]===0x5a){const inspector=new AssemblyInspector(bytes);if(managedIL||!inspector.metadata.streams.has('#SF'))await runManaged(bytes,{methodToken:method,arguments:hostArgs,maxInstructions});else await run(bytes);}else if(/\.il$/i.test(args[0]))await runManaged(assembleILDocument(new TextDecoder().decode(bytes)).bytes,{methodToken:method,arguments:hostArgs,maxInstructions});else await run(deserializeImage(new TextDecoder().decode(bytes)));
 }else{
  console.log(helpText);
  if(command&&command!=='help')process.exitCode=1;
 }
}catch(error){console.error(error.message);process.exitCode=1;}

}
