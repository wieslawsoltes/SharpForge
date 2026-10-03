import {DiagnosticId} from '../diagnostics/codes.js';
import {buildControlFlowGraph} from './cfg.js';
import {analyzeReachability} from './reachability.js';
import {analyzeDefiniteAssignment} from './definite-assignment.js';
/**
 * Runs flow analysis for one bound method body and reports its diagnostics through the compilation:
 * reachability (CS0161, CS0162, CS0163, CS8070) and definite assignment (CS0165, CS0177, CS0269, CS0168, CS0219).
 * Returns `{graph, reachability, assignment}` for the semantic model, or null when there is no body.
 */
const nameOf=node=>node.nameSpan?{uri:node.uri,start:node.nameSpan.start,end:node.nameSpan.end}:node;
export function analyzeMethodFlow(compilation,method,body,binder){
  if(!body)return null;
  const graph=buildControlFlowGraph(body),reachability=analyzeReachability(graph,body,{labelText:section=>compilation.caseLabel(section)});
  // Roslyn reports unreachable code on the first token of the statement and fall-through on the section's last label.
  for(const d of reachability.diagnostics)compilation.report(d.code===DiagnosticId.CS0162?compilation.firstToken(d.node):d.code===DiagnosticId.CS0163||d.code===DiagnosticId.CS8070?compilation.caseLabelSpan(d.node):d.node,d.code,d.args);
  if(method.returnType!=='void'&&reachability.endReachable)compilation.report(nameOf(method.node),DiagnosticId.CS0161,[method.qualifiedName]);
  const assignment=analyzeDefiniteAssignment(graph,{reachable:reachability.reachable,parameters:binder.methodSymbol.parameters,exitNode:method.node});
  for(const d of assignment.diagnostics)compilation.report(d.node,d.code,d.args);
  return {graph,reachability,assignment};
}
