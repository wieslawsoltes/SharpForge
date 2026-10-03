import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
let count=0,failed=0;
async function visit(path){for(const e of await readdir(path,{withFileTypes:true})){if(['node_modules','dist','.git'].includes(e.name))continue;const p=resolve(path,e.name);if(e.isDirectory())await visit(p);else if(e.name.endsWith('.js')||e.name.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});count++;if(r.status!==0){console.error(r.stderr);failed++;}}}}
await visit(process.cwd());console.log(`Checked ${count} JavaScript modules; ${failed} syntax errors.`);process.exitCode=failed?1:0;
