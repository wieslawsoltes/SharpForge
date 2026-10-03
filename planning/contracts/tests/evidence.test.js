import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../scripts/planning/lib/io.js';
import { captureEvidence } from '../../../scripts/planning/capture-evidence.js';
import { validateHandoff, artifactDigest } from '../../../scripts/planning/lib/evidence.js';
import { handoff } from '../../../scripts/planning/handoff.js';
import { latestHandoff, parseHandoff, resume } from '../../../scripts/planning/resume.js';
import { verifyArtifact, commitOnMain } from '../../../scripts/planning/rollup-invalidation.js';
import { FakeGitHub } from '../../../scripts/planning/testing/fake-github.js';
import { GitHubProject } from '../../../scripts/planning/lib/github-project.js';
import { Claims } from '../../../scripts/planning/lib/claims.js';

test('digest binds every TAP byte as well as task and commit; false aggregate handoff summaries rejected',()=>{
  const meta={task:'SF-A00-T11.3',headCommit:'a'.repeat(40),command:['node','--test'],summary:{tests:1,passed:1,failed:0,cancelled:0,skipped:0,exitCode:0}},files={'tests.tap':'ok 1\n','environment.json':'{}\n'};
  assert.notEqual(artifactDigest(meta,files),artifactDigest(meta,{...files,'tests.tap':'ok 1\n# changed\n'}));
  assert.notEqual(artifactDigest(meta,files),artifactDigest({...meta,headCommit:'b'.repeat(40)},files));
});

test('fake HTTP handoff plus fresh real clone reproduces captured test results; WIP pushed before comment',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'sf-handoff-')), root=join(directory,'source'), remote=join(directory,'remote.git'), clone=join(directory,'clone');
  mkdirSync(root); const g=args=>git(args,root), fake=new FakeGitHub(), server=await fake.listen();
  const client=new GitHubProject({owner:'test',transport:async request=>{
    const response=await fetch(`${server.url}/${request.path}`,{method:request.method,headers:{'content-type':'application/json'},body:request.body===undefined?undefined:JSON.stringify(request.body)}); if(!response.ok)throw Object.assign(Error(await response.text()),{status:response.status}); return response.json();
  }});
  try {
    git(['init','--bare',remote],directory);g(['init','-b','main']);g(['config','user.name','Fixture']);g(['config','user.email','fixture@example.test']);
    writeFileSync(join(root,'.gitignore'),'artifacts/\n');writeFileSync(join(root,'sample.test.cjs'),"const {test}=require('node:test'); test('real test',()=>{});\n");
    g(['add','.']);g(['commit','-m','fixture']);g(['remote','add','origin',remote]);g(['push','origin','main']);g(['checkout','-b','codex/SF-A00-T07.1']);g(['push','-u','origin','HEAD']);
    const claims=new Claims(client), task={issue:1,agent:'replacement-fixture',branch:'codex/SF-A00-T07.1'};
    await claims.claim(task);await claims.lock({...task,key:'studio'});await claims.heartbeat(task);
    const command=['node','--test','--test-reporter=tap','sample.test.cjs'], captured=captureEvidence({task:'SF-A00-T07.1',root,command});
    const details={commands:[{argv:command,summary:captured.summary}],testSummary:captured.summary,blockers:[],remainingSteps:['release lease'],openQuestions:[],evidenceDigests:[captured.evidenceDigest]};
    const posted=await handoff({root,task:'SF-A00-T07.1',agent:task.agent,issue:1,client,details});
    const record=await latestHandoff(client,1);assert.deepEqual(record,posted.record);
    const wrongSummary=structuredClone(record);wrongSummary.testSummary.passed++;assert.throws(()=>validateHandoff(wrongSummary),/testSummary/);
    const missing=structuredClone(record);delete missing.environment;assert.throws(()=>validateHandoff(missing),/environment/);
    delete missing.headCommit;assert.throws(()=>validateHandoff(missing),/headCommit/);
    assert.throws(()=>parseHandoff('<!-- sharpforge-handoff:v1 -->\nwrong'),/Malformed/);
    const artifactDirectory=join(root,'artifacts/evidence/SF-A00-T07.1'), evidence={leafId:record.task,commit:record.headCommit,evidenceDigest:captured.evidenceDigest,status:'pass'};
    assert.equal(verifyArtifact(evidence,artifactDirectory),true);assert.equal(commitOnMain(record.headCommit,{root,main:'main'}),true);
    const tap=readFileSync(join(artifactDirectory,'tests.tap'),'utf8');assert.equal(tap.includes(homedir()),false);
    writeFileSync(join(artifactDirectory,'tests.tap'),tap+'# tampered\n');assert.equal(verifyArtifact(evidence,artifactDirectory),false);
    git(['clone',remote,clone],directory);const replay=resume({record,root:clone});assert.deepEqual(replay.divergences,[]);assert.equal(replay.results[0].summary.passed,1);
    writeFileSync(join(root,'partial.txt'),'partial');await assert.rejects(handoff({root,task:record.task,agent:task.agent,issue:1,client,details}),/Uncommitted/);
    const wip=await handoff({root,task:record.task,agent:task.agent,issue:1,client,details,wip:true});assert.notEqual(wip.record.headCommit,record.headCommit);assert.equal(g(['status','--porcelain']).trim(),'');
    const after=captureEvidence({task:record.task,root,command});assert.notEqual(after.evidenceDigest,captured.evidenceDigest);
    await claims.lock({...task,key:'studio',release:true});await claims.release(task);assert.equal(fake.refs.size,0);
  } finally {await server.close();rmSync(directory,{recursive:true,force:true});}
});
