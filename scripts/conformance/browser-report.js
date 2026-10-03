/** Merge measured cells without promoting emulation, local files or harnesses. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const CATEGORIES={http:'served',https:'served',isolated:'served',file:'served','in-memory':'harness',deployed:'deployed',hardware:'hardware'};
const ENGINES=['chromium','firefox','webkit'];
const STATUSES=['passed','failed','known-failure','unexpected-pass','unsupported','cancelled'];
const assert=(value,message)=>{if(!value)throw new Error(message);};
export function validateCell(cell,{hardwareEvidence}={}) {
  assert(cell.schemaVersion===1,'Unsupported browser report schema');
  assert(ENGINES.includes(cell.engine),'Unknown engine');
  assert(cell.category===CATEGORIES[cell.mode],'Category does not match observed mode');
  assert(cell.source?.commit?.match(/^[a-f0-9]{40}$/),'Exact source revision required');
  assert(cell.platform&&cell.browserVersion&&cell.playwright,'Actual engine/platform versions required');
  assert(Array.isArray(cell.checks)&&cell.checks.length>0,'Empty cell cannot qualify');
  const ids=new Set();
  for(const row of cell.checks){assert(!ids.has(row.id)&&typeof row.id==='string','Duplicate/missing check ID');ids.add(row.id);assert(STATUSES.includes(row.status),'Invalid check status');if(row.status==='unsupported')assert(row.reason,'Unsupported check needs reason');}
  const passed=cell.checks.every(r=>['passed','unsupported'].includes(r.status));
  assert(cell.passed===passed,'Summary contradicts observed checks');
  assert(cell.parityPassed===cell.checks.every(r=>r.status==='passed'),'Parity summary contradicts observed checks');
  if(cell.mode==='deployed'){
    assert(cell.navigation?.url?.startsWith('https://'),'Deployed row needs actual HTTPS navigation');
    if(cell.passed)assert(cell.navigation.status===200&&cell.navigation.policy?.value,'Deployed qualification needs response and enforced policy');
  }
  if(cell.category==='hardware'||cell.hardwareQualified){
    assert(cell.category==='hardware'&&cell.mode==='hardware'&&cell.emulated===false,'Emulation cannot qualify hardware');
    assert(hardwareEvidence?.kind==='physical-device-observation'&&hardwareEvidence.deviceId&&hardwareEvidence.operator&&hardwareEvidence.observedAt,'Physical device evidence record required');
    for(const key of ['engine','platform','browserVersion'])assert(hardwareEvidence[key]===cell[key],'Hardware target mismatch: '+key);
    assert(hardwareEvidence.commit===cell.source.commit,'Hardware revision mismatch');
    assert(hardwareEvidence.reportSha256===createHash('sha256').update(JSON.stringify(cell)).digest('hex'),'Hardware evidence digest does not bind report');
  }
  return cell;
}
export function mergeCells(cells,options={}) {
  const seen=new Set();const rows=cells.map(cell=>{
    validateCell(cell,{hardwareEvidence:options.hardwareEvidence?.[cell.hardwareEvidenceId]});
    const key=[cell.source.commit,cell.platform,cell.engine,cell.mode,cell.suite,cell.device??'desktop'].join('/');
    assert(!seen.has(key),'Duplicate qualification cell: '+key);seen.add(key);
    return {...cell,hardwareQualified:cell.category==='hardware',evidenceScope:cell.source.dirty?'development checkout':'committed checkout'};
  });
  return {schemaVersion:1,categories:['harness','served','deployed','hardware'],rows,
    summary:{cells:rows.length,passed:rows.filter(r=>r.passed).length,parityPassed:rows.filter(r=>r.parityPassed).length,hardware:rows.filter(r=>r.hardwareQualified).length},
    limitations:['Desktop device emulation is served-browser evidence, not physical mobile qualification.','HTTP/HTTPS/file modes remain separate cells.','Known failures and unsupported checks never count as parity passes.']};
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const args=process.argv.slice(2);const output=args.indexOf('--output');assert(output>=0&&args[output+1],'Usage: browser-report.js --output path result.json [...]');
  const path=resolve(args.splice(output,2)[1]);assert(args.length,'At least one measured result is required');
  const report=mergeCells(await Promise.all(args.map(async path=>JSON.parse(await readFile(path,'utf8')))));
  await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
}
