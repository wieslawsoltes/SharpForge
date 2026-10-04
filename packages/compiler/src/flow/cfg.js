import {appendCatchFlow} from './exception-filters.js';
/**
 * Control-flow graph construction over the bound tree (the binder's output, before lowering).
 *
 * A graph is a list of basic blocks. Each block holds, in evaluation order, the variable events of the code it
 * covers (`ops`: read / write / declare of a local or parameter, each with the bound node it came from) and the
 * bound statements that begin in it (`statements`). Blocks end in a terminator:
 *   {kind:'jump',target}  {kind:'branch',whenTrue,whenFalse,condition,dead}  {kind:'switch',targets}  {kind:'return',node}  {kind:'throw',node}  {kind:'end'}
 * Short-circuit operators, the conditional operator and constant conditions are expanded into branches, so both
 * reachability and definite assignment (with its when-true/when-false states) are plain forward analyses.
 *
 * try/finally is modelled by inlining a copy of the finally code on every path that leaves the protected region
 * (normal completion, break/continue/return) plus one exceptional copy that starts from the state at the start of
 * the try block and does not continue. Catch blocks likewise start from the state at the start of the try block.
 */
export class BasicBlock {
  /** `exceptionSources`: blocks whose entry state flows here when an exception leaves a protected region (catch and fault paths). */
  constructor(id){this.id=id;this.ops=[];this.statements=[];this.terminator=null;this.predecessors=[];this.exceptionSources=[];}
  get successors(){const t=this.terminator;return !t?[]:t.kind==='jump'?[t.target]:t.kind==='branch'?[t.whenTrue,t.whenFalse].filter(Boolean):[];}
}
export class ControlFlowGraph {
  constructor(){this.blocks=[];this.entry=null;this.exit=null;this.switchSectionEnds=[];this.locals=new Set();this.statementBlocks=new Map();}
  /** Blocks in which a bound statement starts (one per inlined copy of a finally block). */
  blocksOf(statement){return this.statementBlocks.get(statement)??[];}
}
const constantBool=node=>node.constantValue&&typeof node.constantValue.value==='boolean'?node.constantValue.value:null;
const isTemp=v=>v.synthesizedKind==='temp';
class Builder {
  constructor(){this.graph=new ControlFlowGraph();this.current=this.block();this.graph.entry=this.current;this.graph.exit=this.block();this.graph.exit.terminator={kind:'end'};this.jumps=[];this.finallyStack=[];}
  block(){const b=new BasicBlock(this.graph.blocks.length);this.graph.blocks.push(b);return b;}
  link(from,to){if(to&&!to.predecessors.includes(from))to.predecessors.push(from);}
  terminate(terminator){if(this.current.terminator)return;this.current.terminator=terminator;for(const s of this.current.successors)this.link(this.current,s);}
  jump(target){this.terminate({kind:'jump',target});}
  /** Continues in `block` (falling into it from the current block when that is still open). */
  start(block){if(!this.current.terminator)this.jump(block);this.current=block;return block;}
  /** Continues in a fresh block that nothing flows into: the code after a jump. */
  dead(){this.current=this.block();}
  op(kind,variable,node,extra){if(variable.kind==='Local'){if(isTemp(variable))return;this.graph.locals.add(variable);}this.current.ops.push({kind,variable,node,...extra});}
  // ---- expressions -------------------------------------------------------------------------------------------
  list(nodes){for(const n of nodes)this.expr(n);}
  /** Emits the events of evaluating an assignment target up to (not including) the store; returns the stored variable or null. */
  target(node){
    switch(node.kind){
      case 'Local':return node.local;case 'Parameter':return node.parameter;
      case 'FieldAccess':case 'PropertyAccess':if(node.receiver)this.expr(node.receiver);return null;
      case 'IndexerAccess':this.expr(node.receiver);this.list(node.args);return null;
      case 'ArrayAccess':this.expr(node.expression);this.expr(node.index);return null;
      default:this.expr(node);return null;
    }
  }
  expr(node){
    if(!node)return;
    switch(node.kind){
      case 'Local':this.op('read',node.local,node);return;
      case 'Parameter':this.op('read',node.parameter,node);return;
      case 'BinaryOperator':if(node.operator==='&&'||node.operator==='||'){const join=this.block(),yes=this.block(),no=this.block();this.condition(node,yes,no);this.current=yes;this.jump(join);this.current=no;this.jump(join);this.current=join;return;}this.expr(node.left);this.expr(node.right);return;
      case 'NullCoalescingOperator':{this.expr(node.left);const right=this.block(),join=this.block();this.terminate({kind:'branch',whenTrue:join,whenFalse:right,condition:null});this.current=right;this.expr(node.right);this.start(join);return;}
      case 'ConditionalOperator':{const yes=this.block(),no=this.block(),join=this.block();this.condition(node.condition,yes,no);this.current=yes;this.expr(node.consequence);this.jump(join);this.current=no;this.expr(node.alternative);this.start(join);return;}
      case 'AssignmentOperator':{const variable=this.target(node.left);this.expr(node.right);if(variable)this.op('write',variable,node,{value:node.right});return;}
      case 'CompoundAssignmentOperator':{const variable=this.target(node.left);if(variable)this.op('read',variable,node.left);this.expr(node.right);if(variable)this.op('write',variable,node,{value:null});return;}
      case 'IncrementOperator':{const variable=this.target(node.operand);if(variable){this.op('read',variable,node.operand);this.op('write',variable,node,{value:null});}return;}
      case 'NullCoalescingAssignmentOperator':{const variable=this.target(node.left);if(variable)this.op('read',variable,node.left);const right=this.block(),join=this.block();this.terminate({kind:'branch',whenTrue:join,whenFalse:right,condition:null});this.current=right;this.expr(node.right);if(variable)this.op('write',variable,node,{value:node.right});this.start(join);return;}
      case 'SwitchExpression':{
        this.expr(node.expression);const join=this.block();let dispatch=this.current,covered=false;
        for(const arm of node.arms){const body=this.block(),next=this.block();this.current=dispatch;this.terminate({kind:'branch',whenTrue:body,whenFalse:arm.pattern?next:null,condition:null});if(!arm.pattern)covered=true;this.current=body;this.expr(arm.value);this.jump(join);dispatch=next;}
        this.current=dispatch;if(!covered||!dispatch.predecessors.length)this.terminate({kind:'throw',node});this.current=join;return;}
      case 'CollectionExpression':this.expr(node.creation);for(const e of node.elements){if(e.kind==='CollectionSpread')this.stmt(e.statement);else this.expr(e.value);}if(node.conversion)this.expr(node.conversion);return;
      case 'Sequence':for(const e of node.sideEffects){if(e.isExpression)this.expr(e);else this.stmt(e);}this.expr(node.value);return;
      default:this.list(node.children);
    }
  }
  /**
   * Evaluates `node` as a condition and branches to `whenTrue` or `whenFalse`.
   * A condition that is a constant expression has only the edge it takes. A constant operand inside a non-constant
   * && or || (`false && b`) keeps both edges but marks the one it never takes as `dead`: Roslyn does not call the
   * guarded code unreachable (no CS0162), while definite assignment treats that edge as never taken.
   */
  condition(node,whenTrue,whenFalse,nested=false){
    const constant=constantBool(node);
    if(constant!==null&&!nested){if(node.kind==='BinaryOperator'&&(node.operator==='&&'||node.operator==='||'))this.list(node.children);else this.expr(node);this.jump(constant?whenTrue:whenFalse);return;}
    if(node.kind==='BinaryOperator'&&node.operator==='&&'){const mid=this.block();this.condition(node.left,mid,whenFalse,true);this.current=mid;this.condition(node.right,whenTrue,whenFalse,true);return;}
    if(node.kind==='BinaryOperator'&&node.operator==='||'){const mid=this.block();this.condition(node.left,whenTrue,mid,true);this.current=mid;this.condition(node.right,whenTrue,whenFalse,true);return;}
    if(node.kind==='UnaryOperator'&&node.operator==='!'){this.condition(node.operand,whenFalse,whenTrue,nested);return;}
    this.expr(node);this.terminate({kind:'branch',whenTrue,whenFalse,condition:node,dead:constant===null?null:constant?'whenFalse':'whenTrue'});
  }
  // ---- statements --------------------------------------------------------------------------------------------
  mark(node){this.current.statements.push(node);const list=this.graph.statementBlocks.get(node);if(list)list.push(this.current);else this.graph.statementBlocks.set(node,[this.current]);}
  /** Runs the finally code of every protected region between the current position and `depth`, innermost first. */
  leave(depth){for(let i=this.finallyStack.length-1;i>=depth;i--){const saved=this.finallyStack.splice(i);saved[0].emit();this.finallyStack.push(...saved);}}
  loop(labels,breakTarget,continueTarget,body){this.jumps.push({labels:labels??[],breakTarget,continueTarget,depth:this.finallyStack.length});body();this.jumps.pop();}
  /** try { body } finally { emitFinally }: `emitFinally` is replayed on every way out. */
  protect(body,emitFinally){
    const entry=this.block();this.start(entry);const region={emit:emitFinally};this.finallyStack.push(region);body();this.finallyStack.pop();
    const normal=this.current;
    // Exceptional path: the finally code runs from the state at the start of the protected region and rethrows.
    const exceptional=this.block();exceptional.exceptionSources.push(entry);this.current=exceptional;emitFinally();this.terminate({kind:'throw',node:null});
    this.current=normal;emitFinally();
  }
  stmt(node){
    if(!node)return;
    switch(node.kind){
      case 'Block':if(!node.statements.length)this.mark(node);for(const local of node.locals)if(!isTemp(local))this.graph.locals.add(local);for(const s of node.statements)this.stmt(s);return;
      case 'NoOpStatement':case 'BadStatement':this.mark(node);if(node.children)for(const c of node.children){if(c.isExpression)this.expr(c);else this.stmt(c);}return;
      case 'MultipleLocalDeclarations':this.mark(node);for(const d of node.declarations)this.stmt(d);return;
      case 'LocalDeclaration':if(node.initializer){this.expr(node.initializer);this.op('write',node.local,node,{value:node.initializer,declaration:true});}else this.op('declare',node.local,node);return;
      case 'ExpressionStatement':this.mark(node);this.expr(node.expression);return;
      case 'CheckedStatement':this.stmt(node.body);return;
      case 'IfStatement':{this.mark(node);const yes=this.block(),no=this.block(),join=this.block();this.condition(node.condition,yes,no);this.current=yes;this.stmt(node.consequence);this.jump(join);this.current=no;this.stmt(node.alternative);this.start(join);return;}
      case 'WhileStatement':{this.mark(node);const head=this.block(),body=this.block(),exit=this.block();this.start(head);this.condition(node.condition,body,exit);this.current=body;this.loop(node.labels,exit,head,()=>this.stmt(node.body));this.jump(head);this.current=exit;return;}
      case 'DoStatement':{this.mark(node);const body=this.block(),test=this.block(),exit=this.block();this.start(body);this.loop(node.labels,exit,test,()=>this.stmt(node.body));this.start(test);this.condition(node.condition,body,exit);this.current=exit;return;}
      case 'ForStatement':{
        this.mark(node);for(const local of node.locals)this.graph.locals.add(local);if(node.initializer){if(node.initializer.kind==='ExpressionStatement')this.expr(node.initializer.expression);else for(const d of node.initializer.declarations)this.stmt(d);}
        const head=this.block(),body=this.block(),step=this.block(),exit=this.block();this.start(head);if(node.condition)this.condition(node.condition,body,exit);else this.jump(body);
        this.current=body;this.loop(node.labels,exit,step,()=>this.stmt(node.body));this.start(step);if(node.increment)this.expr(node.increment);this.jump(head);this.current=exit;return;}
      case 'ForEachStatement':{
        this.mark(node);const head=this.block(),body=this.block(),exit=this.block(),e=node.enumerator;for(const local of node.locals)this.graph.locals.add(local);
        if(!e){this.expr(node.expression);this.start(head);this.terminate({kind:'branch',whenTrue:body,whenFalse:exit,condition:null});this.current=body;this.op('write',node.iterationVariable,node,{value:null,iteration:true});this.loop(node.labels,exit,head,()=>this.stmt(node.body));this.jump(head);this.current=exit;return;}
        this.graph.locals.add(e.enumeratorLocal);for(const d of e.declaration.declarations)this.stmt(d);
        this.protect(()=>{this.start(head);this.condition(e.moveNext,body,exit);this.current=body;for(const d of e.current.declarations){this.expr(d.initializer);this.op('write',d.local,node,{value:null,iteration:true});}this.loop(node.labels,exit,head,()=>this.stmt(node.body));this.jump(head);this.current=exit;},()=>this.expr(e.dispose.expression));
        return;}
      case 'SwitchStatement':{
        this.mark(node);this.expr(node.expression);for(const local of node.locals)this.graph.locals.add(local);const exit=this.block(),dispatch=this.current,entries=node.sections.map(()=>this.block()),hasDefault=node.sections.some(s=>s.switchLabels.some(l=>!l.pattern));
        // The dispatch reaches every section; without a default label it can also skip them all.
        dispatch.terminator={kind:'switch',targets:[...entries,...(hasDefault?[]:[exit])]};for(const t of dispatch.terminator.targets)this.link(dispatch,t);
        this.loop(node.labels,exit,null,()=>{node.sections.forEach((section,i)=>{this.current=entries[i];for(const s of section.statements)this.stmt(s);this.graph.switchSectionEnds.push({section,block:this.current,isLast:i===node.sections.length-1,open:!this.current.terminator});this.jump(exit);});});
        this.current=exit;return;}
      case 'TryStatement':{
        this.mark(node);const after=this.block();
        const guarded=()=>{
          const entry=this.block();this.start(entry);this.stmt(node.tryBlock);const ends=[this.current];
          for(const c of node.catchBlocks)appendCatchFlow(this,c,entry,ends);
          const join=this.block();for(const end of ends){this.current=end;this.jump(join);}this.current=join;
        };
        if(node.finallyBlock)this.protect(guarded,()=>this.stmt(node.finallyBlock));else guarded();
        this.start(after);return;}
      case 'UsingStatement':{
        const level=i=>{if(i>=node.resources.length){this.stmt(node.body);return;}const r=node.resources[i];this.stmt(r.declaration);for(const d of r.declaration.declarations)this.graph.locals.add(d.local);
          this.protect(()=>level(i+1),()=>{const dispose=this.block(),done=this.block();this.condition(r.nullCheck,dispose,done);this.current=dispose;this.expr(r.dispose.expression);this.start(done);});};
        this.mark(node);level(0);return;}
      case 'ReturnStatement':this.mark(node);this.expr(node.expression);this.leave(0);this.terminate({kind:'return',node});this.dead();return;
      case 'ThrowStatement':this.mark(node);this.expr(node.expression);this.terminate({kind:'throw',node});this.dead();return;
      case 'BreakStatement':case 'ContinueStatement':{
        this.mark(node);const isContinue=node.kind==='ContinueStatement',candidates=[...this.jumps].reverse(),target=node.label?candidates.find(j=>j.labels.includes(node.label)&&(!isContinue||j.continueTarget)):isContinue?candidates.find(j=>j.continueTarget):candidates[0];
        if(target){this.leave(target.depth);this.jump(isContinue?target.continueTarget:target.breakTarget);this.dead();}return;}
      case 'ConditionalAccessAssignment':{this.mark(node);this.expr(node.receiver);const assign=this.block(),join=this.block();this.terminate({kind:'branch',whenTrue:assign,whenFalse:join,condition:null});this.current=assign;this.expr(node.assignment);this.start(join);return;}
      default:this.mark(node);for(const c of node.children){if(c.isExpression)this.expr(c);else this.stmt(c);}
    }
  }
}
/**
 * Builds the control-flow graph of a bound method body (or of any bound statement).
 * The body's normal completion flows into `graph.exit`.
 */
export function buildControlFlowGraph(body){
  const b=new Builder();if(body){if(body.isExpression)b.expr(body);else b.stmt(body);}b.jump(b.graph.exit);
  // `switch` terminators list their targets; expose them through successors as well.
  for(const block of b.graph.blocks)if(block.terminator?.kind==='switch')Object.defineProperty(block,'successors',{value:block.terminator.targets});
  return b.graph;
}
