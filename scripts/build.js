import { mkdir, rm, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorker } from './bundle-worker.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
await cp(resolve(root,'apps/studio'),dist,{recursive:true});await cp(resolve(root,'examples'),resolve(dist,'examples'),{recursive:true});await cp(resolve(root,'LICENSE'),resolve(dist,'LICENSE'));await cp(resolve(root,'THIRD_PARTY_NOTICES.md'),resolve(dist,'THIRD_PARTY_NOTICES.md'));await cp(resolve(root,'packages'),resolve(dist,'packages'),{recursive:true});await cp(resolve(root,'docs'),resolve(dist,'docs'),{recursive:true});
async function rewrite(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isDirectory())await rewrite(path);else if(entry.name.endsWith('.js')){let text=await readFile(path,'utf8');if(dirname(path)===dist)text=text.replaceAll("'../../packages/","'./packages/");text=text.replace(/(['"])@sharpforge\/([\w-]+)\1/g,(_,quote,name)=>{let target=relative(dirname(path),resolve(dist,'packages',name,'src/index.js')).split(sep).join('/');if(!target.startsWith('.'))target='./'+target;return quote+target+quote;});await writeFile(path,text);}}}
await rewrite(dist);
const styles=['apps/studio/studio.css','packages/editor/src/vendor/classic.css','packages/editor/src/editor.css','packages/controls/src/controls.css','apps/studio/release08.css','apps/studio/release09.css','packages/winui/src/style.css','apps/studio/release10.css','apps/studio/release11.css','apps/studio/release12.css','apps/studio/release13.css','apps/studio/release14.css'];
await writeFile(resolve(dist,'studio.css'),(await Promise.all(styles.map(path=>readFile(resolve(root,path),'utf8')))).join('\n'));

for (const name of ['compiler', 'runtime']) {
 const path = resolve(dist, name + '.worker.js');
 await writeFile(path, await bundleWorker(path));
}
// Single-file classic workers avoid extra module fetches at startup. Source workers remain ESM.
const studioPath = resolve(dist, 'studio.js');
await writeFile(studioPath, (await readFile(studioPath, 'utf8')).replace("new Worker(url,{type:'module'})", "new Worker(url)"));
await writeFile(resolve(dist,'404.html'),await readFile(resolve(dist,'index.html')));
await writeFile(resolve(dist,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'\n`);
console.log('Built dependency-free browser application in dist/');
