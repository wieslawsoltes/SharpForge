import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validate} from '../scripts/planning/schema/validate.js';
import {discoverManifests, repositoryRoot, selectManifests, parseTestArgs} from '../scripts/planning/test-manifests.js';
import {ciMatrix} from '../scripts/planning/ci-matrix.js';
import {taskPlan, loadTasks} from '../scripts/run.js';
import {loadBuildContributions, concatenateStyles} from '../scripts/build-contributions.js';
import {discoverPackages, validatePacked} from '../scripts/verify-packages.js';
import {serialTestArgs} from '../scripts/planning/run-tests.js';
const root=repositoryRoot;
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function write(root,path,value){const target=join(root,path);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,typeof value==='string'?value:JSON.stringify(value));}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'sharpforge-registration-'));t.after(()=>rm(dir,{recursive:true,force:true}));await write(dir,'planning/catalog.json',{areas:[{id:'A00'},{id:'A20'},{id:'A29'}]});for(const name of ['test-manifest','ci-matrix'])await write(dir,`planning/contracts/${name}.schema.json`,await readFile(join(root,`planning/contracts/${name}.schema.json`),'utf8'));for(const area of ['A00','A20','A29'])await write(dir,`tests/manifests/${area}.json`,manifest(area));return dir;}
const manifest=(area,extra={})=>({schemaVersion:1,area,nodeGlobs:[],browserScripts:[],requiredServices:[],timeout:10000,tags:[],...extra});

