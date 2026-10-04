import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isMain, writeJSON, report } from './lib/io.js';
import { digest, artifactDigest, environment, runCommand, redact, cleanHead, proofObligations, validateBundle } from './lib/evidence.js';

export const evidenceDirectory=(root,record)=>resolve(root,'artifacts/evidence',record.task,record.evidenceDigest);
export const isEvidenceTask=task=>typeof task==='string'&&/^SF-(?:A\d{2}-[TB]\d+|R\d{3}-[TB]\d{2})(?:\.\d+)?$/.test(task);
export function captureEvidence({task,root=process.cwd(),command,area}) {
  if (!isEvidenceTask(task)) throw new Error('Invalid task id');
  const taskArea=task.split('-')[1];
  if(area!==undefined&&(typeof area!=='string'||!/^A\d{2}$/.test(area))) throw new Error('Evidence area must be an Axx area id');
  if(command==null) {
    if(taskArea.startsWith('R')&&area===undefined) throw new Error('Release task capture requires --area or an explicit command');
    if(taskArea.startsWith('A')&&area!==undefined&&area!==taskArea) throw new Error('Evidence area does not match the task area');
    command=['node','scripts/planning/run-tests.js','--area',area??taskArea,'--','--test-reporter=tap'];
  }
  if(!Array.isArray(command)||command.some(arg=>typeof arg!=='string'||redact(arg,root)!==arg)) throw new Error('Evidence commands must use portable paths outside home/checkout prefixes');
  const head=cleanHead(root),env=environment(root);
  cleanHead(root,head);
  const result=runCommand(command,root);
  cleanHead(root,head);
  const obligations=proofObligations(result.output,result.summary);
  const files={'tests.tap':result.output,'stderr.log':result.stderr,'environment.json':JSON.stringify(env,null,2)+'\n'};
  const metadata={schemaVersion:2,task,headCommit:head,command,summary:result.summary,obligations};
  const evidenceDigest=artifactDigest(metadata,files);
  const record=validateBundle({...metadata,evidenceDigest,files:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,digest(text)]))});
  const directory=evidenceDirectory(root,record);mkdirSync(directory,{recursive:true});
  for (const [name,text] of Object.entries(files)) writeFileSync(resolve(directory,name),text);
  writeJSON(resolve(directory,'evidence.json'),record);
  return record;
}
if(isMain(import.meta.url)) {
  const {values}=parseArgs({options:{task:{type:'string'},area:{type:'string'},root:{type:'string',default:'.'}}});
  const record=captureEvidence(values); report({...record,artifactDirectory:`artifacts/evidence/${record.task}/${record.evidenceDigest}`,errors:record.summary.exitCode===0?[]:['Task test command failed']});
}
