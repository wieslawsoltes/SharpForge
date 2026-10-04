import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cssRules, cssFingerprint} from '../scripts/planning/css-rules.js';
import {loadBuildContributions, concatenateStyles, buildRoot} from '../scripts/build-contributions.js';
const json=async path=>JSON.parse(await readFile(path,'utf8'));

test('A00 T20 contributed CSS matches the reviewed stylesheet snapshot and both sorted and ordered rules',async()=>{
 const {schemaVersion,sourceCommit,...expected}=await json(join(buildRoot,'planning/contracts/fixtures/css/studio-baseline.json'));
 assert.equal(schemaVersion,1);assert.match(sourceCommit,/^[a-f\d]{40}$/);
 const {styles}=await loadBuildContributions(),css=await concatenateStyles(styles);
 assert.deepEqual(cssFingerprint(css),expected);
 const actualFiles=(await readdir(join(buildRoot,'apps/studio/styles'))).filter(name=>name.endsWith('.css')).map(name=>'apps/studio/styles/'+name).sort();
 const declaredFiles=styles.filter(entry=>entry.source.startsWith('apps/studio/styles/')).map(entry=>entry.source).sort();
 assert.deepEqual(declaredFiles,actualFiles);assert.equal(actualFiles.length,26);
 // A18 preserves the released contribution filenames while their rules move to package-owned styles.
 const compatibilityShims = new Map([
  ['apps/studio/styles/designer.css', '/* Designer styles are contributed by packages/designer/build.contrib.json. */\n'],
  ['apps/studio/styles/designer-light.css', '/* Light and dark designer colors are defined in workbench/theme-tokens.css. */\n']
 ]);
 for (const source of actualFiles) {
  const contents = await readFile(join(buildRoot, source), 'utf8');
  const rules = cssRules(contents);
  if (compatibilityShims.has(source)) {
   assert.equal(contents, compatibilityShims.get(source), `${source}: exact compatibility shim`);
   assert.equal(rules.length, 0, `${source}: retired rules stay in their replacement contribution`);
  } else {
   assert(rules.length > 0, source);
  }
 }
 for (const source of ['apps/studio/designer-surface.css', 'apps/studio/designer-panels.css', 'apps/studio/designer-chrome.css']) {
  assert(styles.some(entry => entry.source === source), `${source}: registered replacement contribution`);
  assert(cssRules(await readFile(join(buildRoot, source), 'utf8')).length > 0, source);
 }
 assert.equal((await readdir(join(buildRoot,'apps/studio'))).some(name=>/^release\d+\.css$/.test(name)),false);
 assert.equal(new Set(styles.map(entry=>entry.order)).size,styles.length);
});

test('A00 T20 sorted equality alone cannot hide reversed overrides, missing or changed rules',()=>{
 const original='.tool{color:red}.tool{color:blue}',reversed='.tool{color:blue}.tool{color:red}';
 assert.equal(cssFingerprint(original).sortedRulesSha256,cssFingerprint(reversed).sortedRulesSha256);
 assert.notEqual(cssFingerprint(original).orderedRulesSha256,cssFingerprint(reversed).orderedRulesSha256);
 for(const changed of ['.tool{color:red}',original+'.tool{display:none}',original.replace('blue','green')])assert.notEqual(cssFingerprint(original).sortedRulesSha256,cssFingerprint(changed).sortedRulesSha256);
});

test('A00 T20 CSS rule boundaries preserve nested media, quoted punctuation, escaped selectors, functions and at-rules',()=>{
 const pieces=['@charset "UTF-8";','.escaped\\{selector{content:"}; /* not a comment */";background:url("data:image/svg+xml,<svg>{x}</svg>")}','@media(max-width:700px){.a{color:red}@supports(display:grid){.b{display:grid}}}',"[data-name='[x]']{content:'\\\''}"];
 assert.deepEqual(cssRules('/* header */\n'+pieces.join('\n/* between */\n')+'\n/* footer */'),pieces);
 assert.deepEqual(cssRules(''),[]);assert.deepEqual(cssRules(' \n/* comments only */\t'),[]);
 assert.equal(cssRules('.a{--tokens:{a:b};color:red}').length,1);
 for(const malformed of ['.a{color:red','/* unterminated','.a{content:"unfinished}', '}','.a{color:red})','@media(x{.a{color:red}}','[x{color:red}','color:red;'])assert.throws(()=>cssRules(malformed),SyntaxError);
 assert.throws(()=>cssRules(null),TypeError);
});

test('A00 T20 contribution separators preserve fragment boundaries and reject non-formatting insertion',async t=>{
 const root=await mkdtemp(join(tmpdir(),'sf-css-contributions-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'apps/studio'),{recursive:true});await mkdir(join(root,'packages'));
 await writeFile(join(root,'first.css'),'.first{color:red}');await writeFile(join(root,'second.css'),'.second{color:blue}');
 const first={source:'first.css',order:0},second={source:'second.css',order:1},doc={schemaVersion:1,styles:[first,second],workers:[],assets:[]};
 const save=()=>writeFile(join(root,'apps/studio/build.contrib.json'),JSON.stringify(doc));await save();
 assert.equal(await concatenateStyles((await loadBuildContributions(root)).styles,root),'.first{color:red}\n.second{color:blue}');
 second.separator='';await save();assert.equal(await concatenateStyles((await loadBuildContributions(root)).styles,root),'.first{color:red}.second{color:blue}');
 second.separator='\n';await save();assert.equal(await concatenateStyles((await loadBuildContributions(root)).styles,root),'.first{color:red}\n.second{color:blue}');
 assert.equal(await concatenateStyles([],root),'');assert.equal(await concatenateStyles([first],root),'.first{color:red}');
 for(const separator of ['/* extra rule */',' ',false,0,null]){second.separator=separator;await save();await assert.rejects(loadBuildContributions(root),/invalid stylesheet separator/);}
 delete second.separator;second.source='missing.css';await save();await assert.rejects(loadBuildContributions(root),/missing source missing.css/);
});
