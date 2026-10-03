import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { artifactDigest, digest, tapSummary, proofObligations, validateBundle, obligationKey } from './lib/evidence.js';
import { safePath } from './lib/paths.js';
import { validate } from './schema/validate.js';

const evidenceSchema=JSON.parse(readFileSync(new URL('../../planning/contracts/evidence.schema.json',import.meta.url),'utf8'));
export function commitOnMain(commit,{root=process.cwd(),main='origin/main'}={}) {
  if(!/^[a-f0-9]{40}$/.test(commit)) return false;
  return spawnSync('git',['merge-base','--is-ancestor',commit,main],{cwd:root,encoding:'utf8'}).status===0;
}
export function verifyArtifact(record,directory) {
  try {
    validate(evidenceSchema,record);
    const root=realpathSync(directory), load=name=>{
      const path=realpathSync(resolve(root,safePath(name)));
      if(!path.startsWith(root+sep)) throw new Error('Artifact escapes directory');
      return readFileSync(path,'utf8');
    };
    const metadata=validateBundle(JSON.parse(load('evidence.json')));
    if(metadata.task!==record.leafId||metadata.headCommit!==record.commit||metadata.evidenceDigest!==record.evidenceDigest) return false;
    const files=Object.fromEntries(Object.keys(metadata.files).sort().map(name=>[name,load(name)]));
    for(const [name,text] of Object.entries(files)) if(digest(text)!==metadata.files[name]) return false;
    if(artifactDigest(metadata,files)!==record.evidenceDigest||!isDeepStrictEqual(metadata.summary,tapSummary(files['tests.tap'],metadata.summary.exitCode))) return false;
    if(!isDeepStrictEqual(metadata.obligations,proofObligations(files['tests.tap'],metadata.summary))) return false;
    const proof=metadata.obligations.find(proof=>obligationKey(proof)===obligationKey(record));
    return Boolean(proof&&proof.status===record.status&&(proof.reason??null)===(record.reason??null));
  } catch { return false; }
}
export function invalidateEvidence(record,{issue,ancestor,verified}) {
  const reasons=[];
  if(!issue||issue.state!=='CLOSED') reasons.push('leaf is open, reopened or missing');
  if(!ancestor(record.commit)) reasons.push('evidence commit is not an ancestor of main');
  if(!verified(record)) reasons.push('evidence artifact is missing, changed or unverified for this target');
  return {...record,status:reasons.length?'unknown':record.status,invalidated:reasons};
}
