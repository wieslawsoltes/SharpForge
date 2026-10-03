import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {serveMode} from '../../../scripts/conformance/serve-modes.js';
const fixtures=fileURLToPath(new URL('./fixtures/',import.meta.url));
function get(url){return new Promise((resolve,reject)=>{https.get(url,{rejectUnauthorized:false},res=>{let body='';res.on('data',data=>body+=data);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}).on('error',reject);});}
test('production HTTP/HTTPS proxy preserves CSP and isolates only requested mode',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sf-browser-server-'));await writeFile(join(root,'index.html'),'<h1>fixture</h1>');
 try{for(const mode of ['http','https','isolated']){const server=await serveMode({mode,root,cert:join(fixtures,'localhost-cert.pem'),key:join(fixtures,'localhost-key.pem')});try{
   const response=mode==='http'?await fetch(server.url).then(async r=>({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()})):await get(server.url);
   assert.equal(response.status,200);assert.equal(response.body,'<h1>fixture</h1>');assert.match(response.headers['content-security-policy'],/script-src 'self'/);
   assert.equal(response.headers['cross-origin-opener-policy'],mode==='isolated'?'same-origin':undefined);
   assert.equal(response.headers['cross-origin-embedder-policy'],mode==='isolated'?'require-corp':undefined);
   const missing=mode==='http'?await fetch(server.url+'/absent'):await get(server.url+'/absent');assert.equal(missing.status,404);
 }finally{await server.close();await server.close();}}}finally{await rm(root,{recursive:true,force:true});}
});
test('unknown modes, ports and missing TLS credentials are rejected',async()=>{
 for(const options of [{mode:'invalid'},{port:-1},{port:65536},{mode:'https'},{mode:'isolated'}])await assert.rejects(serveMode(options));
});
