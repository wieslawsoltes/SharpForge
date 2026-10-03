import {DiagnosticId} from './diagnostics/codes.js';
import {typeText} from './type-utils.js';
import {Op,Binary} from '@sharpforge/bytecode';
import {canonicalType,frameworkType,findContracts} from '@sharpforge/framework';
import {languageVersion as parseLangVersion} from '@sharpforge/syntax';
import {directlyLabeledStatement} from './binder/labeled-jumps.js';

/** Feature selection is not a claim that all features of that C# version are implemented. LangVersion spellings are parsed by @sharpforge/syntax. */
export function languageVersion(value='14') { return parseLangVersion(value); }

/** Modern-syntax layer (class mixin, composed in method-compiler.js). */
export const ModernCompiler=Base=>class ModernCompiler extends Base {
    canTarget(node,type){return node?.kind==='New'&&node.type==='<target>'&&type!=='object'||node?.kind==='CollectionExpression'&&(type?.endsWith('[]')||['List','HashSet'].includes(frameworkType(type)?.family));}
    typedExpr(node,type){
      if(node?.kind==='New'&&node.type==='<target>'){this.c.requireFeature(this.c.firstToken(node),9,'target-typed object creation');if(!type||['void','var','error','null','int','double','bool','string'].includes(type)){this.c.report(node,DiagnosticId.CS8754,['new()']);this.emitConstant(null);return 'error';}return this.expr({...node,type});}
      if(node?.kind==='CollectionExpression')return this.collectionExpression(node,type);
      if(node?.kind==='Conditional'&&type){return this.expr({...node,whenTrue:this.contextualize(node.whenTrue,type),whenFalse:this.contextualize(node.whenFalse,type)});}
      return this.expr(node);
    }
    contextualize(node,type){if(node?.kind==='New'&&node.type==='<target>'){this.c.requireFeature(this.c.firstToken(node),9,'target-typed object creation');return {...node,type};}if(node?.kind==='CollectionExpression')return {...node,targetType:type};return node;}
    infer(node){if(node?.kind==='BoundTemp')return node.type;if(node?.kind==='CollectionExpression')return node.targetType??'error';if(node?.kind==='New'&&node.type==='<target>')return 'error';return super.infer(node);}
    expr(node){
      if(node?.kind==='BoundTemp'){this.emit(Op.LDLOC,node.slot);return node.type;}
      if(node?.kind==='CollectionExpression')return this.collectionExpression(node,node.targetType);
      if(node?.kind==='New'&&node.type==='<target>')return this.typedExpr(node,null);
      if(['ConditionalMember','ConditionalIndex'].includes(node?.kind)||node?.kind==='Assignment'&&['ConditionalMember','ConditionalIndex'].includes(node.left.kind)){this.c.report(node,DiagnosticId.SF2141);this.emitConstant(null);return 'error';}
      return super.expr(node);
    }
    stmt(node){
      if(node?.kind==='Labeled')return this.stmt(directlyLabeledStatement(node,this.loops,(at,code,args)=>this.c.report(at,code,args)));
      if(node?.kind==='ExpressionStatement'&&node.expression.kind==='Assignment'&&['ConditionalMember','ConditionalIndex'].includes(node.expression.left.kind)){
        this.c.requireFeature(node,14,'Null-conditional assignment');const assignment=node.expression,left=assignment.left,type=this.infer(left.target),slot=this.temp(type),base={uri:node.uri,start:node.start,end:node.end,debugHidden:true};
        if(['int','double','bool','void'].includes(type))this.c.report(left,DiagnosticId.CS0023,['?',typeText(type)]);
        this.seq(node);this.expr(left.target);this.emit(Op.STLOC,slot);this.emit(Op.POP);this.emit(Op.LDLOC,slot);this.emitConstant(null);this.emit(Op.BINARY,Binary['!=']);const done=this.emit(Op.JFALSE),before=new Set(this.assigned);
        this.expr({...assignment,left:{...left,kind:left.kind==='ConditionalMember'?'Member':'Index',target:{...base,kind:'BoundTemp',slot,type}}});this.emit(Op.POP);this.assigned=before;this.patch(done);this.clear(slot);return;
      }
      return super.stmt(node);
    }
    collectionExpression(node,target){
      this.c.requireFeature(this.c.firstToken(node),12,'collection expressions');target=canonicalType(target);const array=target?.endsWith('[]'),t=frameworkType(target),element=array?target.slice(0,-2):t?.element;
      if(!element||!array&&!['List','HashSet'].includes(t?.family)){this.c.report(node,DiagnosticId.CS9176);this.emitConstant(null);return 'error';}
      if(node.arguments){this.c.requireFeature(node,15,'Collection expression constructor arguments');if(array||node.arguments.length!==1||node.arguments[0].name&&!['capacity'].includes(node.arguments[0].name))this.c.report(node,DiagnosticId.SF2143);}
      const owner=array?canonicalType('List<'+element+'>'):target,base={uri:node.uri,start:node.start,end:node.end,debugHidden:true},slot=this.temp(owner),temp={...base,kind:'BoundTemp',slot,type:owner},call=(name,args)=>({...base,kind:'Call',target:{...base,kind:'Member',target:temp,name},args});
      this.expr({...base,kind:'New',type:owner,args:node.arguments?.map(a=>a.expression)??[],initializers:[],collectionInitializers:[]});this.emit(Op.STLOC,slot);this.emit(Op.POP);
      for(const item of node.elements){
        if(item.kind==='SpreadElement'){
          const name='$spread'+this.locals.length;
          this.stmt({...item,kind:'Foreach',type:'var',name,expression:item.expression,body:{...base,kind:'ExpressionStatement',expression:call('Add',[{...base,kind:'Name',name}])}});
        }else{this.emit(Op.LDLOC,slot);this.checkAssign(element,this.typedExpr(item,element),item);this.emitContract(findContracts(owner,'Add',false).find(d=>d.parameters.length===1));this.emit(Op.POP);}
      }
      if(array)this.expr(call('ToArray',[]));else this.emit(Op.LDLOC,slot);this.clear(slot);return target;
    }
};
