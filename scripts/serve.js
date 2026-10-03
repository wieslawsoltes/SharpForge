import {browserCsp,connectOrigins,hostedHtml} from './conformance/security/csp.js';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(process.env.SERVE_ROOT??resolve(repo,'dist'));const port=Number(process.env.PORT??4173),host=process.env.HOST??'127.0.0.1';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
try{await stat(resolve(root,'index.html'));}catch{await import('./build.js');}
const allowedOrigins=connectOrigins(process.env.SHARPFORGE_CONNECT_ORIGINS),csp=browserCsp({allowedOrigins});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname),path=resolve(root,'.'+pathname);if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return;}let file=path;const s=await stat(file);if(s.isDirectory())file=resolve(file,'index.html');const body=await readFile(file);
let responseBody=body,responseCsp=csp;
if(extname(file)==='.html'){const result=hostedHtml(body.toString('utf8'),{allowedOrigins});responseBody=result.body;responseCsp=result.policy;}
res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':responseCsp});res.end(responseBody);
}catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}});
server.listen(port,host,()=>console.log(`SharpForge Studio: http://${host}:${port}`));
