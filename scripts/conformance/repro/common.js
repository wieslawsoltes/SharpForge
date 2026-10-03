import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile, readdir, lstat, mkdtemp, rm} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const isMain = url => process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
export async function writeJSON(path, value) {await mkdir(dirname(path), {recursive:true}); await writeFile(path, json(value));}
export async function readJSON(path) {return JSON.parse(await readFile(path, 'utf8'));}
export function abortIfNeeded(signal) {if(signal?.aborted) throw signal.reason ?? new Error('Cancelled');}

// Wait for child exit before returning an error or deleting its working directory.
export async function run(command, args, {cwd, env=process.env, signal, timeout=180000, maxBytes=32*1024*1024}={}) {
  abortIfNeeded(signal);
  return new Promise((resolveRun, reject) => {
    const start=performance.now(), child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    let stdout='',stderr='',bytes=0,failure,timer,termination=Promise.resolve();
    const stop=error=>{
      if(failure)return; failure=error;
      if(!child.pid)return;
      // Kill the complete owned tree, including descendants that ignore SIGTERM.
      // A grace timer cleared on the parent's exit can leave those descendants alive.
      if(process.platform==='win32')termination=new Promise(done=>{
        const killer=spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});
        killer.on('error',()=>{child.kill('SIGKILL');done();});killer.on('close',done);
      });
      else {try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}
    };
    const cancel=()=>stop(new Error('Cancelled subprocess: '+command));
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>stop(new Error('Timed out subprocess: '+command)),timeout);
    for(const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.setEncoding('utf8').on('data',chunk=>{
      bytes+=Buffer.byteLength(chunk);if(bytes>maxBytes)return stop(new Error('Subprocess output limit exceeded'));
      if(key==='stdout')stdout+=chunk;else stderr+=chunk;
    });
    child.on('error',error=>{failure??=error;});
    child.on('close',async(code,childSignal)=>{
      clearTimeout(timer);signal?.removeEventListener('abort',cancel);await termination;
      if(failure||code!==0)reject(Object.assign(failure??new Error(`${command} ${args.join(' ')} exited ${code??childSignal}\n${stderr}\n${stdout}`),{stdout,stderr}));
      else resolveRun({stdout,stderr,milliseconds:performance.now()-start});
    });
  });
}
export async function git(root,args,options={}) {return (await run('git',['-c',`safe.directory=${resolve(root)}`,...args],{cwd:root,...options})).stdout.trim();}
export async function revision(root, ref='HEAD') {
  const commit=await git(root,['rev-parse','--verify',`${ref}^{commit}`]);
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Expected exact Git SHA-1 commit');
  return {commit,epoch:Number(await git(root,['show','-s','--format=%ct',commit]))};
}
export async function files(directory,prefix='') {
  if(!(await lstat(directory)).isDirectory())throw new Error(`Expected directory: ${directory}`);
  const result=[];
  for(const name of (await readdir(directory)).sort()){
    const path=join(directory,name),stat=await lstat(path),relative=prefix+name;
    if(stat.isSymbolicLink())throw new Error(`Symbolic link is not a release file: ${relative}`);
    if(stat.isDirectory())result.push(...await files(path,relative+'/'));
    else if(stat.isFile())result.push(relative);
    else throw new Error(`Special file is not a release file: ${relative}`);
  }
  return result;
}
export async function inventory(directory) {
  const output=[];for(const path of await files(directory)){const bytes=await readFile(join(directory,path));output.push({path,bytes:bytes.length,sha256:hash(bytes)});}return output;
}
export function differences(expected,actual) {
  const map=rows=>{const result=new Map();for(const row of rows){if(result.has(row.path))throw new Error(`Duplicate output path: ${row.path}`);result.set(row.path,row);}return result;};
  const a=map(expected),b=map(actual);
  return [...new Set([...a.keys(),...b.keys()])].sort().filter(path=>JSON.stringify(a.get(path))!==JSON.stringify(b.get(path))).map(path=>({path,expected:a.get(path)??null,actual:b.get(path)??null}));
}
export async function temporary(callback,{parent=tmpdir(),prefix='sharpforge-repro-'}={}) {
  const directory=await mkdtemp(join(parent,prefix));try{return await callback(directory);}finally{await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
export async function cli(main,{report='artifacts/results/repro/report.json'}={}) {
  const controller=new AbortController(),cancel=()=>controller.abort();
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {const result=await main(controller.signal);await writeJSON(report,result);console.log(json(result));if(result.passed===false)process.exitCode=1;}
  catch(error){await writeJSON(report,{schemaVersion:1,passed:false,error:error.message,cancelled:controller.signal.aborted,stdout:error.stdout,stderr:error.stderr});console.error(error.stack);process.exitCode=1;}
  finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
