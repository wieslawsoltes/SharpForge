import { parseArgs } from 'node:util';
import { git, readJSON, isMain } from './lib/io.js';
import { environment, validateHandoff, summarizeCommands, cleanHead } from './lib/evidence.js';
import { captureEvidence, isEvidenceTask } from './capture-evidence.js';
import { GitHubProject } from './lib/github-project.js';

export async function handoff({root=process.cwd(),task,agent,issue,client,details,wip=false,remote='origin'}) {
  if (!isEvidenceTask(task) || !agent || !Number.isSafeInteger(Number(issue)) || Number(issue)<1) throw new Error('Task, agent and issue are required');
  const branch=git(['symbolic-ref','--short','HEAD'],root).trim();
  if (['main','master'].includes(branch)) throw new Error('Handoff requires an implementation branch');
  const dirty=git(['status','--porcelain','--untracked-files=all'],root).trim();
  if(dirty && !wip) throw new Error('Uncommitted changes; commit or use --wip');
  const initialHead=git(['rev-parse','HEAD'],root).trim();
  // Validate the supplied plan before the explicitly requested WIP commit. Results below
  // are always recaptured at the final clean commit, never re-attributed from old details.
  const initialCommands=(details?.commands??[]).map(({argv,summary},index)=>({argv,summary,headCommit:initialHead,evidenceDigest:details.evidenceDigests?.[index]??'0'.repeat(64),obligations:[]}));
  validateHandoff({...details,schemaVersion:1,task,agent,branch,headCommit:initialHead,environment:environment(root),commands:initialCommands,evidenceDigests:initialCommands.map(command=>command.evidenceDigest)});
  if(dirty) { git(['add','--all'],root); git(['commit','-m',`WIP handoff ${task}`],root); }
  const head=cleanHead(root),commands=[];
  for(const {argv} of initialCommands) {
    cleanHead(root,head);
    const captured=captureEvidence({task,root,command:argv});
    commands.push({argv,summary:captured.summary,headCommit:captured.headCommit,evidenceDigest:captured.evidenceDigest,obligations:captured.obligations});
  }
  const record=validateHandoff({...details,schemaVersion:1,task,agent,branch,headCommit:head,environment:environment(root),commands,testSummary:summarizeCommands(commands),evidenceDigests:commands.map(command=>command.evidenceDigest)});
  cleanHead(root,head);
  if(wip) git(['push',remote,`HEAD:refs/heads/${branch}`],root);
  const refs=git(['ls-remote',remote,`refs/heads/${branch}`],root).trim().split(/\s+/);
  if(refs[0]!==head) throw new Error('Head is not published at the recorded remote branch');
  cleanHead(root,head);
  const body='<!-- sharpforge-handoff:v1 -->\n```json\n'+JSON.stringify(record,null,2)+'\n```';
  const comment=await client.comment(Number(issue),body);
  return {record,comment:comment.html_url??comment.id};
}
if(isMain(import.meta.url)) {
  const {values}=parseArgs({options:{task:{type:'string'},agent:{type:'string'},issue:{type:'string'},details:{type:'string'},root:{type:'string',default:'.'},remote:{type:'string',default:'origin'},wip:{type:'boolean',default:false},owner:{type:'string',default:'wieslawsoltes'},repo:{type:'string',default:'SharpForge'}}});
  console.log(JSON.stringify(await handoff({...values,details:readJSON(values.details),client:new GitHubProject(values)}),null,2));
}
