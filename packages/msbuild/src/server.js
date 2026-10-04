import { createNativeServices } from './services.js';
import { createNativeApiHandler } from './api-routes.js';
import { sendNativeJson as json } from './http-json.js';
import { nativeHttpError } from './http-error.js';
import {createBrowserCsp} from '@sharpforge/network';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { NativeWorkspace } from './workspace.js';
import { NativeMSBuild } from './engine.js';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
/** Single-workspace, same-origin loopback service. Native tasks are intentionally NOT sandboxed. */
export async function startMSBuildHost({root,studioRoot=null,port=4175,connectOrigins=[],token=randomBytes(32).toString('hex'),nativeServices={},...engineOptions}={}){
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid session token');if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
 const csp=createBrowserCsp(connectOrigins);
 const workspace=await NativeWorkspace.open(root),engine=new NativeMSBuild(workspace,engineOptions),staticRoot=studioRoot?await realpath(resolve(studioRoot)):null;
 const services=createNativeServices(engine,nativeServices),api=createNativeApiHandler({engine,workspace,services});
 let origin='',closing=false;
 const server=createServer(async(req,res)=>{
  const controller=new AbortController();req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
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
    await api(req,res,url,controller.signal);return;
   }
   if(!['GET','HEAD'].includes(req.method))throw Object.assign(new Error('Method not allowed'),{status:405});
   if(!staticRoot){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('SharpForge native MSBuild host is running. Restart with --studio <SharpForge dist directory> to use the IDE.');return;}
   const name=decodeURIComponent(url.pathname),file=resolve(staticRoot,'.'+(name==='/'?'/index.html':name));if(file!==staticRoot&&!file.startsWith(staticRoot+sep))throw Object.assign(new Error('Invalid static path'),{status:403});
   const canonical=await realpath(file);if(!canonical.startsWith(staticRoot+sep))throw Object.assign(new Error('Invalid static path'),{status:403});const info=await lstat(canonical);if(!info.isFile()||info.size>128*1024*1024)throw Object.assign(new Error('Static file unavailable'),{status:404});
   res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:await readFile(canonical));
  }catch(error){if(!res.headersSent)json(res,error.status??(error.code==='ENOENT'?404:400),nativeHttpError(error));else res.end();}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxHeadersCount=64;
 await new Promise((resolveReady,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;resolveReady();});});
 return {server,workspace,engine,services:services.registry,origin,url:origin+'/#sharpforge-token='+token,token,async close(){closing=true;await services.registry.close();await engine.close();server.closeIdleConnections();await new Promise(resolveClose=>server.close(resolveClose));}};
}
