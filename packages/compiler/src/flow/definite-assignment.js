import {DiagnosticId} from '../diagnostics/codes.js';
import {computeReachableBlocks} from './reachability.js';
/**
 * Definite assignment analysis: a forward "must" data-flow analysis over the control-flow graph.
 *
 * The state at a program point is the set of variables that are assigned on every path to it; unreachable points
 * are "everything assigned". Because the graph expands &&, ||, !, ?: and constant conditions into branches, the
 * when-true / when-false states of the C# specification fall out of the ordinary join. try/finally and catch use
 * the state at the start of the protected region (see cfg.js).
 *
 * Reports: CS0165 (use of unassigned local), CS0269 (use of unassigned out parameter), CS0177 (out parameter not
 * assigned before leaving the method), and the unused-variable warnings CS0168 (declared but never used) and
 * CS0219 (assigned but its value is never used).
 * Struct field tracking (CS0170, CS0171) needs struct declarations and is not part of this profile yet.
 */
const isOut=v=>v.kind==='Parameter'&&v.refKind==='out';
const intersect=(a,b)=>{if(a===null)return b;if(b===null)return a;const result=new Set();for(const v of a)if(b.has(v))result.add(v);return result;};
/** False for an edge a constant operand of && or || never takes (see cfg.js). */
const flows=(from,to)=>{const t=from.terminator;if(t?.kind!=='branch'||!t.dead)return true;const live=t.dead==='whenTrue'?t.whenFalse:t.whenTrue;return live===to;};
const same=(a,b)=>a===b||a!==null&&b!==null&&a.size===b.size&&[...a].every(v=>b.has(v));
/**
 * A write counts as a use unless the value is a constant: Roslyn's rule, which keeps side-effecting initialisers
 * (`var x = Compute();`) from being reported as unused.
 */
export function writeConsideredUse(type,value){
  if(!value||value.hasErrors)return true;
  if(type&&type.isReferenceType&&type.specialType!=='System_String')return !(value.constantValue&&value.constantValue.value===null);
  if(value.constantValue)return false;
  switch(value.kind){
    case 'Conversion':return writeConsideredUse(null,value.operand);
    case 'DefaultExpression':return false;
    case 'ObjectCreationExpression':return !!(value.constructorMethod&&!value.constructorMethod.isImplicitlyDeclared)||value.initializers.length>0||value.collectionInitializers.length>0;
    default:return true;
  }
}
const nameNode=local=>{const s=local.syntax;return s?.nameSpan?{uri:s.uri,start:s.nameSpan.start,end:s.nameSpan.end}:s;};
/**
 * @param graph the control-flow graph.
 * @param {object} options `reachable` (from analyzeReachability; computed when omitted), `trackParameters`, `parameters` (the method's
 *   ParameterSymbols; out parameters start unassigned), `exitNode` (where CS0177 is reported for the method end).
 * @returns {{diagnostics:Array<{code,args,node}>, entryStates:Map, exitStates:Map, unassignedReads:Array}}
 *   `entryStates`/`exitStates` map each reachable block to its set of definitely assigned variables.
 */
export function analyzeDefiniteAssignment(graph,options={}){
  const reachable=options.reachable??computeReachableBlocks(graph),outParameters=(options.parameters??[]).filter(isOut),entryStates=new Map(),exitStates=new Map();
  // Locals and out parameters are tracked; region analysis also tracks ordinary parameters.
  const tracked=v=>v.kind==='Local'||isOut(v)||!!options.trackParameters&&v.kind==='Parameter'&&!v.isThis;
  const transfer=(block,state,onRead)=>{
    const s=new Set(state);
    for(const op of block.ops){
      if(!tracked(op.variable))continue;
      if(op.kind==='read'){if(!s.has(op.variable)){onRead?.(op);s.add(op.variable);}}
      else if(op.kind==='write')s.add(op.variable);else if(op.kind==='declare')s.delete(op.variable);
    }
    return s;
  };
  const entryOf=block=>{
    if(block===graph.entry)return new Set();let state=null,seen=false;
    for(const p of block.predecessors)if(reachable.has(p)&&exitStates.has(p)&&flows(p,block)){state=intersect(state,exitStates.get(p));seen=true;}
    for(const p of block.exceptionSources)if(reachable.has(p)&&entryStates.has(p)){state=intersect(state,entryStates.get(p));seen=true;}
    return seen?state:null;
  };
  // Iterate to a fixed point. States only shrink after their first computation, so this terminates.
  const order=graph.blocks.filter(b=>reachable.has(b));let changed=true,rounds=0;
  while(changed&&rounds++<1000){
    changed=false;
    for(const block of order){
      const entry=entryOf(block);if(entry===null)continue;
      if(!entryStates.has(block)||!same(entryStates.get(block),entry)){entryStates.set(block,entry);changed=true;}
      const exit=transfer(block,entry);if(!exitStates.has(block)||!same(exitStates.get(block),exit)){exitStates.set(block,exit);changed=true;}
    }
  }
  const diagnostics=[],unassignedReads=[],flagged=new Set();
  for(const block of order){
    if(!entryStates.has(block))continue;
    const exit=transfer(block,entryStates.get(block),op=>{if(flagged.has(op.node))return;flagged.add(op.node);unassignedReads.push(op);diagnostics.push({code:isOut(op.variable)?DiagnosticId.CS0269:DiagnosticId.CS0165,args:[op.variable.name],node:op.node.syntax??options.exitNode});});
    const leaves=block.terminator?.kind==='return'||block.terminator?.kind==='jump'&&block.terminator.target===graph.exit;
    if(leaves)for(const p of outParameters)if(!exit.has(p)){const node=block.terminator.node?.syntax??options.exitNode;if(!flagged.has(block.id+':'+p.name)){flagged.add(block.id+':'+p.name);diagnostics.push({code:DiagnosticId.CS0177,args:[p.name],node});}}
  }
  // Unused locals: every read counts, wherever it is; a write counts unless it stores a constant.
  const used=new Set(),written=new Set();
  for(const block of graph.blocks)for(const op of block.ops){
    if(op.variable.kind!=='Local')continue;
    if(op.kind==='read')used.add(op.variable);
    else if(op.kind==='write'&&!op.catchVariable){if(op.iteration){used.add(op.variable);continue;}written.add(op.variable);if(op.node?.hasErrors||writeConsideredUse(op.variable.type,op.value))used.add(op.variable);}
  }
  for(const local of graph.locals){
    if(used.has(local)||local.usedAsConstant||local.hidden||local.isCompilerGenerated||local.isUsing||local.isForEach||!local.syntax||local.syntax.uri===undefined||local.syntax.debugHidden||local.syntax.generated||local.type?.isErrorType?.())continue;
    diagnostics.push({code:written.has(local)?DiagnosticId.CS0219:DiagnosticId.CS0168,args:[local.name],node:nameNode(local)});
  }
  return {diagnostics,entryStates,exitStates,unassignedReads};
}
