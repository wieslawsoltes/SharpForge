import {readFile,realpath} from 'node:fs/promises';
import {runChild} from '../process.js';
import {result,failure,unsupported} from '../result.js';
import {sha256} from '../fixtures.js';
import {compileSharp} from './vm.js';
/** A27 process transport; contract tests do not qualify a managed Rust runtime. */
export async function runRust(engine,fixture,{artifact,wasmHost,signal,compiled}={}){
  const wasm=engine==='rust-wasm';artifact??=process.env[wasm?'SHARPFORGE_RUST_WASM':'SHARPFORGE_RUST_NATIVE'];wasmHost??=process.env.SHARPFORGE_RUST_WASM_HOST;
  if(!artifact||wasm&&!wasmHost)return unsupported(engine,'A27 '+(wasm?'Wasm module and JSON host':'native host binary')+' artifacts have not been supplied');
  if(signal?.aborted)return failure(engine,{code:'cancelled',message:'Cancelled before A27 invocation'});
  try{
    const file=await realpath(artifact),artifactSHA256=sha256(await readFile(file)),output=compiled??compileSharp(fixture);
    if(!output.success)return result(engine,{status:'compile-error',phase:'compile',exitCode:null,diagnostics:output.diagnostics.map(d=>({code:d.code,severity:d.severity}))});
    const request={protocol:'sharpforge-differential-v1',engine,fixtureId:fixture.id,inputHash:fixture.inputHash,seed:fixture.seed,entry:fixture.entry,stdin:fixture.stdin,limits:fixture.limits,assemblyBase64:Buffer.from(output.assembly).toString('base64')};
    const command=wasm?await realpath(wasmHost):file,args=wasm?['--module',file,'--protocol',request.protocol]:['--protocol',request.protocol];
    const raw=await runChild(command,args,{stdin:JSON.stringify(request)+'\n',signal,timeoutMs:fixture.limits.timeoutMs,maxOutputBytes:Math.min(2147483647,fixture.limits.maxOutputBytes*6+65536)});
    if(raw.exitCode!==0||raw.signal)throw new Error('A27 host transport failed');const response=JSON.parse(raw.stdout);
    validateResponse(response,engine,fixture.inputHash);
    if(Buffer.byteLength(response.stdout)+Buffer.byteLength(response.stderr)>fixture.limits.maxOutputBytes)throw new Error('A27 response exceeds guest output budget');
    return result(engine,{...response,phase:'execute',artifactHash:sha256(output.assembly),adapterArtifactSHA256:artifactSHA256,adapterHostSHA256:wasm?sha256(await readFile(command)):artifactSHA256,metrics:{executeMs:raw.elapsedMs,managedAllocations:null}});
  }catch(error){if(error.code==='ENOENT')return unsupported(engine,'Configured A27 artifact is absent');return failure(engine,error);}
}

export function validateResponse(response,engine,inputHash){
  const allowed=['protocol','engine','inputHash','status','stdout','stderr','exitCode','exception'];
    if(Object.keys(response).some(k=>!allowed.includes(k))||response.protocol!=='sharpforge-differential-v1'||response.engine!==engine||response.inputHash!==inputHash||!['completed','runtime-error','budget-exceeded','unsupported'].includes(response.status)||typeof response.stdout!=='string'||typeof response.stderr!=='string'||response.exitCode!==null&&(!Number.isInteger(response.exitCode)||response.exitCode< -2147483648||response.exitCode>2147483647)||response.exception!==null&&(!response.exception||typeof response.exception.type!=='string'||typeof response.exception.message!=='string')||response.status==='completed'&&(response.exception!==null||response.exitCode===null))throw new Error('Malformed or mismatched A27 response');
  if(response.status==='runtime-error'&&(!response.exception||response.exitCode!==null))throw new Error('Runtime error requires a typed fault and null exit');
  return response;
}
