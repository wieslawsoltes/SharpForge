import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDependencies } from '../../../scripts/planning/lib/deps-parse.js';
import { validateDag } from '../../../scripts/planning/validate-dag.js';
import { readiness, requireReady } from '../../../scripts/planning/ready.js';
import { resolveTask } from '../../../scripts/planning/lib/task-ref.js';
import { checkOwnership } from '../../../scripts/planning/check-ownership.js';
import { checkHotFiles } from '../../../scripts/planning/check-hot-files.js';
import { generateOwnership } from '../../../scripts/planning/gen-ownership.js';
import { codeowners } from '../../../scripts/planning/gen-codeowners.js';
import { pathCollisions } from '../../../scripts/planning/check-path-collisions.js';
import { lintBacklog } from '../../../scripts/planning/lint-backlog.js';
import { bootstrapPlan, REQUIRED_FIELDS, REQUIRED_LABELS, bootstrap } from '../../../scripts/planning/bootstrap-project.js';
import { normalizeSnapshot } from '../../../scripts/planning/snapshot-backlog.js';
import { exportDag } from '../../../scripts/planning/dag-export.js';
import { readJSON } from '../../../scripts/planning/lib/io.js';
const root = new URL('../../../', import.meta.url), sha = 'a'.repeat(40);
const task = (n, dependencies = [], state = 'OPEN') => ({ id: `SF-A00-T${String(n).padStart(2, '0')}`, number: n, title: '', state, area: 'A00', kind: 'Task', parent: null, dependencies, contracts: [], pullRequests: state === 'CLOSED' ? [{ number: n, merged: true, mergeCommit: sha, baseRefName: 'main' }] : [] });
const snapshot = issues => ({ issues, updatedAt: '2026-10-03T12:00:00Z', defaultBranch: 'main' });
test('dependency grammar accepts legacy Markdown and multiline requirements, rejects malformed IDs', () => {
  assert.deepEqual(parseDependencies('Depends on: SF-A00-T01, SF-A00-T02\n  - SF-A00-T03\nRequires contracts: value-abi@1, image@1.2\n'), { dependencies: ['SF-A00-T01','SF-A00-T02','SF-A00-T03'], contracts: [{name:'image',version:'1.2'},{name:'value-abi',version:'1'}] });
  assert.deepEqual(parseDependencies('## Dependencies\n\n- [SF-A00-T01](https://x)\n\n## Ownership\nSF-A00-T99').dependencies, ['SF-A00-T01']);
  assert.throws(() => parseDependencies('Depends on: SF-A0-Txx'), /Malformed/);
  assert.throws(() => parseDependencies('Requires contracts: value-abi@1 value-abi@2'), /Conflicting/);
});
test('diamond readiness requires actual merged evidence; cycles and unresolved IDs block', () => {
  const a=task(1,[],'CLOSED'),b=task(2,[a.id],'CLOSED'),c=task(3,[a.id],'CLOSED'),d=task(4,[b.id,c.id]);
  const s=snapshot([a,b,c,d]); assert.equal(readiness(s,d.id).ready,true);
  a.pullRequests=[]; assert.equal(readiness(s,d.id).ready,false); a.pullRequests=[{merged:true,mergeCommit:sha,baseRefName:'feature'}];assert.equal(readiness(s,d.id).ready,false);
  a.dependencies=[d.id]; assert.match(validateDag(s).errors.join(),/Cycle/);
  a.dependencies=['SF-A00-T99'];assert.match(validateDag(s).errors.join(),/unresolved/);
});
test('leaf readiness inherits parent requirements; explicit contracts require qualified versions', () => {
  const base=task(1),parent=task(2,[base.id]),leaf={...task(3),id:'SF-A00-T02.1',parent:parent.id};
  const s=snapshot([base,parent,leaf]);assert.equal(readiness(s,leaf.id).ready,false);assert.equal(readiness(s,parent.id).ready,false);
  base.state='CLOSED';base.pullRequests=[{merged:true,mergeCommit:sha,baseRefName:'main'}];leaf.contracts=[{name:'abi',version:'1'}];
  assert.equal(readiness(s,leaf.id,{abi:{version:1,qualified:true,commit:sha}}).ready,true);
  assert.equal(readiness(s,leaf.id,{abi:{version:1,qualified:false,commit:sha}}).ready,false);
  assert.throws(()=>requireReady(s,leaf.id,{now:new Date('2026-10-05')}),/stale/);
});
test('task identity cross-checks branch, body, and project field; missing identity fails',()=>{
  assert.equal(resolveTask({branch:'agent/SF-A00-T08.2-check',body:'Task: SF-A00-T08.2',projectBranch:'agent/SF-A00-T08.2-check'}),'SF-A00-T08.2');
  assert.equal(resolveTask({branch:'codex/governance',body:'Task: SF-A00-T08.2'}),'SF-A00-T08.2');
  assert.throws(()=>resolveTask({branch:'agent/SF-A00-T08',body:'Task: SF-A00-T09'}),/SF-A00-T08.*SF-A00-T09/);
  assert.throws(()=>resolveTask({branch:'codex/no-task'}),/no resolvable/);
  assert.throws(()=>resolveTask({branch:'codex/a',body:'Task: SF-A00-T08',projectBranch:'codex/b'}),/does not match/);
});
test('ownership rejects cross-area writes and accepts only enumerated exceptions or held locks',()=>{
  const ownership=generateOwnership(readJSON(new URL('planning/catalog.json',root))),exceptions=readJSON(new URL('planning/contracts/ownership-exceptions.json',root)),lockRegistry=readJSON(new URL('planning/contracts/locks.json',root));
  const check=(files,heldLocks=[])=>checkOwnership({files,area:'A00',ownership,exceptions,lockRegistry,heldLocks});
  assert.deepEqual(check(['planning/contracts/new.json']).errors,[]);
  assert.match(check(['packages/compiler/src/index.js']).errors.join(),/compiler-index/);
  assert.deepEqual(check(['packages/compiler/src/index.js'],['compiler-index']).errors,[]);
  assert.deepEqual(check(['docs/readme.md']).errors,[]);
  assert.match(check(['docs/readme.md','planning/contracts/new.json']).errors.join(),/outside/);
  assert.deepEqual(check(['docs/custom-results.json']).errors,[]);
  assert.match(check(['docs/invented-generated.json']).errors.join(),/outside/);
  assert.deepEqual(check(['tests/manifests/A00.json']).errors,[]);
  assert.match(check(['tests/manifests/A01.json']).errors.join(),/outside/);
  assert.throws(()=>check(['../outside']),/Unsafe/);
});
test('hot-file growth budgets enforce both net lines and byte growth',()=>{
  const locks={studio:['apps/studio/studio.js']};
  assert.equal(checkHotFiles({'apps/studio/studio.js':{before:'a',after:'x'.repeat(3000)}},locks).errors.length,1);
  assert.equal(checkHotFiles({'apps/studio/studio.js':{before:'a',after:'x\ny'}},locks).errors.length,1);
  assert.equal(checkHotFiles({'apps/studio/studio.js':{before:'a',after:'x'.repeat(3000)}},locks,['studio']).errors.length,0);
});
test('catalog has all 30 areas, explicit overlap accounting, deterministic CODEOWNERS',()=>{
  const catalog=readJSON(new URL('planning/catalog.json',root)),map=generateOwnership(catalog);
  assert.equal(Object.keys(map.areas).length,30);assert.equal(codeowners(map),codeowners(structuredClone(map)));
  catalog.areas[1].write.push('planning/contracts/**');assert.throws(()=>generateOwnership(catalog),/overlap/);
  assert.doesNotThrow(()=>generateOwnership(catalog,{contracts:{areas:['A00','A01'],paths:['planning/contracts/**']}}));
  catalog.areas.pop();assert.throws(()=>generateOwnership(catalog),/Missing area/);
});
test('path collisions require common declared lock, distinct siblings pass',()=>{
  const a={...task(1),paths:['apps/studio/studio.js']},b={...task(2),paths:['apps/studio/studio.js']};
  assert.equal(pathCollisions([a,b]).errors.length,1);
  a.lockKeys=b.lockKeys=['studio'];assert.equal(pathCollisions([a,b],{studio:['apps/studio/studio.js']}).errors.length,0);
  b.paths=['apps/studio/icons.js'];assert.equal(pathCollisions([a,b]).errors.length,0);
});
test('backlog lint names each violating issue and duplicate ID',()=>{
  const valid={...task(1),body:'**Area:** A00\n**Parent:** #2\n## Deliverable\nCode\n## Acceptance criteria\n- [ ] works\n**Owns:** `scripts/planning/test.js`'};
  assert.deepEqual(lintBacklog([valid]).errors,[]);
  const result=lintBacklog([valid,{...valid,number:2,body:''}]);assert(result.errors.every(e=>e.startsWith('#2:')));assert(result.errors.some(e=>e.includes('duplicate')));
});
test('bootstrap apply is idempotent and dry-run writes nothing; incompatible fields fail',async()=>{
  const fields=[],labels=[];const client={cachedProject:null,project:async()=>({id:'p',fields}),pages:async()=>labels,api:async(method,path,body)=>labels.push(body),graphql:async(query,v)=>fields.push({name:v.name,dataType:v.type})};
  const plan=await bootstrap(client);assert(plan.operations.length>0);assert.equal(fields.length+labels.length,0);
  await bootstrap(client,{dryRun:false});assert.equal((await bootstrap(client,{dryRun:false})).operations.length,0);
  assert.deepEqual(bootstrapPlan(REQUIRED_FIELDS,REQUIRED_LABELS).operations,[]);
  fields[0].dataType='NUMBER';await assert.rejects(bootstrap(client),/expected TEXT/);
});
test('snapshot preserves merged evidence and deterministic order; graph yields critical path',()=>{
  const issues=[{number:2,title:'[SF-A00-T02] second',body:'Depends on: SF-A00-T01',state:'OPEN',labels:[]},{number:1,title:'[SF-A00-T01] first',body:'',state:'CLOSED',labels:[],closedByPullRequestsReferences:{nodes:[{number:10,merged:true,baseRefName:'main',mergeCommit:{oid:sha}}]}}];
  const config={issues,updatedAt:'2026-10-03T12:00:00Z',repository:'test/repo'};
  const a=normalizeSnapshot(config),b=normalizeSnapshot({...config,issues:[...issues].reverse()});assert.deepEqual(a,b);
  const graph=exportDag(a);assert.equal(graph.length,2);assert.deepEqual(graph.criticalPath,['SF-A00-T01','SF-A00-T02']);assert.match(graph.mermaid,/SF_A00_T01 --> SF_A00_T02/);
  assert.equal(readiness(a,'SF-A00-T02').ready,true);
});
