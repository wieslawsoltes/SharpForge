import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {projectTemplates,itemTemplates,createProjectPlan} from '@sharpforge/templates';
import {ProjectSystem,importWorkspaceZip} from '@sharpforge/project-system';
import {compileToIL} from '@sharpforge/compiler';
const pascal=s=>s.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('');
for(const t of projectTemplates)test(`packaged ${t.id} example matches the wizard and its disk/ZIP bytes`,async()=>{const p=createProjectPlan(t.id,{projectName:pascal(t.id)+'Example',namespace:'TemplateExamples.'+pascal(t.id)}),root='examples/templates/'+t.id,zip=importWorkspaceZip(new Uint8Array(await readFile(root+'.zip')));assert.equal(zip.settings.entry,p.entry);assert.equal(zip.records.length,p.records.length);for(const r of p.records){assert.equal(await readFile(join(root,r.path),'utf8'),r.text);assert.equal(zip.records.find(f=>f.path===r.path).text,r.text);}for(const path of p.folders)assert.equal((await readdir(join(root,path))).length,0);});
test('packaged item gallery contains and compiles all 19 actual item templates',async()=>{const zip=importWorkspaceZip(new Uint8Array(await readFile('examples/templates/item-gallery.zip'))),sys=new ProjectSystem(zip.records),snapshot=sys.load(zip.settings.entry);assert(!snapshot.diagnostics.some(d=>d.severity==='error'));for(const t of itemTemplates)assert(zip.records.some(r=>r.path.startsWith('ItemGallery/Items/'+t.id+'/')),t.id);const compiled=compileToIL(sys.compilationFiles(zip.settings.startup),sys.compilationOptions(zip.settings.startup));assert(compiled.success,JSON.stringify(compiled.diagnostics));assert.equal(compiled.image.entryPoint,null);});
