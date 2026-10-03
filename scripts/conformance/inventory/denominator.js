import { platforms, vmEngines } from './common.js';
const defaults={A00:'T01.2',A01:'T01.1',A02:'T20',A03:'T05',A04:'T07',A05:'T01.10',A06:'T06',A07:'T06',A08:'T03',A09:'T01',A10:'T01',A11:'T01',A12:'T01',A13:'T01',A14:'T06',A15:'T11',A16:'T12',A17:'T01',A18:'T12',A19:'T12',A20:'T06',A21:'T05',A22:'T01',A23:'T01',A24:'T01',A25:'T01',A26:'T12',A27:'T12.1',A28:'T12',A29:'T03.8'};
export function ownerFor(row) {
  if(row.leafId)return row.leafId;
  const type=row.owner??'', name=row.name??''; let task=defaults[row.area];
  if(row.area==='A03'&&row.key.startsWith('ecma:table:'))task='T01';
  if(row.area==='A04')task=/Interop/.test(type)?'T10':/\.Emit/.test(type)?'T09':/Assembly|Module|LoadContext/.test(type)?'T01':/Method|Constructor|Parameter|CustomAttribute|Field|Property|Event/.test(type)?'T08':'T07';
  if(row.area==='A06')task=/finaliz/i.test(row.key)?'T02':/weak/i.test(row.key)?'T03':/alloc/i.test(row.key)?'T04':'T06';
  if(row.area==='A07')task=/Guid/.test(type)?'T03':/DateOnly|TimeOnly|DateTimeOffset/.test(type)?'T05':/DateTime|TimeSpan/.test(type)?'T04':/Decimal|BigInteger/.test(type)?'T02':/Int\d|UInt\d|Double|Single|Boolean|Char|Byte/.test(type)?'T01':'T06';
  if(row.area==='A08')task=/Linq/.test(type)?'T08':/Concurrent/.test(type)?'T04':/Immutable|Frozen/.test(type)?'T05':/Comparer|Equality/.test(type)?'T02':/IEnumerator|IEnumerable/.test(type)?'T07':'T03';
  if(row.area==='A09')task=/Json/.test(type)?'T05':/Xml/.test(type)?'T06':/Compression/.test(type)?'T08':/Cryptography/.test(type)?'T09':/File|Directory|Path/.test(type)?'T02':/Reader|Writer/.test(type)?'T03':'T01';
  if(row.area==='A10')task=/Vector[234]/.test(type)?'T02':/Matrix|Quaternion/.test(type)?'T03':/Vector/.test(type)?'T04':'T01';
  if(row.area==='A11')task=/Monitor|Lock/.test(type)||name.includes('Monitor')?'T03':/Semaphore|Mutex|Event|Interlocked/.test(type)?'T04':/Channel/.test(type)?'T05':/Timer|ThreadPool|Thread$/.test(type)?'T06':'T01';
  if(row.area==='A12')task=/Uri|EndPoint/.test(type)?'T04':/WebSocket/.test(type)?'T03':/Header|Cookie/.test(type)?'T02':/Socket/.test(type)?'T07':'T01';
  return `SF-${row.area}-${task}`;
}
export function denominator(rows,snapshot) {
  const issues=new Map(snapshot.issues.map(issue=>[issue.id,issue])),parents=new Set(snapshot.issues.map(issue=>issue.parent));
  const result=rows.map(row=>{
    const leafId=ownerFor(row),issue=issues.get(leafId);
    if(!issue||parents.has(leafId)||issue.area!==row.area)throw new Error(`Invalid inventory owner ${leafId}: ${row.key}`);
    const engines=row.engines??(['BCL','WINUI','RUNTIME','DAP'].includes(row.domain)?vmEngines:row.domain==='CIL'?['js-cil-vm']:row.domain==='CSHARP'||row.domain==='DIAG'?['sharpforge-compiler']:['sharpforge-protocol']);
    return {id:row.gapId,leafId,area:row.area,platforms:row.platforms??platforms,engines,specRevisions:[row.specRevision]};
  });
  if(new Set(result.map(row=>row.id)).size!==result.length)throw new Error('Duplicate inventory capability ID');
  const areas=new Set(result.map(row=>row.area));for(let i=0;i<30;i++)if(!areas.has(`A${String(i).padStart(2,'0')}`))throw new Error(`Missing area A${i}`);
  return {schemaVersion:1,scope:'Reference member, language, opcode, protocol and concrete product capability obligations. Catalog dimensions are explicit; inventories are not behavioral evidence.',rows:result};
}
