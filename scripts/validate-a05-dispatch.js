/** Native Roslyn/.NET differential qualification for A05 B03.
 * Compile once; execute precisely the same assembly in the installed CLR and CIL VM.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CilVirtualMachine} from '../packages/runtime/src/cil-vm.js';
import {AssemblyInspector} from '../packages/cil/src/index.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--output'))throw new Error('Usage: node scripts/validate-a05-dispatch.js [--output artifact-directory]');
const output=resolve(root,args[1]??'artifacts/a05-dispatch');
const dotnet=process.env.DOTNET_PATH??'dotnet';
const environment={...process.env,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'};
const commands=[];
function execute(command,arguments_,options={}) {
  const result=spawnSync(command,arguments_,{encoding:'utf8',timeout:120000,env:environment,...options});
  commands.push({command,arguments:arguments_,status:result.status});
  if(result.error||result.status!==0)throw new Error(`${command} ${arguments_.join(' ')} failed: ${result.error?.message??result.stderr??result.stdout}`);
  return result.stdout.replaceAll('\r\n','\n');
}
const sdk=execute(dotnet,['--version']).trim(),runtimes=execute(dotnet,['--list-runtimes']).trim();
const framework=process.env.DOTNET_TARGET_FRAMEWORK??`net${sdk.split('.')[0]}.0`;
if(!/^net\d+\.\d+$/.test(framework))throw new Error('DOTNET_TARGET_FRAMEWORK must be a target such as net10.0');
const sourcePath=join(root,'tests/fixtures/a05-dispatch/Program.cs'),source=await readFile(sourcePath);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const revision=execute('git',['rev-parse','HEAD'],{cwd:root}).trim();
const directory=await mkdtemp(join(tmpdir(),'sharpforge-dispatch-'));
let report;
try {
  await writeFile(join(directory,'global.json'),JSON.stringify({sdk:{version:sdk,rollForward:'disable'}})+'\n');
  await writeFile(join(directory,'VirtualDispatch.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>${framework}</TargetFramework><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable><DebugType>none</DebugType><Deterministic>true</Deterministic></PropertyGroup></Project>\n`);
  await copyFile(sourcePath,join(directory,'Program.cs'));
  await writeFile(join(directory,'NuGet.Config'),'<configuration><packageSources><clear /></packageSources></configuration>\n');
  execute(dotnet,['restore','VirtualDispatch.csproj','--configfile','NuGet.Config','--verbosity','quiet'],{cwd:directory});
  execute(dotnet,['build','VirtualDispatch.csproj','--configuration','Release','--no-restore','--verbosity','quiet'],{cwd:directory});
  const assemblyPath=join(directory,'bin','Release',framework,'VirtualDispatch.dll'),assembly=await readFile(assemblyPath);
  const nativeOutput=execute(dotnet,[assemblyPath],{cwd:directory}),expectedOutput='1\n3\n3\n7\n';
  const vm=new CilVirtualMachine(assembly),result=vm.run(),inspector=new AssemblyInspector(assembly);
  assert.equal(nativeOutput,expectedOutput,'Roslyn/.NET reference output');
  assert.equal(result.state,'terminated',result.fault?.stack);
  assert.equal(result.exitCode,0);
  assert.equal(result.output,nativeOutput,'The CIL VM must execute the same Roslyn DLL as .NET');
  const methods=[...inspector.methods.values()];
  assert(methods.some(method=>method.owner==='B'&&method.name==='F'&&(method.flags&0x100)),'Roslyn fixture must contain a newslot declaration');
  assert(methods.some(method=>method.owner==='C'&&method.name==='F'&&!(method.flags&0x100)),'Roslyn fixture must contain a reuse-slot override');
  assert((inspector.metadata.rows[25]?.length??0)>0,'Roslyn fixture must contain an explicit MethodImpl');
  await mkdir(output,{recursive:true});
  await writeFile(join(output,'VirtualDispatch.dll'),assembly);
  await copyFile(join(dirname(assemblyPath),'VirtualDispatch.runtimeconfig.json'),join(output,'VirtualDispatch.runtimeconfig.json'));
  report={
    task:'SF-A05-B03',timestamp:new Date().toISOString(),revision,
    qualification:'Roslyn-compiled assembly executed by native .NET and directly by CilVirtualMachine',
    platform:process.platform,architecture:process.arch,node:process.version,dotnetSdk:sdk,dotnetRuntimes:runtimes,targetFramework:framework,
    source:'tests/fixtures/a05-dispatch/Program.cs',sourceSha256:sha256(source),assemblySha256:sha256(assembly),
    fixtureEvidence:{newslot:'B::F',override:'C::F',methodImplRows:inspector.metadata.rows[25].length},
    native:{state:'terminated',exitCode:0,output:nativeOutput},cil:{state:result.state,exitCode:result.exitCode,output:result.output,instructions:result.stats.instructions},
    expectedOutput,passed:true,
    commands:commands.map(command=>({...command,arguments:command.arguments.map(argument=>argument.replaceAll(directory,'<temporary-project>'))}))
  };
  await writeFile(join(output,'qualification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS A05 B03: native .NET and CIL outputs match (${JSON.stringify(nativeOutput)})`);
  console.log(`Evidence: ${join(output,'qualification.json')}`);
} finally {await rm(directory,{recursive:true,force:true});}
