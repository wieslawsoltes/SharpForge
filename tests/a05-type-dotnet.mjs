/** .NET reference oracle for the shared assignability matrix; run after E04 integration. */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CastCache} from '../packages/runtime/src/execution/casting.js';
import {castingRegistry,typePairs,nativeCastSource} from './a05-type-fixtures.js';
const run=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'sharpforge-type-casts-')),dotnet=process.env.DOTNET_PATH??'dotnet';
try {
  await writeFile(join(directory,'Types.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><NuGetAudit>false</NuGetAudit></PropertyGroup></Project>');
  await writeFile(join(directory,'Program.cs'),nativeCastSource);
  const options={encoding:'utf8',timeout:120000,env:{...process.env,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'}};
  await run(dotnet,['build',join(directory,'Types.csproj'),'-c','Release','--nologo','-p:RestoreIgnoreFailedSources=true'],options);
  const result=await run(dotnet,[join(directory,'bin','Release','net10.0','Types.dll')],options);
  const actual=result.stdout.trim().split(/\r?\n/);assert.equal(actual.length,typePairs.length);
  const cache=new CastCache(castingRegistry());
  for(const [index,[source,target,expected]] of typePairs.entries()) {
    assert.equal(actual[index],expected?'True':'False',source+' -> '+target+' expected table');
    assert.equal(cache.isAssignableFrom(target,source),actual[index]==='True',source+' -> '+target+' .NET parity');
  }
  console.log(JSON.stringify({pairs:typePairs.length,platform:process.platform,architecture:process.arch,passed:true}));
} finally {await rm(directory,{recursive:true,force:true});}
