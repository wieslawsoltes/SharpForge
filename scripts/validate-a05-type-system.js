/** E04 native differential qualification. Run only after the complete epic is assembled.
 * Every CIL fixture is compiled once, then the same DLL is executed by .NET and the VM.
 * The optional casts case compares the native reflection oracle with CastCache directly.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,extname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {CastCache} from '../packages/runtime/src/execution/casting.js';
import {typePairs,nativeCastSource,castingRegistry} from '../tests/a05-type-fixtures.js';
import {qualifyAsyncAssembly} from './a05-async-qualification.js';
import {verifyNativeTargetOutcome, nativeFixtureStatus} from './a05-native-target-policy.js';
import {nativeFixtureProject} from './a05-native-project.js';
import {firstChancePolicy, probeNativeRuntime} from './a05/native-runtime-probe.js';
import {qualifyNativeSourceRoutes} from './a05/native-source-routes.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const usage=`Usage: node scripts/validate-a05-type-system.js [options]
  --fixture directory|Program.cs  Add a same-DLL .NET/CIL case (repeatable).
  --expected expected.txt        Expected stdout for the preceding fixture.
  --fault Exception              Require that System exception to escape the preceding fixture.
  --failfast                     Require CoreCLR first-chance failfast for the preceding fixture.
  --first-chance-policy policy    Explicit before-unwind (default) or after-unwind VM callback policy.
  --scheduled                    Drain cooperative tasks for the preceding fixture.
  --unsafe                       Enable unsafe C# blocks for the preceding fixture.
  --managed-varargs              Record an observed CLR varargs rejection separately from VM authored-trace qualification.
  --source-routes                Compare the exact C# input in source/reload/CIL against native output and observed ABI.
  --casts                        Include native Type.IsAssignableFrom/CastCache parity.
  --async                        Replay the same Roslyn state machine at its first two awaits.
  --output directory             Evidence directory (default artifacts/a05-type-system).
  --framework net10.0            Target framework (default installed SDK major).
  --dotnet executable            .NET executable (default DOTNET_PATH or dotnet).
With no --fixture/--casts, run all four E04 fixtures plus the casts oracle.
Directories contribute their .cs files; expected.txt is required unless overridden.
Line endings are normalized to LF; all other output bytes must match.`;
const options={fixtures:[],casts:false,async:false,output:resolve(root,'artifacts/a05-type-system'),dotnet:process.env.DOTNET_PATH??'dotnet',framework:process.env.DOTNET_TARGET_FRAMEWORK};
const arguments_=process.argv.slice(2);
for(let i=0;i<arguments_.length;i++) {
  const argument=arguments_[i];
  if(argument==='--help'){console.log(usage);process.exit(0);}
  if(argument==='--casts'){options.casts=true;continue;}
  if(argument==='--async'){options.async=true;continue;}
  if (['--scheduled', '--unsafe', '--failfast', '--managed-varargs', '--source-routes'].includes(argument)) {
    assert(options.fixtures.length, `${argument} must follow --fixture`);
    const fixture = options.fixtures.at(-1);
    if (argument === '--failfast') {
      assert(!fixture.expectedFault, '--failfast and --fault are separate outcomes');
      fixture.expectedFault = 'ExecutionEngineException';
    }
    fixture[argument.slice(2)] = true;
    continue;
  }
  if (!['--fixture', '--expected', '--fault', '--output', '--framework', '--dotnet', '--first-chance-policy'].includes(argument) ||
      !arguments_[i + 1] || arguments_[i + 1].startsWith('--')) throw new Error(usage);
  const value=arguments_[++i];
  if(argument==='--fixture')options.fixtures.push({path:resolve(value)});
  else if(argument==='--first-chance-policy') {
    assert(options.fixtures.length,'--first-chance-policy must follow --fixture');
    options.fixtures.at(-1).firstChanceFailurePolicy=firstChancePolicy(value);
  } else if(argument==='--expected') {
    assert(options.fixtures.length,'--expected must follow --fixture');
    options.fixtures.at(-1).expected=resolve(value);
  } else if(argument==='--fault') {
    assert(options.fixtures.length,'--fault must follow --fixture');
    assert(!options.fixtures.at(-1).failfast,'--failfast and --fault are separate outcomes');
    assert(/^[A-Za-z][A-Za-z0-9]*Exception$|^Exception$/.test(value),'--fault requires a System exception type name');
    options.fixtures.at(-1).expectedFault=value;
  } else options[argument.slice(2)]=argument==='--output'?resolve(value):value;
}
if(!options.fixtures.length&&!options.casts) {
  const defaults=options.async?['tests/fixtures/a05-async']:
    ['tests/fixtures/a05-static-init','tests/fixtures/a05-statics','tests/fixtures/a05/enums-strings','tests/fixtures/a05/tokens'];
  options.fixtures=defaults.map(path=>({path:join(root,path)}));
  options.casts=!options.async;
}
assert(!options.async||options.fixtures.every(fixture=>!fixture.expectedFault&&!fixture.scheduled),
  '--async replay must run separately from --fault and --scheduled fixtures');
assert(options.fixtures.every(fixture=>!fixture.firstChanceFailurePolicy||fixture.failfast),
  '--first-chance-policy requires a --failfast fixture');
assert(options.fixtures.every(fixture=>!fixture['source-routes']||
  !options.async&&!fixture.expectedFault&&!fixture.scheduled&&!fixture['managed-varargs']),
  '--source-routes requires an ordinary successful fixture');
const environment={...process.env,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'};
const normalize=text=>text.replaceAll('\r\n','\n');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const commands=[];
function execute(command,args,{cwd=root,allowFailure=false,allowSignal=false}={}) {
  const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:environment});
  commands.push({command,arguments:args,cwd,status:result.status,signal:result.signal});
  if (result.error || result.signal && !allowSignal || !allowFailure && result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || result.signal;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return {exitCode:result.status,signal:result.signal,output:normalize(result.stdout),stderr:normalize(result.stderr)};
}
const sdk=execute(options.dotnet,['--version']).output.trim(),runtimes=execute(options.dotnet,['--list-runtimes']).output.trim();
const framework=options.framework??`net${sdk.split('.')[0]}.0`;
assert(/^net\d+\.\d+$/.test(framework),'Target framework must be a value such as net10.0');
const revision=execute('git',['rev-parse','HEAD']).output.trim();
const environmentEvidence={revision,platform:process.platform,architecture:process.arch,node:process.version,dotnetSdk:sdk,dotnetRuntimes:runtimes,targetFramework:framework};
await mkdir(options.output,{recursive:true});

async function sourceFiles(path) {
  if(!(await stat(path)).isDirectory()) {
    assert.equal(extname(path),'.cs','A fixture must be a .cs source file or directory');
    return [{name:basename(path),path,bytes:await readFile(path)}];
  }
  const files=[];
  async function visit(directory,prefix='') {
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name=join(prefix,entry.name),fullPath=join(directory,entry.name);
      if(entry.isDirectory()&&!['bin','obj'].includes(entry.name))await visit(fullPath,name);
      else if(entry.isFile()&&entry.name.endsWith('.cs'))files.push({name,path:fullPath,bytes:await readFile(fullPath)});
    }
  }
  await visit(path);assert(files.length,`No C# sources in ${path}`);return files;
}

async function qualify(id,load) {
  const artifact=join(options.output,id),commandStart=commands.length;
  const report={task:'SF-A05-E04',fixture:id,timestamp:new Date().toISOString(),...environmentEvidence,passed:false,status:'failed'};
  let directory;
  await mkdir(artifact,{recursive:true});
  try {
    const fixture=await load();
    report.qualification=fixture.compare?'native .NET reflection compared with CastCache':'same Roslyn DLL executed by native .NET and CilVirtualMachine';
    report.sources=fixture.sources.map(source=>({path:source.path?relative(root,source.path):source.name,sha256:sha256(source.bytes),...(source.generatedFrom?{generatedFrom:relative(root,source.generatedFrom)}:{})}));
    report.expectedOutput=fixture.expectedOutput;
    if(fixture.expectedFault)report.expectedFault=fixture.expectedFault;
    if(fixture.failfast) {
      report.failfast=true;
      report.firstChanceFailurePolicy=firstChancePolicy(fixture.firstChanceFailurePolicy);
    }
    if(fixture.scheduled)report.scheduled=true;
    if(fixture.unsafe)report.unsafe=true;
    directory=await mkdtemp(join(tmpdir(),'sharpforge-e04-'));
    await writeFile(join(directory,'global.json'),JSON.stringify({sdk:{version:sdk,rollForward:'disable'}},null,2)+'\n');
    await writeFile(join(directory,'Qualification.csproj'),nativeFixtureProject(framework,!!fixture.unsafe));
    await writeFile(join(directory,'NuGet.Config'),'<configuration><packageSources><clear /></packageSources></configuration>\n');
    for(const source of fixture.sources){const path=join(directory,source.name);await mkdir(dirname(path),{recursive:true});await writeFile(path,source.bytes);}
    execute(options.dotnet,['restore','Qualification.csproj','--configfile','NuGet.Config','--verbosity','quiet'],{cwd:directory});
    execute(options.dotnet,['build','Qualification.csproj','--configuration','Release','--no-restore','--verbosity','quiet'],{cwd:directory});
    const assemblyPath=join(directory,'bin','Release',framework,'Qualification.dll'),assembly=await readFile(assemblyPath);
    report.assemblySha256=sha256(assembly);
    await writeFile(join(artifact,'Qualification.dll'),assembly);
    await copyFile(join(dirname(assemblyPath),'Qualification.runtimeconfig.json'),join(artifact,'Qualification.runtimeconfig.json'));
    for(const source of fixture.sources){const path=join(artifact,'source',source.name);await mkdir(dirname(path),{recursive:true});await writeFile(path,source.bytes);}
    await writeFile(join(artifact,'expected.txt'),fixture.expectedOutput);
    if(fixture.failfast||fixture.sourceRoutes) {
      report.nativeRuntime=await probeNativeRuntime({directory,assemblyPath,artifact,framework,dotnet:options.dotnet,
        execute,includePointerWidth:!!fixture.sourceRoutes});
    }
    report.native=execute(options.dotnet,[assemblyPath],{cwd:directory,allowFailure:true,allowSignal:!!fixture.expectedFault||!!fixture.managedVarargs});
    if(fixture.compare)report.castCache=await fixture.compare();
    else {
      let execution;
      if(options.async)execution=await qualifyAsyncAssembly(assembly);
      else {
        const vm=new CilVirtualMachine(assembly,{...(fixture.scheduled?{virtualTime:true}:{}),
          ...(fixture.sourceRoutes?{nativeIntBits:report.nativeRuntime.nativeIntBits}:{}),
          ...(fixture.failfast?{firstChanceFailurePolicy:report.firstChanceFailurePolicy}:{})});
        try { execution={result:fixture.scheduled?await vm.runAsync():vm.run()}; }
        finally { vm.stop(); }
      }
      const result=execution.result;if(execution.replays)report.asyncReplays=execution.replays;
      report.cil={state:result.state,exitCode:result.exitCode,output:normalize(result.output),instructions:result.stats.instructions,
        ...(result.fault?{fault:{name:result.fault.name,message:result.fault.message,fatal:result.fault.fatal===true}}:{})};
    }
    report.status=verifyNativeTargetOutcome(report,fixture.managedVarargs);
    if(fixture.sourceRoutes) {
      report.sourceRoutes=qualifyNativeSourceRoutes(fixture.sources,report.native,report.nativeRuntime.nativeIntBits);
      report.qualification='Same native source and output compared across Roslyn CIL and compiler source/reload/CIL routes';
    }
    if(report.castCache)assert.equal(report.castCache.output,report.native.output,'CastCache/native matrix');
    report.passed=report.status==='passed';
    if(report.status==='unsupported') {
      report.qualification='CLR managed varargs rejection observed; CIL independently matched the authored trace, without native parity';
    }
  } catch(error) { report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack}; }
  finally {
    const redact=value=>directory?value.replaceAll(directory,'<temporary-project>'):value;
    report.commands=commands.slice(commandStart).map(command=>({...command,cwd:redact(command.cwd),arguments:command.arguments.map(redact)}));
    if(report.error){report.error.message=redact(report.error.message);report.error.stack=redact(report.error.stack??'');}
    await writeFile(join(artifact,'qualification.json'),JSON.stringify(report,null,2)+'\n');
    if(directory)await rm(directory,{recursive:true,force:true});
  }
  console.log(`${report.status.toUpperCase()} ${id}: ${join(artifact,'qualification.json')}`);
  if(report.error)console.error(report.error.message);
  return report;
}

const reports=[],names=new Set(options.casts?['assignability']:[]);
for(const fixture of options.fixtures) {
  let id=basename(extname(fixture.path)==='.cs'?dirname(fixture.path):fixture.path),suffix=2;
  const stem=id;while(names.has(id))id=stem+'-'+suffix++;names.add(id);
  reports.push(await qualify(id,async()=>{
    const sources=await sourceFiles(fixture.path),expected=fixture.expected??join(extname(fixture.path)==='.cs'?dirname(fixture.path):fixture.path,'expected.txt');
    return {sources,expectedOutput:normalize(await readFile(expected,'utf8')),
      expectedFault:fixture.expectedFault,failfast:fixture.failfast,scheduled:fixture.scheduled,unsafe:fixture.unsafe,managedVarargs:fixture['managed-varargs'],
      firstChanceFailurePolicy:fixture.firstChanceFailurePolicy,sourceRoutes:fixture['source-routes']};
  }));
}
if(options.casts)reports.push(await qualify('assignability',async()=>{
  const fixturePath=join(root,'tests/a05-type-fixtures.js');
  return {
    sources:[{name:'Program.cs',generatedFrom:fixturePath,bytes:Buffer.from(nativeCastSource)}],
    expectedOutput:typePairs.map(([,,expected])=>expected?'True':'False').join('\n')+'\n',
    compare:()=>{const cache=new CastCache(castingRegistry());return {pairs:typePairs.length,output:typePairs.map(([source,target])=>cache.isAssignableFrom(target,source)?'True':'False').join('\n')+'\n'};}
  };
}));
const summary={
  task:'SF-A05-E04',timestamp:new Date().toISOString(),...environmentEvidence,...nativeFixtureStatus(reports),
  fixtures:reports.map(report=>({
    fixture:report.fixture,passed:report.passed,status:report.status,nativeUnsupported:report.nativeUnsupported,
    qualification:report.qualification,evidence:join(report.fixture,'qualification.json')
  }))
};
await writeFile(join(options.output,'qualification.json'),JSON.stringify(summary,null,2)+'\n');
if(summary.status==='failed')process.exitCode=1;
