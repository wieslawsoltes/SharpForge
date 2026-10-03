/** Independent .NET 10/Roslyn oracle. Run only after the complete E01 scope is assembled. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {compile,compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {nativeScalarSource,scalarOracleOutput,sourceScalarCases,decimalCases,decimalFloatCases,decimalRoundingCases} from '../tests/a05-01-fixtures.js';

const run=promisify(execFile),dotnet=process.env.DOTNET_PATH??'dotnet',directory=await mkdtemp(join(tmpdir(),'sharpforge-a05-scalars-'));
const options={encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'}};
const normalize=text=>text.replaceAll('\r\n','\n');
const sdk=await run(dotnet,['--version'],options),runtimeInfo=await run(dotnet,['--info'],options);
const commit=(await run('git',['rev-parse','HEAD'],{...options,cwd:new URL('..',import.meta.url)})).stdout.trim();
assert(/^10\./.test(sdk.stdout.trim()),'This fixture pins the .NET 10 SDK; another SDK is not native qualification.');
try {
  await writeFile(join(directory,'Scalars.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><NuGetAudit>false</NuGetAudit><Optimize>false</Optimize><CheckForOverflowUnderflow>false</CheckForOverflowUnderflow></PropertyGroup></Project>');
  const project=join(directory,'Scalars.csproj'),assembly=join(directory,'bin','Release','net10.0','Scalars.dll');
  const build=async source=>{await writeFile(join(directory,'Program.cs'),source);await run(dotnet,['build',project,'-c','Release','--nologo','-p:RestoreIgnoreFailedSources=true'],options);return new Uint8Array(await readFile(assembly));};
  // The actual process reports pointer width; emulated 32-bit JS runs never count
  // as a second native architecture qualification.
  await build('using System;class P{static void Main(){Console.WriteLine(IntPtr.Size);}}');
  const pointerSize=Number((await run(dotnet,[assembly],options)).stdout.trim()),nativeIntBits=pointerSize*8;
  assert([32,64].includes(nativeIntBits));
  const oracleBytes=await build(nativeScalarSource),native=normalize((await run(dotnet,[assembly],options)).stdout),expected=scalarOracleOutput(nativeIntBits);
  assert.equal(native,expected,'Live .NET Decimal bit patterns and IEEE/native integer results');
  const interpreted=new CilVirtualMachine(oracleBytes,{nativeIntBits}).run();
  assert.equal(interpreted.state,'terminated',interpreted.fault?.stack);assert.equal(interpreted.output,native,'Same Roslyn DLL in direct CIL');
  const cases=[];
  for(const fixture of sourceScalarCases) {
    const bytes=await build('using System;class P{static void Main(){'+fixture.source+'}}');
    const nativeOutput=normalize((await run(dotnet,[assembly],options)).stdout);assert.equal(nativeOutput,fixture.output,fixture.name+' native expected');
    const source=compile(fixture.source),cil=compileToIL(fixture.source);assert(source.success,JSON.stringify(source.diagnostics));assert(cil.success,JSON.stringify(cil.diagnostics));
    for(const [name,vm] of [['source',new VirtualMachine(source.image,{nativeIntBits})],['emitted-cil',new CilVirtualMachine(cil.assembly,{nativeIntBits})],['roslyn-cil',new CilVirtualMachine(bytes,{nativeIntBits})]]) {
      const result=vm.run();assert.equal(result.state,'terminated',fixture.name+' '+name+': '+result.fault?.stack);assert.equal(result.output,nativeOutput,fixture.name+' '+name);
    }
    cases.push(fixture.name);
  }
  const report={passed:true,commit,node:process.version,sdk:sdk.stdout.trim(),runtimeInfo:runtimeInfo.stdout,platform:process.platform,architecture:process.arch,nativeIntBits,decimalBitCases:decimalCases.length+decimalFloatCases.length+decimalRoundingCases.length,crossEngineCases:cases,oracleSourceSha256:createHash('sha256').update(nativeScalarSource).digest('hex'),oracleSha256:createHash('sha256').update(oracleBytes).digest('hex'),unqualifiedNativeWidths:[32,64].filter(bits=>bits!==nativeIntBits)};
  if(process.env.A05_SCALAR_REPORT)await writeFile(process.env.A05_SCALAR_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await rm(directory,{recursive:true,force:true});}
