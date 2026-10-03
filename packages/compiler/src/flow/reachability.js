import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * Reachability analysis over the control-flow graph.
 *
 * `computeReachableBlocks` is the graph traversal; `analyzeReachability` turns it into the facts and diagnostics
 * that replace the syntactic `alwaysReturns` approximation:
 *   endReachable -> the caller reports CS0161 for a non-void method,
 *   CS0162 (warning) on the first statement of each unreachable region,
 *   CS0163 / CS8070 when control can fall out of a switch section (CS8070 for the last section).
 * Constant conditions prune edges while the graph is built, so `while (true)` without a break ends the method
 * and `if (false)` makes its body unreachable, as in Roslyn.
 */
/** The set of blocks control can reach from the entry block (catch and fault blocks follow their protected region). */
export function computeReachableBlocks(graph){
  const reachable=new Set(),work=[graph.entry];
  while(work.length){const block=work.pop();if(reachable.has(block))continue;reachable.add(block);for(const s of block.successors)if(!reachable.has(s))work.push(s);for(const b of graph.blocks)if(!reachable.has(b)&&b.exceptionSources.includes(block))work.push(b);}
  return reachable;
}
const isUserCode=node=>!!node.syntax&&node.syntax.uri!==undefined&&!node.syntax.debugHidden&&!node.syntax.generated;
/** The statement an unreachable-code warning is attached to: blocks and empty statements are skipped. */
function reportable(node){
  if(!node)return null;
  if(node.kind==='Block'){for(const s of node.statements){const r=reportable(s);if(r)return r;}return null;}
  if(node.kind==='CheckedStatement')return reportable(node.body);
  if(node.kind==='NoOpStatement')return null;
  return isUserCode(node)?node:null;
}
/** The statements directly nested in a statement, grouped as lists that execute in sequence. */
export function nestedStatementLists(node){
  switch(node.kind){
    case 'Block':return [node.statements];
    case 'IfStatement':return [[node.consequence],[node.alternative]];
    case 'WhileStatement':case 'DoStatement':case 'ForStatement':case 'ForEachStatement':case 'CheckedStatement':case 'UsingStatement':return [[node.body]];
    case 'SwitchStatement':return node.sections.map(s=>s.statements);
    case 'TryStatement':return [[node.tryBlock],...node.catchBlocks.map(c=>[c.body]),[node.finallyBlock]];
    default:return [];
  }
}
/**
 * @param graph the control-flow graph of `body`.
 * @param {object} options `labelText(sectionSyntax)` renders the last label of a switch section for CS0163/CS8070.
 * @returns {{reachable:Set, endReachable:boolean, isReachable:(statement)=>boolean, diagnostics:Array<{code,args,node}>}}
 */
export function analyzeReachability(graph,body,options={}){
  const reachable=computeReachableBlocks(graph),diagnostics=[];
  const startReachable=node=>{
    if(!node)return true;const blocks=graph.blocksOf(node);if(blocks.length)return blocks.some(b=>reachable.has(b));
    // Statements that do not begin a block of their own start where their first nested statement starts.
    for(const list of nestedStatementLists(node))for(const s of list)if(s)return startReachable(s);
    return true;
  };
  const visit=(list,containerReachable)=>{
    let previous=containerReachable;
    for(const s of list){
      if(!s)continue;const r=startReachable(s);
      if(!r&&previous){const at=reportable(s);if(at){diagnostics.push({code:DiagnosticId.CS0162,args:[],node:at.syntax});previous=false;}}else previous=r;
      for(const nested of nestedStatementLists(s))visit(nested,r);
    }
  };
  if(body&&!body.isExpression)visit([body],true);
  for(const end of graph.switchSectionEnds)if(end.open&&reachable.has(end.block)&&isUserCode(end.section))diagnostics.push({code:end.isLast?DiagnosticId.CS8070:DiagnosticId.CS0163,args:[options.labelText?.(end.section.syntax)??'case'],node:end.section.syntax});
  return {reachable,endReachable:reachable.has(graph.exit),isReachable:startReachable,diagnostics};
}
