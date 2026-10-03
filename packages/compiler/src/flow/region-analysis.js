import {buildControlFlowGraph} from './cfg.js';
import {analyzeReachability,computeReachableBlocks,nestedStatementLists} from './reachability.js';
import {analyzeDefiniteAssignment} from './definite-assignment.js';
import {BoundBlock} from '../bound/nodes.js';
/**
 * Region analysis for IDE refactorings (extract method, inline, move declaration): what a run of statements reads,
 * writes, needs from outside and hands back, and how control enters and leaves it. The shape follows Roslyn's
 * AnalyzeDataFlow / AnalyzeControlFlow results.
 *
 * dataFlow:    variablesDeclared, readInside, writtenInside, readOutside, writtenOutside,
 *              dataFlowsIn  (read inside before the region itself assigns them on every path),
 *              dataFlowsOut (assigned inside and that value can still be read after the region),
 *              alwaysAssigned (assigned on every path through the region), captured (none: the profile has no lambdas)
 * controlFlow: startPointIsReachable, endPointIsReachable, returnStatements, exitPoints (return/break/continue that
 *              leave the region), entryPoints (none: there is no goto)
 *
 * A region is the statements of one statement list whose spans lie inside [start,end].
 */
const within=(syntax,start,end)=>!!syntax&&syntax.start>=start&&syntax.end<=end;
const userVariable=v=>v.kind==='Parameter'?!v.isThis:!v.isCompilerGenerated&&!v.hidden;
const byPosition=list=>[...list].sort((a,b)=>(a.syntax?.start??a.declaredAt??-1)-(b.syntax?.start??b.declaredAt??-1)||a.name.localeCompare(b.name));
/** The consecutive statements of one statement list that lie inside [start,end], innermost list first; [] when none do. */
export function regionStatements(body,start,end){
  const find=node=>{
    for(const list of nestedStatementLists(node)){
      const selected=list.filter(s=>s&&within(s.syntax,start,end));if(selected.length)return selected;
      for(const s of list)if(s?.syntax&&s.syntax.start<=start&&s.syntax.end>=end){const inner=find(s);if(inner.length)return inner;}
    }
    return [];
  };
  return body?find(new BoundBlock(null,{locals:[],statements:[body]})):[];
}
/**
 * @param body the bound method body.
 * @param {object} region `start`, `end` (source offsets) and optionally `parameters` (the method's ParameterSymbols).
 * @returns `{succeeded, statements, dataFlow, controlFlow}`; `succeeded` is false when the span selects no statements.
 */
export function analyzeRegion(body,{start,end,parameters=[]}={}){
  const statements=regionStatements(body,start,end),empty={variablesDeclared:[],readInside:[],writtenInside:[],readOutside:[],writtenOutside:[],dataFlowsIn:[],dataFlowsOut:[],alwaysAssigned:[],captured:[]};
  if(!statements.length)return {succeeded:false,statements,dataFlow:empty,controlFlow:{startPointIsReachable:false,endPointIsReachable:false,returnStatements:[],exitPoints:[],entryPoints:[]}};
  const from=statements[0].syntax.start,to=statements.at(-1).syntax.end,inside=op=>within(op.node?.syntax,from,to);
  const graph=buildControlFlowGraph(body),readInside=new Set(),writtenInside=new Set(),readOutside=new Set(),writtenOutside=new Set();
  for(const block of graph.blocks)for(const op of block.ops){if(!userVariable(op.variable)||op.kind==='declare')continue;const isInside=inside(op);(op.kind==='read'?(isInside?readInside:readOutside):(isInside?writtenInside:writtenOutside)).add(op.variable);}
  // Parameters are assigned by the caller: that is a write outside any region.
  for(const p of parameters)if(userVariable(p))writtenOutside.add(p);
  const variablesDeclared=[...graph.locals].filter(l=>userVariable(l)&&within(l.syntax,from,to));
  // The region on its own: reads that are not preceded by a definite assignment inside it need a value from outside.
  const region=new BoundBlock(null,{locals:[],statements}),regionGraph=buildControlFlowGraph(region),reachable=computeReachableBlocks(regionGraph),assignment=analyzeDefiniteAssignment(regionGraph,{reachable,trackParameters:true});
  const declared=new Set(variablesDeclared),dataFlowsIn=new Set(assignment.unassignedReads.map(op=>op.variable).filter(v=>userVariable(v)&&!declared.has(v)));
  const exitState=assignment.entryStates.get(regionGraph.exit)??new Set(),alwaysAssigned=[...writtenInside].filter(v=>exitState.has(v));
  // A value written inside flows out when some path from the write reaches a read outside the region before another write.
  const dataFlowsOut=new Set();
  for(const block of graph.blocks)block.ops.forEach((write,index)=>{
    if(write.kind!=='write'||!inside(write)||!userVariable(write.variable)||dataFlowsOut.has(write.variable))return;
    const variable=write.variable,seen=new Set(),work=[[block,index+1]];
    while(work.length){const [b,at]=work.pop();let killed=false;
      for(let i=at;i<b.ops.length;i++){const op=b.ops[i];if(op.variable!==variable)continue;if(op.kind==='read'){if(!inside(op)){dataFlowsOut.add(variable);work.length=0;killed=true;break;}}else if(op.kind==='write'||op.kind==='declare'){killed=true;break;}}
      if(!killed)for(const s of b.successors)if(!seen.has(s)){seen.add(s);work.push([s,0]);}
    }
  });
  for(const p of parameters)if(p.refKind&&p.refKind!=='none'&&p.refKind!=='in'&&writtenInside.has(p))dataFlowsOut.add(p);
  // Control flow: which jumps leave the region.
  const returnStatements=[],exitPoints=[];
  const visit=(node,loops)=>{
    if(!node)return;
    if(node.kind==='ReturnStatement'){returnStatements.push(node);exitPoints.push(node);return;}
    if(node.kind==='BreakStatement'){if(node.label?!loops.some(l=>l.labels?.includes(node.label)):!loops.length)exitPoints.push(node);return;}
    if(node.kind==='ContinueStatement'){if(node.label?!loops.some(l=>l.labels?.includes(node.label)):!loops.filter(l=>l.kind!=='SwitchStatement').length)exitPoints.push(node);return;}
    const isLoop=['WhileStatement','DoStatement','ForStatement','ForEachStatement'].includes(node.kind),isSwitch=node.kind==='SwitchStatement',inner=isLoop||isSwitch?[...loops,node]:loops;
    for(const list of nestedStatementLists(node))for(const s of list)visit(s,inner);
  };
  for(const s of statements)visit(s,[]);
  const whole=analyzeReachability(graph,body);
  return {succeeded:true,statements,
    dataFlow:{variablesDeclared:byPosition(variablesDeclared),readInside:byPosition(readInside),writtenInside:byPosition(writtenInside),readOutside:byPosition(readOutside),writtenOutside:byPosition(writtenOutside),dataFlowsIn:byPosition(dataFlowsIn),dataFlowsOut:byPosition(dataFlowsOut),alwaysAssigned:byPosition(alwaysAssigned),captured:[]},
    controlFlow:{startPointIsReachable:whole.isReachable(statements[0]),endPointIsReachable:reachable.has(regionGraph.exit),returnStatements,exitPoints,entryPoints:[]}};
}
