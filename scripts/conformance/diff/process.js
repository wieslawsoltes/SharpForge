import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
export class ProcessFailure extends Error{constructor(code,message,result){super(message);this.name='ProcessFailure';this.code=code;this.result=result;}}
/** Bounded native child: stdin is literal bytes, every exit reaps before completion. */
export function runChild(command,args,{cwd,env={},stdin='',signal,timeoutMs=10000,maxOutputBytes=65536}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<1)throw new RangeError('Positive process budgets required');
  if(signal?.aborted)return Promise.reject(new ProcessFailure('cancelled','Cancelled before process launch'));
  return new Promise((resolve,reject)=>{
    const start=performance.now(),child=spawn(command,args,{cwd,windowsHide:true,shell:false,env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1',DOTNET_CLI_UI_LANGUAGE:'en-US',VSLANG:'1033',DOTNET_ROLL_FORWARD:'Disable',DOTNET_ROLL_FORWARD_TO_PRERELEASE:'0',COMPlus_DbgEnableMiniDump:'0',...env},stdio:['pipe','pipe','pipe']});
    const chunks={stdout:[],stderr:[]};let bytes=0,failure,force;
    const stop=(code,message)=>{failure??=new ProcessFailure(code,message);child.kill('SIGTERM');force??=setTimeout(()=>child.kill('SIGKILL'),250);};
    const abort=()=>stop('cancelled','Process cancelled');signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>stop('budget-exceeded','Process time budget exceeded'),timeoutMs);
    for(const stream of ['stdout','stderr'])child[stream].on('data',data=>{bytes+=data.length;if(bytes>maxOutputBytes)stop('budget-exceeded','Process output budget exceeded');else chunks[stream].push(data);});
    child.on('error',error=>{failure??=new ProcessFailure('host-error',error.message);});child.stdin.on('error',error=>{if(error.code!=='EPIPE')stop('host-error',error.message);});child.stdin.end(stdin);
    child.on('close',(exitCode,exitSignal)=>{clearTimeout(timer);clearTimeout(force);signal?.removeEventListener('abort',abort);const result={stdout:Buffer.concat(chunks.stdout).toString('utf8'),stderr:Buffer.concat(chunks.stderr).toString('utf8'),exitCode,signal:exitSignal,elapsedMs:performance.now()-start};if(failure){failure.result=result;reject(failure);}else resolve(result);});
    if(signal?.aborted)abort();
  });
}
