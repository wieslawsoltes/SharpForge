/** Package the built IDE, its two real workers, and dependencies into one HTML file. */
import { readFile,writeFile } from 'node:fs/promises';
import { bundleWorker } from './bundle-worker.js';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
let html=await readFile(resolve(dist,'index.html'),'utf8');
const css=await readFile(resolve(dist,'studio.css'),'utf8');
const compiler=await readFile(resolve(dist,'compiler.worker.js'),'utf8');
const runtime=await readFile(resolve(dist,'runtime.worker.js'),'utf8');
let script=await bundleWorker(resolve(dist,'studio.js'));
script=script.replaceAll("new URL('./compiler.worker.js',import.meta.url)",'__workerCompiler').replaceAll("new URL('./runtime.worker.js',import.meta.url)",'__workerRuntime');
if(script.includes('import.meta'))throw new Error('Unresolved module URL in standalone bundle');
script=`const __workerCompiler=URL.createObjectURL(new Blob([${JSON.stringify(compiler)}],{type:'text/javascript'}));\nconst __workerRuntime=URL.createObjectURL(new Blob([${JSON.stringify(runtime)}],{type:'text/javascript'}));\n`+script;
html=html.replace('<link rel="stylesheet" href="./studio.css">',()=>'<style>'+css+'</style>').replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">','');
html=html.replace('<script type="module" src="./studio.js"></script>',()=>'<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace('<title>','<!-- Self-contained SharpForge release: inline script/style and Blob workers. Use the normal dist build for a strict self-only CSP. -->\n<title>');
const target=resolve(root,'SharpForge-standalone.html');await writeFile(target,html);console.log(`Built ${target} (${Buffer.byteLength(html).toLocaleString()} bytes)`);
