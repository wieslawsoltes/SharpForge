import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileOnce} from '../../oracle/roslyn-compile.js';
import {resolveToolchain,pin,requireTarget} from '../../oracle/toolchain.js';
import {runChild} from '../process.js';
import {result,failure,unsupported} from '../result.js';
import {compileSharp} from './vm.js';
import {sha256} from '../fixtures.js';
import {consoleHost} from '../host/console.js';
import {splitNativeException,isClrExceptionTermination} from './native-exception.js';
export async function executeCLR(assembly,fixture,toolchain,{signal,temporaryRoot=os.tmpdir()}={}){
  if(!(assembly instanceof Uint8Array)||!assembly.length)throw new Error('Successful DLL emission is required');
  const host=await consoleHost(toolchain,{signal});
  const directory=await mkdtemp(path.join(temporaryRoot,'sharpforge-diff-clr-'));
  try{
    await writeFile(path.join(directory,'Differential.dll'),assembly);
    const hook=path.join(directory,'SharpForge.Differential.ConsoleHost.dll');
    await writeFile(hook,host.assembly);
    await writeFile(path.join(directory,'Differential.runtimeconfig.json'),JSON.stringify({runtimeOptions:{tfm:pin.targetFramework,rollForward:'Disable',framework:{name:'Microsoft.NETCore.App',version:pin.runtime},configProperties:{'System.Globalization.Invariant':true}}}));
    const raw=await runChild(toolchain.dotnet,['exec','--runtimeconfig',path.join(directory,'Differential.runtimeconfig.json'),path.join(directory,'Differential.dll')],{cwd:directory,stdin:fixture.stdin,signal,timeoutMs:fixture.limits.timeoutMs,maxOutputBytes:fixture.limits.maxOutputBytes,env:{DOTNET_STARTUP_HOOKS:hook}});
    return {...raw,host:host.profile};
  }finally{await rm(directory,{recursive:true,force:true});}
}
export async function runCLR(kind,fixture,{toolchain,compiled,signal,sharedCompileMs,temporaryRoot}={}){
  const engine=kind==='roslyn'?'clr-roslyn':'clr-sharpforge';
  if(signal?.aborted)return failure(engine,{code:'cancelled',message:'Cancelled before compilation'});
  const target=requireTarget('coreclr');if(!target.supported)return unsupported(engine,target.reason);
  let phase='host',compileMs,assembly;
  try{
    toolchain??=await resolveToolchain();phase='compile';const at=performance.now();
    if(kind==='roslyn'){
      const output=await compileOnce({id:fixture.id,source:'Program.cs',sourceBytes:Buffer.from('\uFEFF'+fixture.sourceText),langVersion:fixture.langVersion},toolchain,{signal,timeoutMs:fixture.limits.timeoutMs,maxOutputBytes:fixture.limits.maxOutputBytes});compileMs=performance.now()-at;assembly=output.assembly;
      if(!assembly)return result(engine,{status:'compile-error',phase,exitCode:null,diagnostics:output.result.diagnostics.map(d=>({code:d.id,severity:d.severity,span:d.span})),metrics:{compileMs},toolchain:toolchain.actual});
    }else{
      const output=compiled??compileSharp(fixture);compileMs=compiled?(sharedCompileMs??0):performance.now()-at;assembly=output.assembly;
      if(!output.success)return result(engine,{status:'compile-error',phase,exitCode:null,diagnostics:output.diagnostics.map(d=>({code:d.code,severity:d.severity,message:d.message})),metrics:{compileMs},toolchain:toolchain.actual});
    }
    phase='execute';const raw=await executeCLR(assembly,fixture,toolchain,{signal,temporaryRoot});
    const {exception,exceptionDiagnostic}=splitNativeException(raw);
    const hostFailure=(raw.signal||isClrExceptionTermination(raw))&&!exception;
    return result(engine,{status:hostFailure?'host-error':exception?'runtime-error':'completed',phase,stdout:raw.stdout,stderr:raw.stderr,stdoutBase64:raw.stdoutBase64,stderrBase64:raw.stderrBase64,exitCode:exception?null:raw.exitCode,exitCodeKind:'process',exception,exceptionDiagnostic,artifactHash:sha256(assembly),host:raw.host,...(hostFailure?{error:'Native process ended without a recognisable managed exception diagnostic: signal='+raw.signal+', exitCode='+raw.exitCode}:{}),metrics:{compileMs,executeMs:raw.elapsedMs,managedAllocations:null},toolchain:toolchain.actual,environment:toolchain.environment});
  }catch(error){return {...failure(engine,error,phase),artifactHash:assembly?sha256(assembly):null,metrics:{compileMs:compileMs??null}};}
}
export const runSharpCLR=(fixture,options)=>runCLR('sharpforge',fixture,options);
export const runRoslynCLR=(fixture,options)=>runCLR('roslyn',fixture,options);
