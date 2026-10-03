import { parseArgs } from 'node:util';
import { git, readJSON, isMain } from './lib/io.js';
import { environment, validateHandoff } from './lib/evidence.js';
import { GitHubProject } from './lib/github-project.js';

export async function handoff({root=process.cwd(),task,agent,issue,client,details,wip=false,remote='origin'}) {
  if (!/^SF-A\d{2}-[TB]\d+(?:\.\d+)?$/.test(task??'') || !agent || !Number.isSafeInteger(Number(issue))) throw new Error('Task, agent and issue are required');
  const branch=git(['symbolic-ref','--short','HEAD'],root).trim();
  if (['main','master'].includes(branch)) throw new Error('Handoff requires an implementation branch');
  const dirty=git(['status','--porcelain'],root).trim();
  if(dirty && !wip) throw new Error('Uncommitted changes; commit or use --wip');
  // Validate metadata before making the explicitly requested WIP commit.
  let record=validateHandoff({...details,schemaVersion:1,task,agent,branch,headCommit:git(['rev-parse','HEAD'],root).trim(),environment:environment(root)});
  if(record.task!==task||record.agent!==agent||record.branch!==branch||record.headCommit!==git(['rev-parse','HEAD'],root).trim()) throw new Error('Details cannot override git identity');
  if(dirty) { git(['add','--all'],root); git(['commit','-m',`WIP handoff ${task}`],root); record={...record,headCommit:git(['rev-parse','HEAD'],root).trim()}; }
  // A replacement agent must be able to fetch the exact recorded object.
  if(wip) git(['push',remote,`HEAD:refs/heads/${branch}`],root);
  const refs=git(['ls-remote',remote,`refs/heads/${branch}`],root).trim().split(/\s+/);
  if(refs[0]!==record.headCommit) throw new Error('Head is not published at the recorded remote branch');
  validateHandoff(record);
  const body='<!-- sharpforge-handoff:v1 -->\n```json\n'+JSON.stringify(record,null,2)+'\n```';
  const comment=await client.comment(Number(issue),body);
  return {record,comment:comment.html_url??comment.id};
}
if(isMain(import.meta.url)) {
  const {values}=parseArgs({options:{task:{type:'string'},agent:{type:'string'},issue:{type:'string'},details:{type:'string'},root:{type:'string',default:'.'},remote:{type:'string',default:'origin'},wip:{type:'boolean',default:false},owner:{type:'string',default:'wieslawsoltes'},repo:{type:'string',default:'SharpForge'}}});
  console.log(JSON.stringify(await handoff({...values,details:readJSON(values.details),client:new GitHubProject(values)}),null,2));
}
