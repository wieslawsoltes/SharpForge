import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli=new URL('../apps/cli/main.js',import.meta.url);
function run(args){return spawnSync(process.execPath,[fileURLToPath(cli),...args],{encoding:'utf8',timeout:15000});}
test('CLI: default .dll artifact, runtime configuration, disassembly and exec',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sharpforge-il-'));
 try{const source=join(dir,'Program.cs'),dll=join(dir,'App.dll');await writeFile(source,'Console.WriteLine(42);');const compiled=run(['compile',source,'-o',dll]);assert.equal(compiled.status,0,compiled.stderr);const bytes=await readFile(dll);assert.equal(bytes.subarray(0,2).toString(),'MZ');const config=JSON.parse(await readFile(join(dir,'App.runtimeconfig.json'),'utf8'));assert.equal(config.runtimeOptions.framework.name,'Microsoft.NETCore.App');const executed=run(['exec',dll]);assert.equal(executed.status,0,executed.stderr);assert.equal(executed.stdout,'42\n');const dis=run(['disasm',dll]);assert.equal(dis.status,0,dis.stderr);assert.match(dis.stdout,/System.Console::WriteLine/);const direct=run(['run',source]);assert.equal(direct.stdout,'42\n');}
 finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI: legacy IR remains an explicit option',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sharpforge-ir-'));
 try{const source=join(dir,'P.cs'),target=join(dir,'P.sfb.json');await writeFile(source,'Console.WriteLine(7);');assert.equal(run(['compile',source,'--format','ir','-o',target]).status,0);assert.equal(run(['exec',target]).stdout,'7\n');}finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI: invalid format and missing option values fail cleanly',()=>{assert.equal(run(['compile','--format','unknown']).status,1);assert.equal(run(['compile','-o']).status,1);});