test('A00 T06 strict schema validates all thirty manifests and rejects unknown fields and invalid boundaries',async()=>{
 const schema=await json(join(root,'planning/contracts/test-manifest.schema.json'));
 const manifests=await discoverManifests();assert.equal(manifests.length,30);
 for(const {nodeFiles,...item}of manifests)validate(schema,item);
 for(const change of [{unknown:true},{timeout:0},{timeout:86400001},{area:'A30'},{schemaVersion:2},{tags:['duplicate','duplicate']},{nodeGlobs:[42]}])assert.throws(()=>validate(schema,{...manifest('A00'),...change}));
 validate(schema,manifest('A00',{timeout:1}));validate(schema,manifest('A29',{timeout:86400000}));
});
test('A00 T06 discovery assigns files once and includes nested contract/conformance suites',async()=>{
 const manifests=await discoverManifests(),files=manifests.flatMap(m=>[...m.nodeFiles,...m.browserScripts]);
 assert.equal(new Set(files).size,files.length);assert(files.includes('planning/contracts/tests/value-abi.test.js'));assert(files.includes('tests/conformance/qualification.test.js'));assert(files.includes('tests/conformance/browser/test_launch.py'));
 const editor = selectManifests(manifests, 'A20');
 assert.equal(editor.length, 1);
 const textSuites = new Set(['tests/text-buffer.test.js', 'tests/text-diff-merge.test.js',
  'tests/text-search-regex.test.js', 'tests/text-unicode.test.js']);
 assert(editor[0].nodeFiles.every(path => path.includes('editor') || textSuites.has(path)));
 for (const path of textSuites) assert(editor[0].nodeFiles.includes(path), path);
 assert.throws(() => selectManifests(manifests, 'A99'), /Unknown area/);
});
test('A00 T06 missing, duplicate, stale, unsafe and mismatched manifest entries fail with offending paths',async t=>{
 const dir=await fixture(t);await write(dir,'tests/editor.test.js','');
 await assert.rejects(discoverManifests(dir),/Unassigned test tests\/editor.test.js/);
 await write(dir,'tests/manifests/A20.json',manifest('A20',{nodeGlobs:['tests/editor.test.js']}));await discoverManifests(dir);
 await write(dir,'tests/manifests/A00.json',manifest('A00',{nodeGlobs:['tests/*.test.js']}));await assert.rejects(discoverManifests(dir),/Duplicate test tests\/editor.test.js/);
 await write(dir,'tests/manifests/A00.json',manifest('A00',{nodeGlobs:['tests/missing.test.js']}));await assert.rejects(discoverManifests(dir),/missing test tests\/missing.test.js/);
 await write(dir,'tests/manifests/A00.json',manifest('A00',{nodeGlobs:['../escaped.test.js']}));await assert.rejects(discoverManifests(dir),/Unsafe repository path/);
 await write(dir,'tests/manifests/A00.json',manifest('A20'));await assert.rejects(discoverManifests(dir),/Filename does not match/);
 await rm(join(dir,'tests/manifests/A00.json'));await assert.rejects(discoverManifests(dir),/Missing manifest tests\/manifests\/A00.json/);
});
test('A00 T06 overlapping globs in one area are duplicate ownership and helpers are not runnable suites',async t=>{
 const dir=await fixture(t);await write(dir,'tests/one.test.js','');await write(dir,'tests/browser_harness.py','');
 await write(dir,'tests/manifests/A00.json',manifest('A00',{nodeGlobs:['tests/*.test.js','tests/one.test.js']}));await assert.rejects(discoverManifests(dir),/Duplicate test tests\/one.test.js: A00, A00/);
 await write(dir,'tests/manifests/A00.json',manifest('A00',{nodeGlobs:['tests/*.test.js']}));assert.equal((await discoverManifests(dir))[0].nodeFiles.length,1);
});
test('A00 T06 runner executes only the selected area, propagates failures, and handles empty areas',async t=>{
 const dir=await fixture(t);
 await write(dir,'tests/pass.test.js',"import test from 'node:test';test('selected editor test',()=>{});");
 await write(dir,'tests/fail.test.js',"import test from 'node:test';test('unselected failure',()=>{throw Error('expected failure')});");
 await write(dir,'package.json',{type:'module'});
 await write(dir,'tests/manifests/A20.json',manifest('A20',{nodeGlobs:['tests/pass.test.js']}));
 await write(dir,'tests/manifests/A29.json',manifest('A29',{nodeGlobs:['tests/fail.test.js']}));
 const run=(...args)=>spawnSync(process.execPath,[join(root,'scripts/planning/run-tests.js'),'--root',dir,...args],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
 let result=run('--area','A20');assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Discovered 1 Node test files/);assert.match(result.stdout,/selected editor test/);assert.doesNotMatch(result.stdout,/unselected failure/);
 result=run();assert.notEqual(result.status,0);assert.match(result.stdout,/expected failure/);
 result=run('--area','A00');assert.equal(result.status,0);assert.match(result.stderr,/Discovered 0 Node/);
 result=run('--area','A20','--','--test-reporter=tap');assert.match(result.stdout,/^TAP version 13\n/);assert.match(result.stderr,/Discovered 1 Node/);
 result=run('--area','A20','--list');assert.deepEqual(JSON.parse(result.stdout).map(m=>m.area),['A20']);
 assert.throws(()=>parseTestArgs(['--area']),/Missing value/);assert.throws(()=>parseTestArgs(['--bogus']),/Unknown option/);
});
test('A00 T06 schema-checked CI matrix is consumed by a dry-run workflow fixture for each nonempty area',async t=>{
 const dir=await fixture(t);await write(dir,'tests/example.test.js','');await write(dir,'tests/example_test.py','');
 await write(dir,'tests/manifests/A20.json',manifest('A20',{nodeGlobs:['tests/example.test.js']}));await write(dir,'tests/manifests/A29.json',manifest('A29',{browserScripts:['tests/example_test.py']}));
 const workflow=await json(join(root,'tests/manifests/fixtures/ci-matrix-workflow.json'));
 const generated=spawnSync(process.execPath,[join(root,workflow.generate[1]),'--root',dir],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
 const matrix=JSON.parse(generated.stdout);assert.deepEqual(matrix.include.map(m=>m.area),['A20','A29']);
 for(const entry of matrix.include){const args=workflow.run.slice(1).map(arg=>arg.replace('${{ matrix.area }}',entry.area));args[0]=join(root,args[0]);const result=spawnSync(process.execPath,[...args,'--root',dir],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).map(m=>m.area),[entry.area]);}
 const real=await ciMatrix();assert(real.include.length>0);assert(real.include.every(m=>m.nodeGlobs.length||m.browserScripts.length));
});
test('A00 T06 every historical npm name dispatches to its original commands with literal arguments',async()=>{
 const baseline=await json(join(root,'tests/manifests/fixtures/npm-compatibility.json')),pkg=await json(join(root,'package.json'));
 for(const [name,command]of Object.entries(baseline)){
  assert.equal(pkg.scripts[name],`node scripts/run.js ${name}`);
  const plan=await taskPlan(name);assert(plan.length);
  if(name==='test'){assert.deepEqual(plan[0].args,['scripts/planning/run-tests.js']);continue;}
  if(name==='check'){
   assert.deepEqual(plan.map(p=>p.args),[
    ['scripts/planning/check-test-manifests.js'],['scripts/check.js'],
    ['scripts/conformance/static/check-imports.js','--output','artifacts/security/static-imports.json']
   ]);continue;
  }
  if(name==='standalone'){assert.deepEqual(plan.map(p=>p.args[0]),['scripts/build.js','scripts/standalone.js']);continue;}
  const [executable,...args]=command.split(' ');assert.equal(plan[0].command,executable==='node'?process.execPath:process.env.PYTHON||'python');
  if(!args.some(arg=>arg.includes('*')))assert.deepEqual(plan[0].args,executable==='node'?serialTestArgs(args):args);
  else assert(plan[0].args.includes('--test')&&plan[0].args.some(arg=>arg.endsWith('.test.js'))&&!plan[0].args.some(arg=>arg.includes('*')));
 }
 const literal='literal $(do-not-run) `nor-this` spaces';assert.equal((await taskPlan('cli',[literal]))[0].args.at(-1),literal);
});
test('A00 T06 new tasks need no root script edit and reject duplicate tasks, cycles and malformed commands',async t=>{
 const dir=await fixture(t);await write(dir,'scripts/tasks/new.json',{schemaVersion:1,tasks:{'a20:sample':{steps:[{command:'node',args:['sample.mjs']}]}}});
 assert.deepEqual((await taskPlan('a20:sample',['--flag'],dir))[0].args,['sample.mjs','--flag']);
 await write(dir,'scripts/tasks/native.json',{schemaVersion:1,tasks:{'a27:check':{steps:[{command:'cargo',args:['check']}]}}});assert.deepEqual(await taskPlan('a27:check',[],dir),[{command:'cargo',args:['check']}]);
 await write(dir,'scripts/tasks/second.json',{schemaVersion:1,tasks:{'a20:sample':{steps:[{command:'node',args:[]}]}}});await assert.rejects(loadTasks(dir),/Duplicate task/);await rm(join(dir,'scripts/tasks/second.json'));
 await write(dir,'scripts/tasks/new.json',{schemaVersion:1,tasks:{cycle:{steps:[{task:'cycle'}]}}});await assert.rejects(loadTasks(dir),/Task cycle/);
 await write(dir,'scripts/tasks/new.json',{schemaVersion:1,tasks:{bad:{steps:[{command:42,args:['invalid']}]}}});await assert.rejects(loadTasks(dir),/Invalid step/);
 await write(dir,'scripts/tasks/new.json',{schemaVersion:1,tasks:{bad:{steps:[{task:'missing'}]}}});await assert.rejects(loadTasks(dir),/Unknown task missing/);
});
test('A00 T06 contributed stylesheet bytes and worker order retain the original build exactly',async()=>{
 const baseline=await json(join(root,'tests/manifests/fixtures/build-baseline.json')),contributions=await loadBuildContributions();
 assert.deepEqual(contributions.styles.map(item=>item.source),baseline.styles);assert.deepEqual(contributions.workers.map(item=>item.entry),baseline.workers);
 const css=await concatenateStyles(contributions.styles,root);
 assert.equal(createHash('sha256').update(css).digest('hex'),baseline.concatenationSha256);assert(contributions.assets.some(item=>item.source==='packages/compiler'));
});
test('A00 T06 build contributions discover new styles/assets and reject duplicate and escaping paths',async t=>{
 const dir=await fixture(t),base={schemaVersion:1,styles:[],workers:[],assets:[]};
 await write(dir,'apps/studio/build.contrib.json',base);await mkdir(join(dir,'packages/new'),{recursive:true});await write(dir,'packages/new/new.css','.new {}');
 await write(dir,'packages/new/build.contrib.json',{...base,styles:[{source:'packages/new/new.css',order:0}],assets:[{source:'packages/new/new.css',target:'assets/new.css',order:0}]});
 const result=await loadBuildContributions(dir);assert.equal(result.styles[0].source,'packages/new/new.css');assert.equal(result.assets[0].target,'assets/new.css');
 await write(dir,'apps/studio/build.contrib.json',{...base,styles:[{source:'packages/new/new.css',order:1}]});await assert.rejects(loadBuildContributions(dir),/Duplicate styles/);
 await write(dir,'apps/studio/build.contrib.json',{...base,assets:[{source:'packages/new/new.css',target:'../escape',order:0}]});await assert.rejects(loadBuildContributions(dir),/Unsafe repository path/);
 await write(dir,'apps/studio/build.contrib.json',{...base,workers:[{entry:'worker.js',order:-1}]});await assert.rejects(loadBuildContributions(dir),/invalid workers order/);
});
test('A00 T06 workspace discovery accepts the next package without a verifier edit and validates exact tarball identities',async t=>{
 const packages=await discoverPackages();assert(packages.length>=25);assert(packages.every(pkg=>pkg.smoke.endsWith('/smoke.mjs')));
 const dir=await fixture(t);await write(dir,'package.json',{workspaces:['packages/*']});
 for(let i=0;i<26;i++){await write(dir,`packages/p${i}/package.json`,{name:`@fixture/p${i}`,version:'1.0.0'});await write(dir,`packages/p${i}/smoke.mjs`,'export async function smoke() {}');}
 const discovered=await discoverPackages(dir);assert.equal(discovered.length,26);
 const packed=discovered.map(pkg=>({name:pkg.name,version:pkg.version,filename:pkg.name.slice(1).replace('/','-')+'.tgz'}));assert.equal(validatePacked(discovered,packed).length,26);
 assert.throws(()=>validatePacked(discovered,packed.slice(1)),/Expected 26/);assert.throws(()=>validatePacked(discovered,[packed[1],...packed.slice(1)]),/duplicate/);
 assert.throws(()=>validatePacked(discovered,[{...packed[0],filename:'../bad.tgz'},...packed.slice(1)]),/Invalid tarball filename/);
 await rm(join(dir,'packages/p0/smoke.mjs'));await assert.rejects(discoverPackages(dir),/Missing package smoke/);
});

