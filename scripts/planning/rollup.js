import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { validate } from './schema/validate.js';
import { readJSON, isMain, report } from './lib/io.js';
import { commitOnMain, verifyArtifact, invalidateEvidence } from './rollup-invalidation.js';

const evidenceSchema=JSON.parse(readFileSync(new URL('../../planning/contracts/evidence.schema.json',import.meta.url),'utf8'));
const key=record=>[record.capabilityId,record.leafId,record.platform,record.engine,record.specRevision].join('\0');
export function rollup({inventory,evidence,snapshot,revisions,ancestor,verified}) {
  if(inventory.schemaVersion!==1||!Array.isArray(inventory.rows)||!inventory.rows.length) throw new Error('A29 gap inventory denominator is required');
  const issues=new Map(), registry=new Set(), records=new Map(), seenRows=new Set();
  for(const revision of revisions.revisions) { if(registry.has(revision.id)) throw new Error(`Duplicate revision ${revision.id}`); registry.add(revision.id); }
  for(const issue of snapshot.issues) { if(issues.has(issue.id)) throw new Error(`Duplicate issue identity ${issue.id}`); issues.set(issue.id,issue); }
  for(const record of evidence) {
    validate(evidenceSchema,record);
    if(!registry.has(record.specRevision)) throw new Error(`Unregistered revision ${record.specRevision}`);
    if(records.has(key(record))) throw new Error(`Duplicate evidence obligation ${record.capabilityId}; select one explicit current record`);
    records.set(key(record),record);
  }
  const obligations=[], groups=new Map(), consumed=new Set();
  for(const row of [...inventory.rows].sort((a,b)=>a.id.localeCompare(b.id,'en'))) {
    if(!row.id||seenRows.has(row.id)) throw new Error(`Missing or duplicate inventory id ${row.id}`); seenRows.add(row.id);
    const issue=issues.get(row.leafId);
    if(!issue||snapshot.issues.some(item=>item.parent===row.leafId)) throw new Error(`Inventory row ${row.id} must map to a leaf`);
    if(row.area!==issue.area) throw new Error(`Inventory area mismatch ${row.id}`);
    for(const name of ['platforms','engines','specRevisions']) if(!Array.isArray(row[name])||!row[name].length||row[name].some(v=>typeof v!=='string'||!v)||new Set(row[name]).size!==row[name].length) throw new Error(`Invalid ${name} for ${row.id}`);
    const parents=[], visited=new Set(); let cursor=issue;
    while(cursor) {
      if(visited.has(cursor.id)) throw new Error(`Parent cycle at ${cursor.id}`); visited.add(cursor.id); parents.push(cursor.id);
      if(cursor.parent&&!issues.has(cursor.parent)) throw new Error(`Missing parent ${cursor.parent}`);
      cursor=issues.get(cursor.parent);
    }
    parents.push(row.area);
    for(const platform of [...row.platforms].sort()) for(const engine of [...row.engines].sort()) for(const specRevision of [...row.specRevisions].sort()) {
      if(!registry.has(specRevision)) throw new Error(`Unregistered inventory revision ${specRevision}`);
      const identity={capabilityId:row.id,leafId:row.leafId,platform,engine,specRevision}, record=records.get(key(identity));
      const obligation=record?invalidateEvidence(record,{issue,ancestor,verified}):{...identity,status:'unknown',invalidated:['no evidence']};
      if(record) consumed.add(key(record)); obligations.push(obligation);
      for(const id of parents) {
        const groupKey=[id,platform,engine,specRevision].join('\0');
        if(!groups.has(groupKey)) groups.set(groupKey,{id,kind:id===row.area?'Area':issues.get(id)?.kind??'Task',platform,engine,specRevision,total:0,pass:0,fail:0,unknown:0,unsupported:0});
        const group=groups.get(groupKey); group.total++; group[obligation.status]++;
      }
    }
  }
  const unconsumed=[...records.keys()].filter(k=>!consumed.has(k));
  if(unconsumed.length) throw new Error('Evidence does not match current inventory obligations: '+unconsumed.map(k=>k.split('\0').join('/')).join(', '));
  const sorted=[...groups].sort(([a],[b])=>a.localeCompare(b,'en')).map(([,group])=>({...group,fraction:{numerator:group.pass,denominator:group.total},percent:Math.round(group.pass/group.total*10000)/100,complete:group.pass===group.total}));
  const completeByScope=new Map();
  for(const group of sorted) completeByScope.set(group.id,(completeByScope.get(group.id)??true)&&group.complete);
  for(const group of sorted) group.scopeComplete=completeByScope.get(group.id);
  return {schemaVersion:1,denominator:'inventory capability × platform × engine × spec revision',groups:sorted,obligations,errors:[]};
}
export function rollupInputs(values) {
  const root=resolve(values.root??'.'), artifactIndex=readJSON(values.artifacts);
  return {inventory:readJSON(values.inventory),evidence:readJSON(values.evidence),snapshot:readJSON(values.snapshot??'planning/backlog.snapshot.json'),revisions:readJSON(values.revisions??'planning/contracts/spec-revisions.json'),ancestor:commit=>commitOnMain(commit,{root,main:values.main??'origin/main'}),verified:record=>artifactIndex[record.evidenceDigest]&&verifyArtifact(record,resolve(root,artifactIndex[record.evidenceDigest]))};
}
export const rollupOptions={root:{type:'string',default:'.'},inventory:{type:'string'},evidence:{type:'string'},artifacts:{type:'string'},snapshot:{type:'string'},revisions:{type:'string'},main:{type:'string',default:'origin/main'}};
if(isMain(import.meta.url)) { const {values}=parseArgs({options:rollupOptions}); report(rollup(rollupInputs(values))); }
