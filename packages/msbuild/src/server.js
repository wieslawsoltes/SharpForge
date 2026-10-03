import {createBrowserCsp} from '@sharpforge/network';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { NativeWorkspace } from './workspace.js';
import { NativeMSBuild } from './engine.js';
import { MSBUILD_PROTOCOL_VERSION, BUILD_ACTIONS } from './contract.js';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
async function readJSON(req){if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw Object.assign(new Error('Use application/json for API mutations'),{status:415});let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>34*1024*1024)throw Object.assign(new Error('Request size limit exceeded'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Invalid request JSON');}}
/** Single-workspace, same-origin loopback service. Native tasks are intentionally NOT sandboxed. */
export async function startMSBuildHost({root,studioRoot=null,port=4175,connectOrigins=[],token=randomBytes(32).toString('hex'),...engineOptions}={}){
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid session token');if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
 const csp=createBrowserCsp(connectOrigins);
 const workspace=await NativeWorkspace.open(root),engine=new NativeMSBuild(workspace,engineOptions),staticRoot=studioRoot?await realpath(resolve(studioRoot)):null;
 let origin='',capabilities=null,closing=false,saving=false;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',csp);
  try{
   if(closing)throw Object.assign(new Error('Host is shutting down'),{status:503});
   // Check the raw Host value, not a DNS-resolved name (DNS-rebinding defense).
   if(req.headers.host!==new URL(origin).host)throw Object.assign(new Error('Invalid Host header'),{status:403});
   if(req.headers.origin&&req.headers.origin!==origin)throw Object.assign(new Error('Cross-origin requests are not accepted'),{status:403});
   if(['cross-site','same-site'].includes(req.headers['sec-fetch-site']))throw Object.assign(new Error('Cross-site requests are not accepted'),{status:403});
   const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/api/')){
    const auth=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);if(auth.length!==expected.length||!timingSafeEqual(auth,expected))throw Object.assign(new Error('A valid in-memory session token is required'),{status:401});
    const path=url.pathname.replace(/^\/api\/msbuild/,'');
    if(req.method==='GET'&&path==='/capabilities'){
     // A version probe does not load or evaluate any user project.
     capabilities??=engine.probe().catch(error=>({available:false,error:error.message}));
     json(res,200,{protocolVersion:MSBUILD_PROTOCOL_VERSION,engine:engine.engine,executable:engine.executable,trusted:engine.trusted,root:workspace.root,actions:BUILD_ACTIONS,...await capabilities});return;
    }
    if(req.method==='GET'&&path==='/workspace'){json(res,200,await workspace.scan());return;}
    if(req.method==='GET'&&path==='/file'){json(res,200,await workspace.read(url.searchParams.get('path')));return;}
    if(req.method==='GET'&&path==='/item'){json(res,200,await workspace.inspectItem(url.searchParams.get('path')));return;}
    if(req.method==='GET'&&path==='/binary'){const name=url.searchParams.get('path');if(!/\.(dll|exe)$/i.test(name??''))throw new Error('Only managed DLL/EXE file inspection is supported');const file=await workspace.path(name),info=await lstat(file);if(!info.isFile()||info.size>workspace.maxArtifactBytes)throw new Error('Assembly size limit exceeded');const bytes=await readFile(file);if(bytes.length>workspace.maxArtifactBytes)throw new Error('Assembly size limit exceeded');res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(bytes);return;}
    if(req.method==='POST'&&(path==='/mutations'||path==='/undo-mutation')){if(engine.active||engine.starting||saving)throw Object.assign(new Error('Stop the native operation before changing workspace files'),{status:409});saving=true;try{const input=await readJSON(req);json(res,200,path==='/mutations'?await workspace.mutate(input.operations):await workspace.undoMutation(input.token));}finally{saving=false;}return;}
    if(req.method==='POST'&&path==='/files'){if(engine.active||engine.starting||saving)throw Object.assign(new Error('Stop the native operation before saving project inputs'),{status:409});saving=true;try{json(res,200,await workspace.save((await readJSON(req)).changes));}finally{saving=false;}return;}
    if(req.method==='POST'&&path==='/jobs'){if(saving)throw Object.assign(new Error('A disk save is in progress'),{status:409});json(res,202,await engine.start(await readJSON(req)));return;}
    const match=/^\/jobs\/([a-f0-9-]{36})(?:\/(cancel|artifact))?$/.exec(path);
    if(match){const [,id,action]=match;
     if(req.method==='GET'&&!action){const after=url.searchParams.get('after')??'0';if(!/^\d+$/.test(after))throw new Error('Invalid log cursor');json(res,200,engine.snapshot(id,Number(after)));return;}
     if(req.method==='POST'&&action==='cancel'){await readJSON(req);json(res,200,engine.cancel(id));return;}
     if(req.method==='GET'&&action==='artifact'){const path=url.searchParams.get('path'),bytes=await engine.artifact(id,path);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1))}`});res.end(bytes);return;}
    }
    throw Object.assign(new Error('Unknown MSBuild API route'),{status:404});
   }
   if(!['GET','HEAD'].includes(req.method))throw Object.assign(new Error('Method not allowed'),{status:405});
   if(!staticRoot){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('SharpForge native MSBuild host is running. Restart with --studio <SharpForge dist directory> to use the IDE.');return;}
   const name=decodeURIComponent(url.pathname),file=resolve(staticRoot,'.'+(name==='/'?'/index.html':name));if(file!==staticRoot&&!file.startsWith(staticRoot+sep))throw Object.assign(new Error('Invalid static path'),{status:403});
   const canonical=await realpath(file);if(!canonical.startsWith(staticRoot+sep))throw Object.assign(new Error('Invalid static path'),{status:403});const info=await lstat(canonical);if(!info.isFile()||info.size>128*1024*1024)throw Object.assign(new Error('Static file unavailable'),{status:404});
   res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:await readFile(canonical));
  }catch(error){if(!res.headersSent)json(res,error.status??(error.code==='ENOENT'?404:400),{error:error.message,...(error.written?{written:error.written}:{}),...(error.completed?{completed:error.completed,undoToken:error.undoToken}:{})});else res.end();}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxHeadersCount=64;
 await new Promise((resolveReady,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;resolveReady();});});
 return {server,workspace,engine,origin,url:origin+'/#sharpforge-token='+token,token,async close(){closing=true;await engine.close();server.closeIdleConnections();await new Promise(resolveClose=>server.close(resolveClose));}};
}
