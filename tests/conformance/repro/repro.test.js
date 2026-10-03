import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,symlink,utimes,access} from 'node:fs/promises';
import {join} from 'node:path';
import {readZip,writeZip} from '../../../packages/archive/src/index.js';
import {releaseManifest,verifyManifest,verifyReleaseTree} from '../../../scripts/conformance/source-manifest.js';
import {temporary,hash,inventory,run,differences} from '../../../scripts/conformance/repro/common.js';
import {canonicalZip,packageRelease} from '../../../scripts/conformance/repro/package-release.js';
import {verifySource} from '../../../scripts/conformance/repro/source.js';
import {dependencies,vendorCache,verifyCache} from '../../../scripts/conformance/repro/cache.js';
import {compareBuilds} from '../../../scripts/conformance/repro/double-build.js';
import {aggregate} from '../../../scripts/conformance/repro/aggregate.js';
import {compareExamples,regenerate,generators} from '../../../scripts/conformance/repro/examples.js';
import {explain} from '../../../scripts/conformance/repro/offline.js';
import {markdownLinks,checkLink} from '../../../scripts/conformance/repro/link-check.js';
import {download} from '../../../scripts/conformance/repro/prepare.js';

const epoch=1767225601;
async function fixture(directory){await mkdir(join(directory,'dist'));await mkdir(join(directory,'artifacts'));await writeFile(join(directory,'dist/main.js'),'export const value=42;');await writeFile(join(directory,'artifacts/app.html'),'<!doctype html>');}

test('T09 complete manifest detects one byte flipped in dist and preserves artifact-only verification',async()=>temporary(async directory=>{
  await fixture(directory);const manifest=await releaseManifest(join(directory,'artifacts'),'a'.repeat(40),{root:directory});
  assert.equal(manifest.schemaVersion,2);await verifyManifest(join(directory,'artifacts'),manifest);await verifyReleaseTree(directory,manifest);
  await writeFile(join(directory,'dist/main.js'),'export const value=43;');
  await assert.rejects(verifyReleaseTree(directory,manifest),/main\.js/);
  await verifyManifest(join(directory,'artifacts'),manifest);
  await writeFile(join(directory,'artifacts/app.html'),'tampered');await assert.rejects(verifyManifest(join(directory,'artifacts'),manifest),/differs/);
}));

test('T09 manifest refuses unbound, empty, missing, extra and symlink trees',async()=>temporary(async directory=>{
  await fixture(directory);const manifest=await releaseManifest(join(directory,'artifacts'),'a'.repeat(40),{root:directory});
  await assert.rejects(verifyReleaseTree(directory,{...manifest,schemaVersion:1}),/does not bind/);
  await assert.rejects(verifyManifest(join(directory,'artifacts'),{...manifest,schemaVersion:0}),/Invalid/);
  await writeFile(join(directory,'dist/extra.js'),'extra');await assert.rejects(verifyReleaseTree(directory,manifest),/extra\.js/);
  await assert.rejects(verifyReleaseTree(directory,{...manifest,tree:{root:'../dist',files:manifest.tree.files}}),/does not bind/);
  const linked=join(directory,'dist/link');await symlink(join(directory,'artifacts'),linked,process.platform==='win32'?'junction':'dir');await assert.rejects(inventory(join(directory,'dist')),/Symbolic link/);
}));

test('T09 browser zip bytes ignore insertion order and filesystem mtimes',async()=>temporary(async directory=>{
  await fixture(directory);await writeFile(join(directory,'dist/z.txt'),'Unicode: λ');
  const first=await packageRelease({root:directory,epoch});
  const bytes=await readFile(first.path),entries=readZip(bytes);assert.deepEqual(entries.map(entry=>entry.path),['main.js','z.txt']);
  await utimes(join(directory,'dist/main.js'),epoch+10000,epoch+10000);
  assert.equal((await packageRelease({root:directory,epoch})).sha256,first.sha256);
  assert.deepEqual(canonicalZip(entries,epoch),canonicalZip([...entries].reverse(),epoch));
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);assert.equal(header.getUint16(10,true),0,'UTC Jan 1 midnight rounded to ZIP two-second precision');
  assert.throws(()=>canonicalZip(entries,0),/ZIP date range/);assert.throws(()=>canonicalZip(entries,NaN),/ZIP date range/);
  assert.throws(()=>canonicalZip([{path:'../escape',text:'bad'}],epoch),/traversing/);
  assert.throws(()=>canonicalZip([{path:'a',text:'x'},{path:'A',text:'y'}],epoch),/colliding/);
}));

