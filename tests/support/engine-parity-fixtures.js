import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {basename,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sampleSources} from '../sample-sources.js';

async function filesBelow(directory) {
  let entries;
  try {entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const files=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(entry.isDirectory())files.push(...await filesBelow(join(directory,entry.name)));
    else if(entry.isFile())files.push(join(directory,entry.name));
  }
  return files;
}

/** Discover catalogs, not a frozen list of rows. Importing these modules never runs tests. */
export async function discoverLanguageFixtures(root) {
  const fixtures=new Map(),catalogs=[];
  const pathName=path=>relative(root,path).split(sep).join('/');
  function add(fixture,path) {
    assert.equal(typeof fixture.id,'string',`Missing fixture id in ${path}`);
    assert(fixture.id.length&&fixture.source!==undefined,`Incomplete fixture in ${path}`);
    const previous=fixtures.get(fixture.id),catalog=pathName(path);
    if(previous) {
      const {catalogs:ignored,...definition}=previous;
      assert.deepEqual(definition,fixture,`Catalogs disagree about ${fixture.id}`);
      if(!previous.catalogs.includes(catalog))previous.catalogs.push(catalog);
    } else fixtures.set(fixture.id,{...fixture,catalogs:[catalog]});
  }
  for(const path of await filesBelow(join(root,'tests/fixtures/language'))) {
    if(!path.endsWith('.js'))continue;
    const {languageFixtures}=await import(pathToFileURL(path));
    assert(Array.isArray(languageFixtures),`${path} must export languageFixtures`);
    catalogs.push(pathName(path));
    for(const fixture of languageFixtures)add(fixture,path);
  }
  for(const path of (await filesBelow(join(root,'tests'))).filter(path=>/-fixtures\.js$/.test(path))) {
    // CIL and CLR catalogs use the established *ExecutionCases export convention.
    const source=await readFile(path,'utf8');
    if(!/export\s+const\s+\w*ExecutionCases\s*=/.test(source))continue;
    const module=await import(pathToFileURL(path));
    for(const [name,cases] of Object.entries(module)) {
      if(!name.endsWith('ExecutionCases'))continue;
      assert(Array.isArray(cases),`${path}: ${name} must be an array`);catalogs.push(pathName(path)+'#'+name);
      for(const [name,source,expected] of cases) {
        assert.equal(typeof name,'string',`Missing case name in ${path}`);
        assert(['string','number'].includes(typeof expected),`Unknown expectation in ${path}: ${name}`);
        add({id:basename(path,'.js')+'/'+name,source,expected:typeof expected==='number'?{output:'',exitCode:expected}:{output:expected}},path);
      }
    }
  }
  const addSamples=(samples,path)=>{
    catalogs.push(pathName(path));
    for(const sample of samples)add({id:'sample/'+sample.id,source:sampleSources(sample),compilationOptions:sample.compilationOptions??{},
      ...(sample.id==='errors'?{compileFailure:true}:{}),...(sample.expectedOutput!==undefined?{expected:{output:sample.expectedOutput}}:{})},path);
  };
  for(const path of (await filesBelow(join(root,'apps/studio'))).filter(path=>/^samples(?:-.*)?\.js$/.test(basename(path)))) {
    const module=await import(pathToFileURL(path));
    const exports=Object.entries(module).filter(([name])=>name.toLowerCase().endsWith('samples'));
    assert(exports.length,`Sample catalog has no samples export: ${path}`);
    for(const [name,samples] of exports) {
      assert(Array.isArray(samples)&&samples.every(sample=>sample?.id&&Array.isArray(sample.files)),`Malformed ${name} catalog in ${path}`);
      addSamples(samples,path);
    }
  }
  for(const path of (await filesBelow(join(root,'examples'))).filter(path=>basename(path)==='manifest.json')) {
    const entries=JSON.parse(await readFile(path,'utf8'));
    // Build-system manifests describe projects, not independently executable source fixtures.
    if(!Array.isArray(entries)||!entries.some(entry=>Array.isArray(entry.files)))continue;
    assert(entries.every(entry=>entry.id&&Array.isArray(entry.files)),`Mixed language catalog ${path}`);
    addSamples(entries,path);
  }
  return {fixtures:[...fixtures.values()].sort((a,b)=>a.id.localeCompare(b.id)),catalogs:[...new Set(catalogs)].sort()};
}
