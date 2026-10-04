/**
 * Roslyn differential harness (SF-A02-T40).
 *
 * Runs every fixture through SharpForge and compares it with the pinned Roslyn result on five axes:
 *   diagnostics - the set of (code, start, length) of error-severity diagnostics is identical;
 *   warnings    - the same for warning-severity diagnostics (reported separately);
 *   bytecode    - output fixtures only: stdout of the bytecode VM equals Roslyn's program output;
 *   cil         - output fixtures only: stdout of the CIL VM over the assembly converted from the image equals it;
 *   directCil   - output fixtures only: stdout of the CIL VM over the assembly `compileToAssembly` emits from bound
 *                 trees, without the image, equals it (direct-cil-axis.js).
 * (Profile diagnostics next to a semantic analysis do not make a diagnostics fixture unsupported; they are not compared.)
 * A fixture `passed` when its errors match and, for output fixtures, both image back ends match; for diagnostics
 * fixtures the warnings must match as well. A fixture is `unsupported` - and can never pass on an image axis - when
 * the compiler crashes or reports a non-Roslyn (SFxxxx profile) diagnostic for it, or when its pin is missing or
 * stale. The direct-CIL axis does not depend on the image: a fixture `unsupported` there can pass on it.
 */
import {compile,compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {loadFixtures,loadPinned,fixtureHash} from './corpus-store.js';
import {runToEnd,compareRun,brief} from './run-program.js';
import {runDirectCilAxis} from './direct-cil-axis.js';

/** The comparison axes, in report order. */
export const AXES=Object.freeze(['diagnostics','warnings','bytecode','cil','directCil']);
/** The axes that depend on the bytecode image; an `unsupported` fixture passes none of them. */
export const IMAGE_AXES=Object.freeze(['diagnostics','warnings','bytecode','cil']);
const INSTRUCTION_BUDGET=20_000_000;
const key=d=>`${d[0]}@${d[1]}+${d[2]}`;
// The native capture uses Distinct after projecting code/span/severity; compare that same set on both sides.
const keys=(rows,severity)=>[...new Set(rows.filter(d=>d[3]===severity).map(key))].sort();
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

/**
 * Compare one fixture with its pinned Roslyn result.
 * Returns `{id,feature,kind,unsupported,diagnostics,warnings,bytecode,cil,directCil,passed,details}` where each axis
 * is true/false, or null when the axis does not apply (back ends of a diagnostics fixture).
 */
export function runFixture(fixture,pinned,options={}){
  const isOutput=fixture.kind==='output',backEnd=isOutput?false:null;
  const row={id:fixture.id,feature:fixture.feature,kind:fixture.kind,unsupported:false,diagnostics:false,warnings:false,bytecode:backEnd,cil:backEnd,directCil:backEnd,passed:false,details:{}};
  const unsupported=reason=>{row.unsupported=true;row.details.unsupported=reason;return row;};
  if(!pinned)return unsupported('no pinned Roslyn result; run tools/pin.mjs');
  if(pinned.hash!==fixtureHash(fixture)||pinned.kind!==fixture.kind)return unsupported('pinned Roslyn result is stale; run tools/pin.mjs');
  const compileOptions=fixture.langVersion?{langVersion:fixture.langVersion}:{};
  if(fixture.allowUnsafe)compileOptions.allowUnsafe=true;
  if(isOutput){const direct=runDirectCilAxis(fixture,pinned,compileOptions,options);row.directCil=direct.ok;if(!direct.ok)row.details.directCil=direct.detail;}
  let result;try{result=(options.compile??compile)(fixture.source,compileOptions);}catch(error){return unsupported('compiler crash: '+brief(error));}
  const actual=result.diagnostics.map(d=>[d.code,d.start,d.length,d.severity]);
  const foreign=actual.filter(d=>!/^CS\d{4}$/.test(String(d[0])));
  // A profile (SFxxxx) diagnostic means the program cannot run here. An output fixture is then unsupported. A diagnostics
  // fixture is still comparable when the semantic analysis ran: its C# diagnostics are what Roslyn's are compared with.
  if(foreign.length&&!(fixture.kind==='diagnostics'&&result.semantic?.analysed)){row.details.actual=actual.map(key);return unsupported('profile diagnostics '+[...new Set(foreign.map(d=>d[0]))].join(' '));}
  const comparable=actual.filter(d=>/^CS\d{4}$/.test(String(d[0])));
  for(const [axis,severity] of [['diagnostics','error'],['warnings','warning']]){
    // Roslyn reports some diagnostics without a location (start -1, e.g. CS5001): for those only the code is compared.
    const unlocated=new Set(pinned.diagnostics.filter(d=>d[1]<0).map(d=>d[0])),normalize=rows=>rows.map(d=>unlocated.has(d[0])?[d[0],-1,0,d[3]]:d);
    const want=keys(normalize(pinned.diagnostics),severity),got=keys(normalize(comparable),severity);row[axis]=same(want,got);
    if(!row[axis])row.details[axis]={missing:want.filter(k=>!got.includes(k)),unexpected:got.filter(k=>!want.includes(k))};
  }
  if(fixture.kind==='output'){
    if(!result.success||!result.image)row.details.bytecode=row.details.cil='compilation failed';
    else{
      const bytecode=compareRun(()=>runToEnd(new VirtualMachine(result.image,{maxInstructions:INSTRUCTION_BUDGET,virtualTime:true})),pinned);
      row.bytecode=bytecode.ok;if(!bytecode.ok)row.details.bytecode=bytecode.detail;
      const cil=compareRun(()=>{
        const il=(options.compileToIL??compileToIL)(fixture.source,{...compileOptions,includeDebug:false});
        if(!il.success||!il.assembly)throw new Error('CIL emission failed: '+il.diagnostics.filter(d=>d.severity==='error').map(d=>d.code+' '+d.message).join('; '));
        return runToEnd(new CilVirtualMachine(il.assembly,{maxInstructions:INSTRUCTION_BUDGET,virtualTime:true}));
      },pinned);
      row.cil=cil.ok;if(!cil.ok)row.details.cil=cil.detail;
    }
  }
  row.passed=row.diagnostics&&(fixture.kind==='output'?row.bytecode&&row.cil:row.warnings);
  return row;
}

/**
 * Run the whole corpus (or `options.fixtures`) and aggregate per feature.
 * Returns `{roslyn,features:{[id]:{total,passed,diagnostics,warnings,outputTotal,bytecode,cil,directCil,unsupported}},totals,fixtures:[row]}`;
 * `bytecode`/`cil`/`directCil` count passes out of `outputTotal`, the other counters are out of `total`.
 */
export function report(options={}){
  const fixtures=options.fixtures??loadFixtures(),pinned=options.pinned??loadPinned();
  const blank=()=>({total:0,passed:0,diagnostics:0,warnings:0,outputTotal:0,bytecode:0,cil:0,directCil:0,unsupported:0});
  const features={},totals=blank(),rows=[];
  for(const fixture of fixtures){
    const row=runFixture(fixture,pinned.results.get(fixture.id),options);rows.push(row);
    for(const bucket of [features[fixture.feature]??=blank(),totals]){
      bucket.total++;if(row.passed)bucket.passed++;if(row.diagnostics)bucket.diagnostics++;if(row.warnings)bucket.warnings++;if(row.unsupported)bucket.unsupported++;
      if(row.kind==='output'){bucket.outputTotal++;if(row.bytecode)bucket.bytecode++;if(row.cil)bucket.cil++;if(row.directCil)bucket.directCil++;}
    }
  }
  return {roslyn:pinned.meta,features,totals,fixtures:rows};
}

/** Readable per-feature pass-rate table for a `report()` result. */
export function formatReport(result){
  const percent=(n,d)=>d?`${n}/${d} ${String(Math.round(100*n/d)).padStart(3)}%`:'-';
  const header=['feature','passed','errors match','warnings match','bytecode','cil','direct cil','unsupported'];
  const output=(f,axis)=>percent(f[axis],f.outputTotal);
  const line=(name,f)=>[name,percent(f.passed,f.total),percent(f.diagnostics,f.total),percent(f.warnings,f.total),output(f,'bytecode'),output(f,'cil'),output(f,'directCil'),String(f.unsupported)];
  const body=[header,...Object.keys(result.features).sort().map(name=>line(name,result.features[name])),line('TOTAL',result.totals)];
  const widths=header.map((_,i)=>Math.max(...body.map(r=>r[i].length)));
  const text=body.map(r=>r.map((c,i)=>i?c.padStart(widths[i]):c.padEnd(widths[i])).join('  '));
  text.splice(1,0,widths.map(w=>'-'.repeat(w)).join('  '));text.splice(text.length-1,0,text[1]);
  return `Roslyn differential pass rates (pinned Roslyn ${result.roslyn?.version??'?'})\n`+text.join('\n');
}

/** The baseline a report would produce: per axis, the sorted ids of fixtures passing that axis. */
export function baselineOf(result){
  const baseline={};for(const axis of AXES)baseline[axis]=result.fixtures.filter(r=>r[axis]===true).map(r=>r.id).sort();return baseline;
}

/**
 * Compare a report with a baseline. Returns `{regressions,improvements,stale}`: `regressions` are baseline entries
 * that no longer pass (with the fixture's failure detail), `improvements` pass now but are not in the baseline, and
 * `stale` are baseline ids that no longer name a fixture on that axis.
 */
export function compareBaseline(result,baseline){
  const regressions=[],improvements=[],stale=[],rows=new Map(result.fixtures.map(r=>[r.id,r]));
  for(const axis of AXES){
    const expected=new Set(baseline[axis]??[]);
    for(const id of expected){const row=rows.get(id);if(!row||row[axis]===null)stale.push({axis,id});else if(row[axis]!==true)regressions.push({axis,id,detail:row.details.unsupported??row.details[axis]??null});}
    for(const row of result.fixtures)if(row[axis]===true&&!expected.has(row.id))improvements.push({axis,id:row.id});
  }
  return {regressions,improvements,stale};
}