test('A00 T06 twenty-six contributed packages pack, install offline, and run their own smoke modules',async t=>{
 const dir=await fixture(t);await write(dir,'package.json',{name:'registration-fixture',private:true,type:'module',workspaces:['packages/*']});
 for(let i=0;i<26;i++){
  await write(dir,`packages/p${i}/package.json`,{name:`@registration/p${i}`,version:'1.0.0',type:'module',exports:'./index.js',files:['index.js']});
  await write(dir,`packages/p${i}/index.js`,`export const value=${i};\n`);
  await write(dir,`packages/p${i}/smoke.mjs`,`import assert from 'node:assert/strict';import {value} from '@registration/p${i}';export async function smoke({api}){assert.equal(value,${i});assert.equal(api.value,${i});}\n`);
 }
 const script=`import {verifyPackages} from ${JSON.stringify(new URL('../scripts/verify-packages.js',import.meta.url).href)};await verifyPackages(${JSON.stringify(dir)});`;
 const result=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',timeout:120000,env:{...process.env,SHARPFORGE_RESULTS_DIR:join(dir,'results')}});
 assert.equal(result.status,0,result.stderr);const report=await json(join(dir,'results/package-results.json'));assert.equal(report.passed,true);assert.equal(report.tarballs.length,26);assert.equal(Object.keys(report.packages).length,26);
});

