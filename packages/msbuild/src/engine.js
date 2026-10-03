import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { normalizeBuildRequest, escapeMSBuild, parseDiagnosticLine, parseEvaluationOutput } from './contract.js';

export function createInvocation(request,{projectPath,jobDirectory,executable='dotnet',engine='dotnet'}={}){
 const r=normalizeBuildRequest(request),args=engine==='dotnet'?['msbuild']:[];
 args.push(projectPath??r.project,'-nologo','-v:'+r.verbosity,'-m:'+r.maxNodes);
 for(const [name,value]of Object.entries(r.properties))args.push('-p:'+name+'='+escapeMSBuild(value));
 if(r.graphBuild)args.push('-graphBuild');if(r.restore&&!['restore','evaluate','preprocess','targets','clean'].includes(r.action))args.push('-restore');
 const target={build:'Build',rebuild:'Rebuild',clean:'Clean',restore:'Restore',pack:'Pack',publish:'Publish',test:'VSTest'}[r.action];
 if(target)args.push('-t:'+target);else if(r.action==='target')args.push('-t:'+r.targets.join(';'));
 if(r.action==='evaluate'){
  // Always query at least two properties so even a single requested property returns JSON.
  const names=[...new Set([...r.propertyNames,'MSBuildProjectFullPath','MSBuildVersion'])];args.push('-getProperty:'+names.join(','));if(r.itemNames.length)args.push('-getItem:'+r.itemNames.join(','));
 }
 if(r.resultTargets.length)args.push('-getTargetResult:'+r.resultTargets.join(';'));
 if(r.action==='preprocess')args.push('-preprocess:'+join(jobDirectory,'expanded.xml'));
 if(r.action==='targets')args.push('-targets:'+join(jobDirectory,'targets.txt'));
 if(r.binaryLog)args.push('-binaryLogger:'+join(jobDirectory,'build.binlog')+';ProjectImports=None');
 args.push(...r.arguments,'-nodeReuse:false');
 return {executable,args,request:r};
}
function killTree(child,force=false){
 if(!child?.pid)return;
 if(process.platform==='win32'){const killer=spawn('taskkill',['/PID',String(child.pid),'/T',...(force?['/F']:[])],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{try{child.kill();}catch{}});}
 else {try{process.kill(-child.pid,force?'SIGKILL':'SIGTERM');}catch{try{child.kill(force?'SIGKILL':'SIGTERM');}catch{}}}
}
export class NativeMSBuild {
 constructor(workspace,{executable='dotnet',engine='dotnet',trusted=false,timeoutMs=30*60*1000,maxOutputBytes=32*1024*1024,maxJobs=32,spawnProcess=spawn}={}){
  if(!['dotnet','msbuild'].includes(engine))throw new Error('Engine must be dotnet or msbuild');
  if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>24*60*60*1000)throw new Error('Invalid build timeout');
  if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>256)throw new Error('Job retention limit must be 1–256');if(!Number.isInteger(maxOutputBytes)||maxOutputBytes<1024||maxOutputBytes>256*1024*1024)throw new Error('Output limit must be 1 KiB–256 MiB');
  this.workspace=workspace;this.executable=executable;this.engine=engine;this.trusted=trusted;this.timeoutMs=timeoutMs;this.maxOutputBytes=maxOutputBytes;this.maxJobs=maxJobs;this.spawnProcess=spawnProcess;this.jobs=new Map();this.active=null;this.starting=false;this.closed=false;
 }
 async probe(){
  return new Promise(resolveResult=>{let output='',done=false;const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolveResult(result);};let child;
   try{child=this.spawnProcess(this.executable,[...(this.engine==='dotnet'?['msbuild']:[]),'-version','-nologo'],{cwd:this.workspace.root,env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'},shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});}catch(e){resolveResult({available:false,error:e.message});return;}
   const timer=setTimeout(()=>{killTree(child,true);finish({available:false,error:'MSBuild version probe timed out'});},15000);
   for(const stream of [child.stdout,child.stderr])stream?.on('data',bytes=>{if(output.length<65536)output+=bytes.toString();else killTree(child,true);});
   child.once('error',e=>finish({available:false,error:`${this.executable}: ${e.message}. Install a .NET SDK or select an installed MSBuild executable.`}));child.once('close',code=>finish({available:code===0,version:output.trim(),error:code===0?undefined:output.trim()||'MSBuild version probe failed'}));
  });
 }
 async start(input){
  if(this.closed)throw new Error('MSBuild host is closing');
  const request=normalizeBuildRequest(input);if(!this.trusted||!request.trusted)throw Object.assign(new Error('Native MSBuild requires --trust-projects on the host and explicit workspace trust in the client. Evaluation and custom tasks can execute local code.'),{status:403});
  if(this.active||this.starting)throw Object.assign(new Error('A native operation is already running'),{status:409});this.starting=true;
  try{
   for(const arg of request.arguments)if(arg.startsWith('@'))await this.workspace.path(arg.slice(1));
   const projectPath=await this.workspace.path(request.project);if(!(await lstat(projectPath)).isFile())throw new Error('Project is not a file');
   const id=randomUUID(),directory=await this.workspace.jobDirectory(id);if(this.closed)throw new Error('MSBuild host is closing');const invocation=createInvocation(request,{projectPath,jobDirectory:directory,executable:this.executable,engine:this.engine});
   while(this.jobs.size>=this.maxJobs){const oldest=[...this.jobs].find(([,job])=>!['running','cancelling'].includes(job.status));if(!oldest)throw new Error('Job retention limit reached');this.jobs.delete(oldest[0]);}
   let finish;const job={id,request,status:'running',started:new Date().toISOString(),ended:null,exitCode:null,signal:null,events:[],nextCursor:1,logBytes:0,totalBytes:0,truncated:false,diagnostics:[],diagnosticKeys:new Set(),invocation:{executable:invocation.executable,arguments:invocation.args},artifacts:[],result:null,error:null,directory,output:'',child:null,promise:new Promise(r=>finish=r)};
   this.jobs.set(id,job);this.active=id;
   let child;try{child=this.spawnProcess(invocation.executable,invocation.args,{cwd:this.workspace.root,env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1',DOTNET_CLI_UI_LANGUAGE:'en',VSLANG:'1033',MSBUILDENSURESTDOUTFORTASKPROCESSES:'1'},shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});}catch(error){job.error=error.message;job.status='failed';job.ended=new Date().toISOString();this.active=null;finish(job);return this.snapshot(id);}
   job.child=child;const decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')},tails={stdout:'',stderr:''};let finalized=false;
   const consume=(stream,text)=>{
    if(!text)return;const bytes=Buffer.byteLength(text);job.totalBytes+=bytes;
    if(job.totalBytes>this.maxOutputBytes){if(!job.error){job.error='MSBuild output limit exceeded';this.cancel(id,'output-limit');}return;}
    job.output+=text;job.events.push({cursor:job.nextCursor++,stream,text});job.logBytes+=bytes;
    while(job.logBytes>1024*1024&&job.events.length>1){job.logBytes-=Buffer.byteLength(job.events.shift().text);job.truncated=true;}
    tails[stream]+=text;const lines=tails[stream].split(/\r?\n/);tails[stream]=lines.pop();if(tails[stream].length>65536)tails[stream]=tails[stream].slice(-65536);
    for(const line of lines)this.diagnostic(job,line);
   };
   for(const stream of ['stdout','stderr'])child[stream]?.on('data',bytes=>consume(stream,decoders[stream].write(bytes)));
   const timer=setTimeout(()=>{job.error='MSBuild operation timed out';this.cancel(id,'timeout');},this.timeoutMs);timer.unref?.();
   const finalize=async(code,signal)=>{if(finalized)return;finalized=true;clearTimeout(timer);for(const stream of ['stdout','stderr']){consume(stream,decoders[stream].end());this.diagnostic(job,tails[stream]);}
    job.exitCode=code;job.signal=signal;let completedStatus=job.cancelReason?'cancelled':code===0&&!job.error?'succeeded':'failed';
    try{
     await writeFile(join(directory,'output.log'),job.output,{mode:0o600});
     if(completedStatus==='succeeded'&&(request.action==='evaluate'||request.resultTargets.length))try{job.result=parseEvaluationOutput(job.output);}catch(error){job.error=error.message;completedStatus='failed';}
     for(const name of ['output.log','expanded.xml','targets.txt','build.binlog']){try{const file=join(directory,name),info=await lstat(file);if(info.isFile()&&!info.isSymbolicLink()&&info.size<=this.workspace.maxArtifactBytes){const path=this.workspace.relative(file);job.artifacts.push({path,size:info.size,kind:name==='build.binlog'?'binlog':name==='expanded.xml'?'preprocessed':name==='targets.txt'?'targets':'log'});if(['expanded.xml','targets.txt'].includes(name)&&info.size<=2*1024*1024)job.result={...(job.result??{}),[name==='targets.txt'?'targetsText':'preprocessedText']:await readFile(file,'utf8')};}}catch{/* A failed build may produce no artifact. */}}
     if(!['evaluate','preprocess','targets'].includes(request.action)&&completedStatus==='succeeded'){
      let projects=[request.project];if(/\.slnx?$/i.test(request.project))projects=(await this.workspace.scan()).projects;
      for(const project of projects){if(job.artifacts.length>=2048)break;for(const file of await this.workspace.outputs(project))if(job.artifacts.length<2048&&!job.artifacts.some(a=>a.path===file.path))job.artifacts.push({...file,kind:'output'});}
     }
     const outputPaths=[job.result?.Properties?.TargetPath,...Object.values(job.result?.TargetResults??{}).flatMap(r=>(r.Items??[]).map(i=>i.FullPath??i.Identity))].filter(x=>typeof x==='string'&&/\.(dll|exe|pdb|nupkg|snupkg)$/i.test(x)).slice(0,512);
     for(const path of outputPaths){try{const file=isAbsolute(path)?path:resolve(dirname(projectPath),path),relative=this.workspace.relative(file);if(!relative||job.artifacts.some(a=>a.path===relative))continue;const info=await lstat(await this.workspace.path(relative));if(info.isFile()&&info.size<=this.workspace.maxArtifactBytes)job.artifacts.push({path:relative,size:info.size,modified:info.mtime.toISOString(),kind:'evaluated-output'});}catch{/* Missing/external output paths remain visible in evaluated properties, not downloadable. */}}
    }catch(error){job.error=job.error??error.message;if(completedStatus==='succeeded')completedStatus='failed';}
    job.status=job.cancelReason?'cancelled':completedStatus;job.ended=new Date().toISOString();job.output='';job.child=null;if(this.active===id)this.active=null;finish(job);
   };
   child.once('error',error=>{job.error=`Unable to run ${this.executable}: ${error.message}. Native builds require an installed SDK/MSBuild; the browser compiler is not substituted.`;finalize(null,null);});child.once('close',finalize);
   return this.snapshot(id);
  }finally{this.starting=false;}
 }
 diagnostic(job,line){const d=parseDiagnosticLine(line);if(!d||job.diagnostics.length>=10000)return;const key=JSON.stringify(d);if(!job.diagnosticKeys.has(key)){job.diagnosticKeys.add(key);if(d.file){
   // CSC paths are relative to the emitting project, not the loopback host's cwd.
   // Project-level diagnostics and fully qualified compiler paths retain their location.
   const root=this.workspace.root,file=d.file.replaceAll('\\','/'),project=(d.project??job.request?.project??'').replace(/(::| \[).*$/,'').replaceAll('\\','/');
   const projectPath=project?resolve(root,project):null,projectFolder=projectPath?this.workspace.relative(dirname(projectPath)):null;
   const full=isAbsolute(file)?file:projectPath&&projectPath.replaceAll('\\','/').endsWith('/'+file)&&!file.includes('/')?projectPath:projectFolder&&file.startsWith(projectFolder+'/')?resolve(root,file):resolve(projectPath?dirname(projectPath):root,file);
   d.workspacePath=this.workspace.relative(full);
  }job.diagnostics.push(d);}}
 snapshot(id,after=0){const job=this.jobs.get(id);if(!job)throw Object.assign(new Error('Unknown or expired MSBuild job'),{status:404});if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid log cursor');return {id:job.id,status:job.status,request:job.request,started:job.started,ended:job.ended,exitCode:job.exitCode,signal:job.signal,error:job.error,cancelReason:job.cancelReason??null,invocation:job.invocation,events:job.events.filter(e=>e.cursor>after),nextCursor:job.nextCursor-1,truncated:job.truncated&&after<(job.events[0]?.cursor??0)-1,diagnostics:job.diagnostics,artifacts:job.artifacts,result:job.result,totalOutputBytes:job.totalBytes};}
 async wait(id){const job=this.jobs.get(id);if(!job)throw new Error('Unknown MSBuild job');await job.promise;return this.snapshot(id);}
 cancel(id,reason='user'){
  const job=this.jobs.get(id);if(!job)throw Object.assign(new Error('Unknown MSBuild job'),{status:404});if(!['running','cancelling'].includes(job.status))return this.snapshot(id);
  if(!job.cancelReason){job.cancelReason=reason;job.status='cancelling';killTree(job.child);const child=job.child;const force=setTimeout(()=>killTree(child,true),750);force.unref?.();}
  return this.snapshot(id);
 }
 async artifact(id,path){const job=this.jobs.get(id);if(!job||!job.artifacts.some(a=>a.path===path))throw Object.assign(new Error('Artifact was not listed for this job'),{status:404});return this.workspace.artifact(path);}
 async close(){this.closed=true;if(this.active){const id=this.active;this.cancel(id,'host-shutdown');await this.wait(id);}}
}