test('T09 exact source archive rejects altered, omitted, extra, truncated and multiple-root bytes',()=>{
  const bytes=Buffer.from('source λ'),oid=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const tree=new Map([['src/a.js',{mode:'100644',oid}]]),valid=writeZip([{path:'Source/src/a.js',bytes}]);
  assert.equal(verifySource(valid,tree)[0].path,'src/a.js');
  assert.throws(()=>verifySource(writeZip([{path:'Source/src/a.js',text:'different'}]),tree),/does not match commit/);
  assert.throws(()=>verifySource(writeZip([{path:'Source/empty',directory:true}]),tree),/Missing source/);
  assert.throws(()=>verifySource(writeZip([{path:'Source/src/a.js',bytes},{path:'Source/extra',text:'x'}]),tree),/Unexpected source/);
  assert.throws(()=>verifySource(valid.subarray(0,valid.length-1),tree),/ZIP/);
  assert.throws(()=>verifySource(writeZip([{path:'Source/src/a.js',bytes},{path:'Other/x',text:'x'}]),tree),/one root/);
});

test('T09 vendored offline cache is sealed to exact lock and bytes, including legitimately empty cache',async()=>temporary(async directory=>{
  const lock={lockfileVersion:3,packages:{'':{name:'root'},'node_modules/local':{resolved:'packages/local',link:true},'packages/local':{version:'1'}}};
  await writeFile(join(directory,'package-lock.json'),JSON.stringify(lock));
  const output=join(directory,'vendor'),manifest=await vendorCache({root:directory,output});assert.deepEqual(manifest.dependencies,[]);assert.deepEqual(manifest.files,[]);
  await verifyCache(directory,output);
  await writeFile(join(output,'cache/tampered'),'x');await assert.rejects(verifyCache(directory,output),/content differs/);
  await writeFile(join(directory,'package-lock.json'),JSON.stringify({...lock,name:'changed'}));await assert.rejects(verifyCache(directory,output),/this package lock/);
  assert.throws(()=>dependencies({lockfileVersion:1}),/version/);
  assert.throws(()=>dependencies({lockfileVersion:3,packages:{x:{resolved:'https://example.invalid/a.tgz'}}}),/integrity/);
  assert.throws(()=>dependencies({lockfileVersion:3,packages:{x:{resolved:'file:outside',integrity:'sha512-YQ=='}}}),/HTTPS/);
}));

const output=(path,content)=>({path,bytes:Buffer.byteLength(content),sha256:hash(content)});
const golden={schemaVersion:1,algorithm:'sha256',mode:'fixture',examples:[{input:'example.cs',assembly:'a'}],bundles:[{path:'dist/main.js',sha256:'a'}]};
const report=platform=>({schemaVersion:1,passed:true,platform,commit:'a'.repeat(40),epoch,toolchain:{node:'v24.21.0',npm:'11.19.0'},outputs:[output('dist/main.js','one'),output('artifacts/browser.zip','zip')],golden});

test('T09 double and cross-runner comparison requires complete independent matching outputs',()=>{
  assert.equal(compareBuilds(report('linux-x64'),report('win32-x64')).passed,true);
  const bad=report('win32-x64');bad.outputs=[output('dist/main.js','two')];assert.equal(compareBuilds(report('linux-x64'),bad).passed,false);
  assert.throws(()=>compareBuilds(report('linux-x64'),{...report('win32-x64'),commit:'b'.repeat(40)}),/different source/);
  assert.throws(()=>differences([output('a','1'),output('a','1')],[]),/Duplicate/);
  assert.equal(aggregate(['linux-x64','darwin-arm64','win32-x64'].map(report)).passed,true);
  assert.throws(()=>aggregate([report('linux-x64')]),/Missing independent/);
  assert.throws(()=>aggregate([report('linux-x64'),report('linux-x64')]),/Duplicate runner/);
  assert.throws(()=>aggregate([{...report('linux-x64'),passed:false}]),/Failed runner/);
  const changed=report('darwin-arm64');changed.golden={...golden,bundles:[{path:'dist/main.js',sha256:'changed'}]};assert.equal(compareBuilds(report('linux-x64'),changed).passed,false);
});

test('T09 explained differences are exact committed hash pairs, never missing artifacts or wildcards',()=>{
  const before=output('dist/main.js','before'),after=output('dist/main.js','after'),changes=differences([before],[after]);
  const entry={path:before.path,expectedSha256:before.sha256,actualSha256:after.sha256,reason:'Reviewed deliberate toolchain migration changes exact bytes.',issue:'https://github.com/wieslawsoltes/SharpForge/issues/1177'};
  assert.equal(explain(changes,{schemaVersion:1,differences:[]}).passed,false);
  assert.equal(explain(changes,{schemaVersion:1,differences:[entry]}).passed,true);
  assert.equal(explain(differences([before],[]),{schemaVersion:1,differences:[entry]}).passed,false);
  assert.throws(()=>explain(changes,{schemaVersion:1,differences:[{...entry,actualSha256:'*'}]}),/unbounded/);
  assert.throws(()=>explain(changes,{schemaVersion:1,differences:[entry,entry]}),/duplicate/);
  assert.throws(()=>explain(changes,{schemaVersion:1,differences:[{...entry,reason:'skip'}]}),/unbounded/);
});