test('A00 serial Node policy preserves script arguments and rejects concurrent overrides', () => {
 assert.deepEqual(serialTestArgs(['script.js','--test','--test-concurrency=4']),['script.js','--test','--test-concurrency=4']);
 assert.deepEqual(serialTestArgs(['--test','--test-concurrency','1','a.test.js']),['--test','--test-concurrency=1','a.test.js']);
 for(const args of [['--test-concurrency=2'],['--test-concurrency','4'],['--test-concurrency']])
  assert.throws(()=>serialTestArgs(['--test',...args]),/must be 1/);
});
test('A00 manifest runner prevents overlapping test files', async t => {
 const dir=await fixture(t);await write(dir,'package.json',{type:'module'});
 const source=`import test from 'node:test';import {mkdirSync,rmdirSync} from 'node:fs';
 test('exclusive shared validation resource',async()=>{mkdirSync('validation-slot');try{
 await new Promise(resolve=>setTimeout(resolve,100));}finally{rmdirSync('validation-slot');}});`;
 await write(dir,'tests/one.test.js',source);await write(dir,'tests/two.test.js',source);
 await write(dir,'tests/manifests/A20.json',manifest('A20',{nodeGlobs:['tests/*.test.js']}));
 const result=spawnSync(process.execPath,[join(root,'scripts/planning/run-tests.js'),'--root',dir,'--area','A20'],
  {encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
