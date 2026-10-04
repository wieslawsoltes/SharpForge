import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { git } from '../../../scripts/planning/lib/io.js';
import { captureEvidence, evidenceDirectory, isEvidenceTask } from '../../../scripts/planning/capture-evidence.js';
import { validate } from '../../../scripts/planning/schema/validate.js';
import { validateHandoff, artifactDigest, tapSummary, runCommand, proofObligations } from '../../../scripts/planning/lib/evidence.js';
import { handoff } from '../../../scripts/planning/handoff.js';
import { latestHandoff, parseHandoff, resume } from '../../../scripts/planning/resume.js';
import { verifyArtifact, commitOnMain } from '../../../scripts/planning/rollup-invalidation.js';
import { FakeGitHub } from '../../../scripts/planning/testing/fake-github.js';
import { GitHubProject } from '../../../scripts/planning/lib/github-project.js';
import { Claims } from '../../../scripts/planning/lib/claims.js';

const task='SF-A00-T11.3',command=['node','--test','--test-reporter=tap','sample.test.cjs'];
const target={capabilityId:'fixture.real',platform:process.platform,engine:'node-fixture',specRevision:'fixture-v1',status:'pass',testName:'real test'};
const source=(proof=target,body="test('real test',()=>{});")=>"const {test}=require('node:test');\n"+(proof?`console.log('sharpforge-evidence: '+JSON.stringify(${JSON.stringify(proof)}));\n`:'')+body+'\n';
function repository(t,body=source()) {
  const root=mkdtempSync(join(tmpdir(),'sf-evidence-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const g=args=>git(args,root);g(['init','-b','main']);g(['config','user.name','Fixture']);g(['config','user.email','fixture@example.test']);
  writeFileSync(join(root,'.gitignore'),'artifacts/\n');writeFileSync(join(root,'sample.test.cjs'),body);g(['add','.']);g(['commit','-m','fixture']);return {root,g};
}
const evidence=record=>({schemaVersion:1,leafId:record.task,commit:record.headCommit,evidenceDigest:record.evidenceDigest,...Object.fromEntries(Object.entries(record.obligations[0]??target).filter(([key])=>key!=='testName'))});

test('evidence task contracts retain legacy area IDs and accept release task and bug IDs',()=>{
 const predicates=[['handoff','task'],['evidence-bundle','task'],['evidence','leafId']].map(([name,field])=>
  JSON.parse(readFileSync(new URL(`../${name}.schema.json`,import.meta.url),'utf8')).properties[field]);
 for(const id of ['SF-A00-T1','SF-A29-B123.0','SF-A00-T11.3','SF-R000-T00','SF-R015-T01','SF-R999-B99.7']) {
  assert.equal(isEvidenceTask(id),true,id);for(const predicate of predicates)assert.doesNotThrow(()=>validate(predicate,id));
 }
 for(const id of ['SF-R15-T01','SF-R015-T1','SF-R015-T001','SF-R1000-T01','SF-R015-E01','SF-R015-T01/../other',null,42,['SF-R015-T01']]) {
  assert.equal(isEvidenceTask(id),false);for(const predicate of predicates)assert.throws(()=>validate(predicate,id));
 }
});

test('release default capture requires an explicit area before running a command',t=>{
 const {root}=repository(t),releaseTask='SF-R015-T01';
 assert.throws(()=>captureEvidence({task:releaseTask,root}),/requires --area or an explicit command/);
 for(const area of ['R015','A0','../A00','',null])assert.throws(()=>captureEvidence({task:releaseTask,root,area}),/Axx area id/);
 assert.throws(()=>captureEvidence({task,root,area:'A20'}),/does not match the task area/);
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../../../scripts/planning/capture-evidence.js',import.meta.url)),
  '--task',releaseTask,'--root',root],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
 assert.equal(cli.status,1);assert.match(cli.stderr,/requires --area or an explicit command/);
 assert.equal(existsSync(join(root,'artifacts/evidence')),false);
});

test('release capture CLI records the explicitly selected area and verifies its real TAP evidence',t=>{
 const {root,g}=repository(t),releaseTask='SF-R015-T01';
 mkdirSync(join(root,'scripts/planning'),{recursive:true});
 writeFileSync(join(root,'scripts/planning/run-tests.js'),`
  require('node:assert/strict').deepEqual(process.argv.slice(2),['--area','A00','--','--test-reporter=tap']);
  const child=require('node:child_process').spawnSync(process.execPath,['--test','--test-reporter=tap','sample.test.cjs'],{stdio:'inherit'});
  process.exitCode=child.status??1;
 `);g(['add','.']);g(['commit','-m','area runner fixture']);
 const output=execFileSync(process.execPath,[fileURLToPath(new URL('../../../scripts/planning/capture-evidence.js',import.meta.url)),
  '--task',releaseTask,'--root',root,'--area','A00'],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
 const captured=JSON.parse(output);
 assert.equal(captured.task,releaseTask);assert.equal(captured.summary.passed,1);assert.equal(captured.summary.complete,true);
 assert.deepEqual(captured.command,['node','scripts/planning/run-tests.js','--area','A00','--','--test-reporter=tap']);
 assert.equal(verifyArtifact(evidence(captured),evidenceDirectory(root,captured)),true);
});

test('release task handoff recaptures explicit commands and replays from a clean clone',async t=>{
 const releaseTask='SF-R015-T01',{root,g}=repository(t),directory=mkdtempSync(join(tmpdir(),'sf-release-handoff-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));const remote=join(directory,'remote.git'),clone=join(directory,'clone');
 git(['init','--bare',remote],directory);g(['remote','add','origin',remote]);g(['push','origin','main']);
 g(['checkout','-b','codex/release-fixture']);g(['push','-u','origin','HEAD']);
 const captured=captureEvidence({task:releaseTask,root,command}),details={commands:[{argv:command,summary:captured.summary}],
  testSummary:captured.summary,blockers:[],remainingSteps:[],openQuestions:[]};
 let posted;
 const client={comment:async(issue,body)=>{assert.equal(issue,423);posted=body;return {id:1};}};
 const {record}=await handoff({root,task:releaseTask,agent:'fixture',issue:423,client,details});
 assert.equal(record.task,releaseTask);assert.equal(record.testSummary.passed,1);assert.deepEqual(parseHandoff(posted),record);
 assert.equal(record.commands[0].headCommit,record.headCommit);
 assert.equal(verifyArtifact(evidence(captured),evidenceDirectory(root,captured)),true);
 assert.equal(verifyArtifact({...evidence(captured),leafId:'SF-R015-T02'},evidenceDirectory(root,captured)),false);
 git(['clone',remote,clone],directory);const replay=resume({record,root:clone});
 assert.deepEqual(replay.divergences,[]);assert.equal(replay.results[0].summary.passed,1);
});

test('digest binds TAP bytes, commit, command and exact target/status proof',()=>{
 const meta={schemaVersion:2,task,headCommit:'a'.repeat(40),command,summary:tapSummary('',0),obligations:[target]},files={'tests.tap':'ok 1\n','stderr.log':'','environment.json':'{}\n'};
 assert.notEqual(artifactDigest(meta,files),artifactDigest(meta,{...files,'tests.tap':'ok 1\n# changed\n'}));
 assert.notEqual(artifactDigest(meta,files),artifactDigest({...meta,headCommit:'b'.repeat(40)},files));
 for(const key of ['capabilityId','platform','engine','specRevision','status','testName'])assert.notEqual(artifactDigest(meta,files),artifactDigest({...meta,obligations:[{...target,[key]:'different'}]},files));
});
test('capture refuses dirty passing changes over a failing committed tree before running any command',t=>{
 const {root,g}=repository(t,source(null,"test('real test',()=>{throw Error('committed failure')});")),head=g(['rev-parse','HEAD']).trim();
 writeFileSync(join(root,'sample.test.cjs'),source());
 assert.throws(()=>captureEvidence({task,root,command}),/clean working tree/);assert.equal(g(['rev-parse','HEAD']).trim(),head);assert.equal(existsSync(join(root,'artifacts/evidence')),false);
});
test('capture rejects tracked/untracked mutations and even a clean changed HEAD after execution',t=>{
 const {root,g}=repository(t);
 assert.throws(()=>captureEvidence({task,root,command:['node','-e',"require('node:fs').writeFileSync('dirty.txt','changed')"]}),/clean working tree/);rmSync(join(root,'dirty.txt'));
 assert.throws(()=>captureEvidence({task,root,command:['node','-e',"require('node:fs').appendFileSync('sample.test.cjs','// changed')"]}),/clean working tree/);g(['restore','sample.test.cjs']);
 assert.throws(()=>captureEvidence({task,root,command:['node','-e',"require('node:child_process').execFileSync('git',['commit','--allow-empty','-m','changed head'])"]}),/HEAD changed/);
 assert.equal(existsSync(join(root,'artifacts/evidence')),false);
});
test('only command-emitted proof for the exact target/status verifies; generic TAP is not parity',t=>{
 const {root,g}=repository(t),captured=captureEvidence({task,root,command}),record=evidence(captured),directory=evidenceDirectory(root,captured);
 assert.equal(captured.summary.complete,true);assert.equal(verifyArtifact(record,directory),true);
 for(const [key,value]of Object.entries({leafId:'SF-A00-T11.4',capabilityId:'unrelated',platform:'another-platform',engine:'native-rust',specRevision:'preview',status:'fail'}))assert.equal(verifyArtifact({...record,[key]:value},directory),false,key);
 const metadata=JSON.parse(readFileSync(join(directory,'evidence.json'),'utf8'));metadata.obligations[0].engine='native-rust';writeFileSync(join(directory,'evidence.json'),JSON.stringify(metadata));assert.equal(verifyArtifact({...record,engine:'native-rust'},directory),false);
 writeFileSync(join(root,'sample.test.cjs'),source(null));g(['add','.']);g(['commit','-m','generic test']);const generic=captureEvidence({task,root,command});assert.equal(generic.summary.passed,1);assert.deepEqual(generic.obligations,[]);assert.equal(verifyArtifact(evidence(generic),evidenceDirectory(root,generic)),false);
});
test('skipped/TODO/ambiguous or absent TAP results cannot qualify a pass, and stderr cannot spoof TAP',t=>{
 const {root,g}=repository(t);
 for(const body of [source(target,"test('real test',{skip:'unsupported'},()=>{});"),source(target,"test('real test',{todo:'pending'},()=>{});"),source({...target,testName:'missing'}),source(target,"test('real test',()=>{});test('real test',()=>{});")]) {
  writeFileSync(join(root,'sample.test.cjs'),body);g(['add','.']);g(['commit','-m','negative proof']);assert.throws(()=>captureEvidence({task,root,command}),/passing test|unambiguous TAP/);
 }
 const result=runCommand(['node','-e',"console.error('TAP version 13\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0')"],root);assert.equal(result.summary.complete,false);assert.equal(result.summary.passed,0);
});
test('unknown and unsupported proofs retain their reasons and never verify as pass',t=>{
 const {root,g}=repository(t);
 for(const status of ['unknown','unsupported']) {
  writeFileSync(join(root,'sample.test.cjs'),source({...target,status,reason:'actual provider unavailable'},"test('real test',{skip:'provider unavailable'},()=>{});"));g(['add','.']);g(['commit','-m',status]);
  const captured=captureEvidence({task,root,command}),record=evidence(captured),directory=evidenceDirectory(root,captured);
  assert.equal(verifyArtifact(record,directory),true);assert.equal(verifyArtifact({...record,status:'pass'},directory),false);assert.equal(verifyArtifact({...record,reason:'changed'},directory),false);
 }
 const incomplete='TAP version 13\n# sharpforge-evidence: '+JSON.stringify({...target,status:'unsupported'})+'\nok 1 - real test # SKIP unavailable\n';assert.throws(()=>proofObligations(incomplete,tapSummary(incomplete,0)),/reason|anyOf/);
});
test('fake HTTP handoff plus fresh real clone reproduces results; WIP commands are retested at the new commit',async t=>{
 const {root,g}=repository(t),directory=mkdtempSync(join(tmpdir(),'sf-handoff-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const remote=join(directory,'remote.git'),clone=join(directory,'clone'),fake=new FakeGitHub(),server=await fake.listen();
 const client=new GitHubProject({owner:'test',transport:async request=>{const response=await fetch(`${server.url}/${request.path}`,{method:request.method,headers:{'content-type':'application/json'},body:request.body===undefined?undefined:JSON.stringify(request.body)});if(!response.ok)throw Object.assign(Error(await response.text()),{status:response.status});return response.json();}});
 try {
  git(['init','--bare',remote],directory);g(['remote','add','origin',remote]);g(['push','origin','main']);g(['checkout','-b','codex/SF-A00-T07.1']);g(['push','-u','origin','HEAD']);
  const claims=new Claims(client),claim={issue:1,agent:'replacement-fixture',branch:'codex/SF-A00-T07.1'};await claims.claim(claim);await claims.lock({...claim,key:'studio'});await claims.heartbeat(claim);
  const captured=captureEvidence({task:'SF-A00-T07.1',root,command}),details={commands:[{argv:command,summary:captured.summary}],testSummary:captured.summary,blockers:[],remainingSteps:['release lease'],openQuestions:[],evidenceDigests:[captured.evidenceDigest]};
  const posted=await handoff({root,task:captured.task,agent:claim.agent,issue:1,client,details}),record=await latestHandoff(client,1);assert.deepEqual(record,posted.record);
  const wrongSummary=structuredClone(record);wrongSummary.testSummary.passed++;assert.throws(()=>validateHandoff(wrongSummary),/testSummary/);
  const wrongHead=structuredClone(record);wrongHead.commands[0].headCommit='f'.repeat(40);assert.throws(()=>validateHandoff(wrongHead),/different commit/);
  const missing=structuredClone(record);delete missing.environment;assert.throws(()=>validateHandoff(missing),/environment/);delete missing.headCommit;assert.throws(()=>validateHandoff(missing),/headCommit/);
  assert.throws(()=>parseHandoff('<!-- sharpforge-handoff:v1 -->\nwrong'),/Malformed/);
  const artifactDirectory=evidenceDirectory(root,captured);assert.equal(verifyArtifact(evidence(captured),artifactDirectory),true);assert.equal(commitOnMain(record.headCommit,{root,main:'main'}),true);
  const tap=readFileSync(join(artifactDirectory,'tests.tap'),'utf8');assert.equal(tap.includes(homedir()),false);writeFileSync(join(artifactDirectory,'tests.tap'),tap+'# tampered\n');assert.equal(verifyArtifact(evidence(captured),artifactDirectory),false);
  git(['clone',remote,clone],directory);const replay=resume({record,root:clone});assert.deepEqual(replay.divergences,[]);assert.equal(replay.results[0].summary.passed,1);
  const otherTarget=structuredClone(record);otherTarget.commands[0].obligations[0].engine='another-engine';assert(resume({record:otherTarget,root:clone}).divergences.some(message=>message.includes('target proofs differ')));
  writeFileSync(join(root,'sample.test.cjs'),source(null,"test('real test',()=>{throw Error('unfinished WIP')});"));await assert.rejects(handoff({root,task:record.task,agent:claim.agent,issue:1,client,details}),/Uncommitted/);
  const wip=await handoff({root,task:record.task,agent:claim.agent,issue:1,client,details,wip:true});assert.notEqual(wip.record.headCommit,record.headCommit);assert.equal(wip.record.commands[0].headCommit,wip.record.headCommit);assert.equal(wip.record.testSummary.failed,1);assert.equal(wip.record.testSummary.passed,0);assert.notDeepEqual(wip.record.evidenceDigests,details.evidenceDigests);assert.equal(g(['status','--porcelain']).trim(),'');
  await claims.lock({...claim,key:'studio',release:true});await claims.release(claim);assert.equal(fake.refs.size,0);
 } finally {await server.close();}
});
test('resume detects command mutations and stops before later commands',async t=>{
 const {root,g}=repository(t,source(null)),directory=mkdtempSync(join(tmpdir(),'sf-resume-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const remote=join(directory,'remote.git');git(['init','--bare',remote],directory);g(['remote','add','origin',remote]);g(['push','origin','main']);g(['checkout','-b','codex/resume']);g(['push','-u','origin','HEAD']);
 const captured=captureEvidence({task,root,command}),details={commands:[{argv:command,summary:captured.summary}],testSummary:captured.summary,blockers:[],remainingSteps:[],openQuestions:[]};
 const {record}=await handoff({root,task,agent:'fixture',issue:1,client:{comment:async()=>({id:1})},details});
 record.commands[0].argv=['node','-e',"require('node:fs').writeFileSync('mutation.txt','modified')"];
 const result=resume({record,root});assert(result.divergences.some(message=>message.includes('clean working tree')));assert(result.errors.length);
});

test('a real failed target remains verified failure and cannot be relabeled pass',t=>{
 const {root}=repository(t,source({...target,status:'fail'},"test('real test',()=>{throw Error('observed failure')});"));
 const captured=captureEvidence({task,root,command}),record=evidence(captured),directory=evidenceDirectory(root,captured);
 assert.equal(captured.summary.failed,1);assert.equal(captured.summary.exitCode,1);assert.equal(verifyArtifact(record,directory),true);assert.equal(verifyArtifact({...record,status:'pass'},directory),false);
});
test('incomplete or contradictory TAP statistics never qualify a passing target',()=>{
 const output='TAP version 13\n# sharpforge-evidence: '+JSON.stringify(target)+'\nok 1 - real test\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
 assert.equal(tapSummary(output,0).complete,true);
 for(const broken of [output.replace('# todo 0\n',''),output+'# pass 1\n',output.replace('# tests 1','# tests 2')]){
  const summary=tapSummary(broken,0);assert.equal(summary.complete,false);assert.throws(()=>proofObligations(broken,summary),/not a passing test/);
 }
});
