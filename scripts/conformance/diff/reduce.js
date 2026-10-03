import {parse} from '../../../packages/syntax/src/index.js';
import {SourceText} from '../../../packages/text/src/index.js';
import {performance} from 'node:perf_hooks';
import {fixtureHash,sha256} from './fixtures.js';
import {differenceSignature} from './classify.js';
import {observeWithinBudget, ReductionBudgetExceeded} from './reduce-observation.js';
export function withSource(fixture,sourceText){const next={...fixture,sourceText};next.inputHash=fixtureHash(next);return next;}
function candidates(source,kind){
  const parsed=parse(new SourceText(source));if(parsed.diagnostics.some(d=>d.severity==='error'))return [];
  const ranges=[];const visit=node=>{if(!node||typeof node!=='object')return;for(const [key,value]of Object.entries(node)){if(Array.isArray(value)){if(key===(kind==='types'?'members':kind))for(const child of value)if((kind==='members'?child.kind!=='Class':kind==='types'?child.kind==='Class':true)&&Number.isInteger(child?.start)&&child.end>child.start){let start=child.start,end=child.end;const line=source.lastIndexOf('\n',start-1)+1,next=source.indexOf('\n',end);if(/^\s*$/.test(source.slice(line,start))&&/^\s*$/.test(source.slice(end,next<0?source.length:next))){start=line;end=next<0?source.length:next+1;}ranges.push({start,end});}for(const child of value)visit(child);}else if(value&&typeof value==='object')visit(value);}};visit(parsed.root);
  // Only nonoverlapping units are removed together; inner units receive later passes.
  const selected=[];for(const range of ranges.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start))if(!selected.some(s=>range.start<s.end&&range.end>s.start))selected.push(range);
  return selected.sort((a,b)=>a.start-b.start);
}
const remove=(source,ranges)=>ranges.sort((a,b)=>b.start-a.start).reduce((text,range)=>text.slice(0,range.start)+text.slice(range.end),source);
export async function reduceFixture(fixture,difference,observe,{signal,maxAttempts=128,timeoutMs=60000}={}){
  if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new RangeError('Positive reducer budgets required');
  if(['host','fixture-nondeterminism','unclassified'].includes(difference.class))throw new Error('Only deterministic compiler/runtime differences can be reduced');
  const signature=differenceSignature(difference),start=performance.now(),original=fixture.sourceText;let current=original,attempts=0,exhausted=false;
  const interesting=async source=>{
    if(signal?.aborted)throw Object.assign(new Error('Reduction cancelled'),{code:'cancelled'});
    if(attempts>=maxAttempts||performance.now()-start>=timeoutMs){exhausted=true;return false;}attempts++;
    let result;
    try {
      result = await observeWithinBudget(withSource(fixture, source), observe, {
        signal, timeoutMs: Math.max(1, timeoutMs - (performance.now() - start)),
      });
    } catch (error) {
      if (!(error instanceof ReductionBudgetExceeded)) throw error;
      exhausted = true;
      if (attempts === 1) throw error;
      return false;
    }
    return result.differences.some(d=>differenceSignature(d)===signature)&&!result.differences.some(d=>['host','fixture-nondeterminism','unclassified'].includes(d.class));
  };
  if(!await interesting(original))throw new Error('Original fixture does not reproduce the requested deterministic difference');
  const parseable=!parse(new SourceText(original)).diagnostics.some(d=>d.severity==='error');
  let changed=parseable;
  while(changed&&!exhausted){changed=false;for(const kind of ['members','statements','types']){let units=candidates(current,kind),partitions=2;while(units.length&&!exhausted){const size=Math.ceil(units.length/partitions),chunks=[];for(let at=0;at<units.length;at+=size)chunks.push(units.slice(at,at+size));const rotation=fixture.seed%chunks.length;let accepted=false;for(let i=0;i<chunks.length&&!exhausted;i++){const candidate=remove(current,chunks[(i+rotation)%chunks.length]);if(candidate.length<current.length&&await interesting(candidate)){current=candidate;units=candidates(current,kind);partitions=Math.max(2,partitions-1);accepted=changed=true;break;}}if(accepted)continue;if(partitions>=units.length)break;partitions=Math.min(units.length,partitions*2);}}}
  return {schemaVersion:1,seed:fixture.seed,signature,originalSHA256:sha256(original),reducedSHA256:sha256(current),source:current,attempts,beforeLines:original.trim().split(/\r?\n/).length,afterLines:current.trim().split(/\r?\n/).length,minimalAtStatementMemberGranularity:!exhausted&&parseable,budgetExhausted:exhausted,...(!parseable?{unsupported:'Parser cannot identify removable units in malformed source'}:{})};
}
