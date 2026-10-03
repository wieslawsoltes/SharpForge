import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { git, isMain, writeJSON, report } from './lib/io.js';
import { digest, artifactDigest, environment, runCommand, redact } from './lib/evidence.js';

export function captureEvidence({task,root=process.cwd(),command}) {
  if (!/^SF-A\d{2}-[TB]\d+(?:\.\d+)?$/.test(task)) throw new Error('Invalid task id');
  const area=task.split('-')[1];
  command ??= ['node','scripts/planning/run-tests.js','--area',area,'--','--test-reporter=tap'];
  if(command.some(arg=>redact(arg,root)!==arg)) throw new Error('Evidence commands must use portable paths outside home/checkout prefixes');
  const result=runCommand(command,root), env=environment(root), head=git(['rev-parse','HEAD'],root).trim();
  const files={'tests.tap':result.output,'environment.json':JSON.stringify(env,null,2)+'\n'};
  const evidenceDigest=artifactDigest({task,headCommit:head,command,summary:result.summary},files);
  const record={schemaVersion:1,task,headCommit:head,command,summary:result.summary,evidenceDigest,files:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,digest(text)]))};
  const directory=resolve(root,'artifacts/evidence',task); mkdirSync(directory,{recursive:true});
  for (const [name,text] of Object.entries(files)) writeFileSync(resolve(directory,name),text);
  writeJSON(resolve(directory,'evidence.json'),record);
  return record;
}
if(isMain(import.meta.url)) {
  const {values}=parseArgs({options:{task:{type:'string'},root:{type:'string',default:'.'}}});
  const record=captureEvidence(values); report({...record,errors:record.summary.exitCode===0?[]:['Task test command failed']});
}
