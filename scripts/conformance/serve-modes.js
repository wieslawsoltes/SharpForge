/** Loopback HTTP/HTTPS reverse proxy around the unmodified production server. */
import {spawn} from 'node:child_process';
import {createServer as httpServer, request} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MODES = ['http', 'https', 'isolated'];
export async function serveMode({mode='http', port=0, root, cert, key}={}) {
  if (!MODES.includes(mode)) throw new Error('Unknown serving mode: '+mode);
  if (!Number.isInteger(port)||port<0||port>65535) throw new Error('Invalid port');
  if (mode!=='http'&&(!cert||!key)) throw new Error('HTTPS requires an explicit test certificate and key');
  // Production serve.js prints PORT rather than address().port, so reserve a port first.
  const reservation=httpServer(); await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
  const upstreamPort=reservation.address().port; await new Promise(r=>reservation.close(r));
  const child=spawn(process.execPath,['scripts/serve.js'],{cwd:ROOT,env:{...process.env,HOST:'127.0.0.1',PORT:String(upstreamPort),...(root?{SERVE_ROOT:resolve(root)}:{})},stdio:['ignore','pipe','pipe']});
  let logs=''; child.stderr.on('data',data=>{logs=(logs+data).slice(-8192);});
  let proxy;
  async function close() {
    if(proxy) {proxy.closeAllConnections(); await new Promise(r=>proxy.close(r));proxy=null;}
    if(child.exitCode===null && child.signalCode===null) {
      child.kill(); await new Promise(r=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);r();});});
    }
  }
  try {
    await new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(new Error('Production server startup timed out: '+logs)),15000);let out='';
      const fail=error=>{clearTimeout(timer);reject(error);};child.once('error',fail);child.once('exit',code=>fail(new Error('Production server exited '+code+': '+logs)));
      child.stdout.on('data',data=>{out+=data;if(out.includes('SharpForge Studio: ')){clearTimeout(timer);accept();}});
    });
    const handler=(req,res)=>{const forwarded=request({host:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:req.headers},up=>{
      const headers={...up.headers,...(mode==='isolated'?{'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp'}:{})};
      res.writeHead(up.statusCode,headers);up.pipe(res);
    });forwarded.on('error',()=>{res.writeHead(502);res.end('Upstream unavailable');});req.on('aborted',()=>forwarded.destroy());req.pipe(forwarded);};
    proxy=mode==='http'?httpServer(handler):httpsServer({cert:await readFile(cert),key:await readFile(key)},handler);
    await new Promise((accept,reject)=>{proxy.once('error',reject);proxy.listen(port,'127.0.0.1',accept);});
    const url=(mode==='http'?'http':'https')+'://127.0.0.1:'+proxy.address().port;
    return {url,close,upstreamPid:child.pid};
  }catch(error){await close();throw error;}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const args=process.argv.slice(2);const options={};
  for(let i=0;i<args.length;i+=2){const name=args[i].slice(2);if(!['mode','port','root','cert','key'].includes(name)||args[i+1]===undefined)throw new Error('Invalid argument '+args[i]);options[name]=name==='port'?Number(args[i+1]):args[i+1];}
  const server=await serveMode(options); console.log('SharpForge qualification: '+server.url);
  let closing=false; for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{if(closing)return;closing=true;await server.close();process.exit();});
}