test('T09 example freshness reports exact stale path and genuine generator ordering hazards',async()=>temporary(async directory=>{
  assert.equal(generators.length,6);assert.equal(new Set(generators).size,6);
  await mkdir(join(directory,'examples'));await writeFile(join(directory,'examples/output.txt'),'committed');const committed=await inventory(join(directory,'examples'));
  const execute=async(_node,[script])=>{await writeFile(join(directory,'examples/output.txt'),script);};
  const forward=await regenerate(directory,['first','second'],{execute}),reverse=await regenerate(directory,['second','first'],{execute});
  const result=compareExamples(committed,forward,reverse);assert.equal(result.passed,false);assert.equal(result.stale[0].path,'output.txt');assert.equal(result.orderDependent[0].path,'output.txt');
  assert.equal(compareExamples(committed,committed,committed).passed,true);
}));

test('T09 link parser covers inline, image, reference, balanced parentheses, HTML and ignores code',()=>{
  const source='[doc](docs/a.md#anchor) ![image](docs/image.png) [nested](docs/a_(b).md) [spaced](<docs/a b.md>) [ref][id] [short]\n[id]: examples/a.zip "title"\n[short]: docs/s.md\n<a href="docs/html.md">x</a> <https://example.invalid/>\n`[ignored](absent.md)`\n```md\n[ignored](absent2.md)\n```';
  assert.deepEqual(markdownLinks(source).sort(),['docs/a.md#anchor','docs/image.png','docs/a_(b).md','docs/a b.md','examples/a.zip','docs/s.md','docs/html.md','https://example.invalid/'].sort());
  assert.throws(()=>markdownLinks('[x][undefined]'),/Undefined link reference/);
  assert.throws(()=>markdownLinks('[x](unfinished'),/Unclosed/);
});

test('T09 relative links must resolve to tracked files or verified release assets',()=>{
  const options={tracked:new Set(['docs/guide.md','docs/a b.md','examples/project/Program.cs']),assets:new Set(['artifacts/SharpForge-browser.zip'])};
  assert.equal(checkLink('README.md','docs/guide.md#heading',options).kind,'tracked-file');
  assert.equal(checkLink('docs/guide.md','a%20b.md',options).kind,'tracked-file');
  assert.equal(checkLink('docs/guide.md','../artifacts/SharpForge-browser.zip',options).kind,'release-asset');
  assert.equal(checkLink('README.md','examples/project',options).kind,'tracked-directory');
  assert.equal(checkLink('README.md','https://example.invalid',options).kind,'external');
  assert.throws(()=>checkLink('README.md','artifacts/missing.zip',options),/Missing.*artifact/);
  assert.throws(()=>checkLink('README.md','../escape',options),/escapes/);
  assert.throws(()=>checkLink('README.md','%xx',options),/Malformed/);
  assert.throws(()=>checkLink('README.md','javascript:alert(1)',options),/scheme/);
});

test('T09 downloads reject failed and oversized responses before extraction',async()=>{
  const fetcher=async()=>new Response('bytes');assert.equal((await download('https://example.invalid',{fetcher})).toString(),'bytes');
  await assert.rejects(download('https://example.invalid',{fetcher,limit:4}),/size limit/);
  await assert.rejects(download('https://example.invalid',{fetcher:async()=>new Response('missing',{status:404})}),/404/);
});

test('T09 subprocess timeouts and output bounds fail and temporary trees are disposed',async()=>{
  let owned;
  await assert.rejects(temporary(async directory=>{owned=directory;await run(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:directory,timeout:30});}),/Timed out/);
  await assert.rejects(access(owned),{code:'ENOENT'});
  await assert.rejects(run(process.execPath,['-e','process.stdout.write("x".repeat(5000))'],{maxBytes:100}),/output limit/);
  await assert.rejects(run('sharpforge-deliberately-missing-executable',[]),/ENOENT/);
});

test('T09 cancellation terminates a started child before its temporary tree is removed',async()=>{
  const controller=new AbortController();let owned;
  await assert.rejects(temporary(async directory=>{
    owned=directory;const ready=join(directory,'ready');
    const pending=run(process.execPath,['-e','require("fs").writeFileSync(process.argv[1],"ready");setInterval(()=>{},1000)',ready],{signal:controller.signal,cwd:directory});
    for(let attempts=0;;attempts++){try{await access(ready);break;}catch{if(attempts>200)throw new Error('Child did not start');await new Promise(resolve=>setTimeout(resolve,10));}}
    controller.abort();await pending;
  }),/Cancelled subprocess/);
  await assert.rejects(access(owned),{code:'ENOENT'});
  await assert.rejects(run(process.execPath,['-e','throw 1'],{signal:controller.signal}),/abort|cancel/i);
});
