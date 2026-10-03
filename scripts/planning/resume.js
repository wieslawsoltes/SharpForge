import { parseArgs, isDeepStrictEqual } from 'node:util';
import { git, readJSON, isMain, report } from './lib/io.js';
import { environment, validateHandoff, runCommand, cleanHead, proofObligations } from './lib/evidence.js';
import { GitHubProject } from './lib/github-project.js';

export function parseHandoff(body) {
  if(!body.startsWith('<!-- sharpforge-handoff:v1 -->\n')) return null;
  const match=body.match(/^<!-- sharpforge-handoff:v1 -->\n```json\n([\s\S]*)\n```\s*$/);
  if(!match) throw new Error('Malformed handoff comment');
  return validateHandoff(JSON.parse(match[1]));
}
export async function latestHandoff(client,issue) {
  const comments=await client.comments(issue);
  for(const comment of comments.slice().sort((a,b)=>b.id-a.id)) { const record=parseHandoff(comment.body); if(record) return record; }
  throw new Error('No handoff found');
}
export function resume({record,root=process.cwd(),remote='origin'}) {
  validateHandoff(record);
  if(git(['status','--porcelain','--untracked-files=all'],root).trim())throw new Error('Resume requires a clean working tree');
  git(['check-ref-format',`refs/heads/${record.branch}`],root);
  git(['fetch',remote,`refs/heads/${record.branch}`],root);
  git(['merge-base','--is-ancestor',record.headCommit,'FETCH_HEAD'],root);
  git(['checkout','--detach',record.headCommit],root);
  cleanHead(root,record.headCommit);
  const actualEnvironment=environment(root), divergences=[],results=[];
  for(const key of Object.keys(record.environment)) if(record.environment[key]!==actualEnvironment[key]) divergences.push(`environment.${key}: ${record.environment[key]} -> ${actualEnvironment[key]}`);
  for(const [index,{argv,summary,obligations}] of record.commands.entries()) {
    try {cleanHead(root,record.headCommit);} catch(error) {divergences.push(`command ${index}: ${error.message}`);break;}
    const actual=runCommand(argv,root);results.push(actual);
    if(!isDeepStrictEqual(summary,actual.summary)) divergences.push(`command ${index}: test summary differs`);
    try {actual.obligations=proofObligations(actual.output,actual.summary);if(!isDeepStrictEqual(obligations,actual.obligations))divergences.push(`command ${index}: target proofs differ`);} catch(error){divergences.push(`command ${index}: ${error.message}`);}
    try {cleanHead(root,record.headCommit);} catch(error) {divergences.push(`command ${index}: ${error.message}`);break;}
  }
  return {task:record.task,headCommit:record.headCommit,results,environment:actualEnvironment,divergences,errors:divergences};
}
if(isMain(import.meta.url)) {
  const {values}=parseArgs({options:{record:{type:'string'},issue:{type:'string'},root:{type:'string',default:'.'},remote:{type:'string',default:'origin'},owner:{type:'string',default:'wieslawsoltes'},repo:{type:'string',default:'SharpForge'}}});
  const record=values.record?readJSON(values.record):await latestHandoff(new GitHubProject(values),values.issue);
  report(resume({...values,record}));
}
