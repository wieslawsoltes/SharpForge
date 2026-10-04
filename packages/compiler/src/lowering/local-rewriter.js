import {BoundTreeRewriter} from '../bound/rewriter.js';
import {BoundBlock,BoundTryStatement,BoundIfStatement,BoundWhileStatement,BoundLiteral,BoundCall,BoundBinaryOperator} from '../bound/nodes.js';
import {registeredFieldDescriptor} from '../symbols/registry-fields.js';
/**
 * The local rewriter: lowers statement and expression forms that have a direct expansion in terms of simpler
 * bound nodes. Framework members it needs come from the well-known member table (CS0656 when one is missing).
 *
 *   using (R r = e) body          ->  { R r = e; try body finally { if (r != null) r.Dispose(); } }
 *   foreach (T x in e) body       ->  { E en = e.GetEnumerator(); try { while (en.MoveNext()) { T x = en.Current; body } } finally { en.Dispose(); } }
 *     (pattern-based form only; array iteration is expanded by code generation)
 *   $"a{x,5:F2}"                  ->  "" + "a" + Formatting.FormatValue(x, "F2", 5, "<type>")
 *   boxing conversion             ->  Formatting.BoxValue(value, "<type>")
 *   await e                       ->  Async.Await(e)
 *
 * Synthesized nodes carry a syntax shape (`{kind,uri,start,end,...}`) so sequence points and scope ranges stay those
 * of the construct they came from.
 */
export class LocalRewriter extends BoundTreeRewriter {
  /** @param {object} context `{types(legacyName) -> TypeSymbol, wellKnown: WellKnownMembers, report(node,code,args)}`. */
  constructor(context){super();this.context=context;}
  visitFieldAccess(node) {
    const field = registeredFieldDescriptor(node.field);
    return field ? new BoundLiteral(node.syntax, {value: field.value}, node.type, {legacyType: field.type})
      : super.visitFieldAccess(node);
  }
  literal(value,legacyType){return new BoundLiteral(null,{value},this.context.types(legacyType),{legacyType});}
  /** A static call to a well-known runtime helper; null (after CS0656) when the helper is missing. */
  helperCall(id,syntax,args,legacyType){const method=this.context.wellKnown.get(id,syntax);return method?new BoundCall(null,{receiver:null,method,args,intrinsic:null},this.context.types(legacyType),{legacyType}):null;}
  visitUsingStatement(node){
    const syntax=node.syntax;let body=this.visit(node.body);
    for(let i=node.resources.length-1;i>=0;i--){
      const resource=node.resources[i],d=resource.syntax,declaration=this.visit(resource.declaration),nullCheck=this.visit(resource.nullCheck),dispose=this.visit(resource.dispose);
      const guard=new BoundIfStatement({...d,debugHidden:true,kind:'If',condition:nullCheck.syntax},{condition:nullCheck,consequence:dispose,alternative:null});
      const cleanup=new BoundBlock({...d,kind:'Block'},{locals:[],statements:[guard]});
      body=new BoundBlock({...syntax,kind:'Block'},{locals:declaration.declarations.map(x=>x.local),statements:[declaration,new BoundTryStatement({...syntax,kind:'Try'},{tryBlock:body,catchBlocks:[],finallyBlock:cleanup})]});
    }
    return body;
  }
  visitForEachStatement(node){
    if(!node.enumerator)return super.visitForEachStatement(node);
    const e=node.enumerator,s=node.syntax,base={uri:s.uri,start:s.start,end:s.end},declaration=this.visit(e.declaration),moveNext=this.visit(e.moveNext),current=this.visit(e.current),body=this.visit(node.body),dispose=this.visit(e.dispose);
    const loop=new BoundWhileStatement({...base,kind:'While',labels:node.labels,condition:moveNext.syntax},{locals:[],condition:moveNext,body:new BoundBlock({...base,kind:'Block'},{locals:node.locals,statements:[current,body]}),labels:node.labels});
    return new BoundBlock({...base,kind:'Block'},{locals:[e.enumeratorLocal],statements:[declaration,new BoundTryStatement({...base,kind:'Try'},{tryBlock:loop,catchBlocks:[],finallyBlock:new BoundBlock({...base,kind:'Block'},{locals:[],statements:[dispose]})})]});
  }
  visitInterpolatedString(node){
    const string=this.context.types('string');let result=this.literal('','string');
    for(const part of node.parts){
      let operand;
      if(part.kind==='Literal')operand=part;
      else{const value=this.visit(part.value);operand=this.helperCall('SharpForge_Runtime_Formatting__FormatValue',node.syntax,[value,this.literal(part.format,'string'),this.literal(part.alignment,'int'),this.literal(value.legacyType,'string')],'string');if(!operand)return node;}
      result=new BoundBinaryOperator(null,{operator:'+',left:result,right:operand,isChecked:false,method:null,negate:false},string,{legacyType:'string'});
    }
    return result;
  }
  visitConversion(node){
    if(node.conversion?.kind!=='Boxing')return super.visitConversion(node);
    const operand=this.visit(node.operand);return this.helperCall('SharpForge_Runtime_Formatting__BoxValue',node.syntax,[operand,this.literal(operand.legacyType,'string')],node.legacyType)??node;
  }
  visitAwaitExpression(node){
    const expression=this.visit(node.expression);return new BoundCall(node.syntax,{receiver:null,method:node.awaiter,args:[expression],intrinsic:null},node.type,{legacyType:node.legacyType});
  }
}
