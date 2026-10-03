/** Explicit local demo endpoint; never started by importing a project. No remote proxy. */
import http from 'node:http';
const server=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');if(req.method==='GET'&&req.url==='/data'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:'Local endpoint reached',answer:42}));}else{res.statusCode=404;res.end('Not found');}});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});server.listen(8787,'127.0.0.1',()=>console.log('Local sample endpoint http://127.0.0.1:8787/data — Ctrl+C to stop. Grant this exact origin in SharpForge.'));
