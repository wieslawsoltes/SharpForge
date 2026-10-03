import {spawn} from 'node:child_process';
export function execute(command,argv,{cwd,env=process.env,timeoutMs=120000,signal,maxOutputBytes=16*1024*1024}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new Error('Invalid timeout');
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(command,argv,{cwd,env,shell:false,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  let stdout='',stderr='',size=0,stopError=null,killTimer;
  const kill=()=>{try{if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});else process.kill(-child.pid,'SIGKILL');}catch{}};
  const stop=error=>{if(stopError)return;stopError=error;try{if(process.platform==='win32')kill();else process.kill(-child.pid,'SIGTERM');}catch{}killTimer=setTimeout(kill,500);};
  const abort=()=>stop(Object.assign(new Error('Performance execution cancelled'),{code:'ABORT_ERR'}));
  const timer=setTimeout(()=>stop(Object.assign(new Error('Performance execution timed out'),{code:'TIMEOUT'})),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
  for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',chunk=>{size+=chunk.length;if(size>maxOutputBytes)stop(new Error('Performance output limit exceeded'));else if(name==='stdout')stdout+=chunk;else stderr+=chunk;});
  child.on('error',error=>{cleanup();reject(error);});
  child.on('close',(code,killed)=>{cleanup();if(stopError)reject(stopError);else if(code!==0)reject(Object.assign(new Error(command+' failed ('+code+'): '+stderr),{code:'PROCESS_FAILED',stdout,stderr,exitCode:code,signal:killed}));else resolve({stdout,stderr});});
 });
}
