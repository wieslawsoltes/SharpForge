import {bindLegacyTry, bindLegacyThrow} from './exception-statements.js';
import {DiagnosticId} from '../diagnostics/codes.js';
import {frameworkType} from '@sharpforge/framework';
import {typeText,usingSpan} from '../type-utils.js';
import {LocalDeclarationKind} from '../symbols/members.js';
import {directlyLabeledStatement} from './labeled-jumps.js';
import {BoundBadStatement,BoundNoOpStatement,BoundBlock,BoundLocalDeclaration,BoundMultipleLocalDeclarations,BoundExpressionStatement,BoundIfStatement,BoundWhileStatement,BoundDoStatement,BoundForStatement,BoundForEachStatement,BoundForEachEnumerator,BoundSwitchStatement,BoundSwitchSection,BoundSwitchLabel,BoundUsingStatement,BoundUsingResource,BoundReturnStatement,BoundBreakStatement,BoundContinueStatement,BoundCheckedStatement,BoundConditionalAccessAssignment} from '../bound/nodes.js';
/**
 * Statement binding: syntax to bound statements. Scopes are binder scopes (see binder.js); loops and switches are
 * tracked only to validate break/continue. Reachability (CS0161, CS0162, CS0163) and definite assignment are not
 * decided here - they are flow analysis over the bound tree this produces.
 *
 * `using` and pattern-based `foreach` keep their high-level shape (BoundUsingStatement, BoundForEachStatement with a
 * BoundForEachEnumerator); their parts are bound here in the order the lowered code evaluates them, and
 * lowering/local-rewriter.js assembles the try/finally and loop.
 */
export const StatementBinder=Base=>class StatementBinder extends Base {
  /** Binds the method body. */
  bindBody(){return this.bindStatement(this.m.node.body);}
  bindBlock(node,statements=node.statements){const previous=this.scopeNode;this.scopeNode=node;this.pushScope(node);const bound=this.bindStatementList(statements),locals=this.popScope();this.scopeNode=previous;return this.statement(BoundBlock,node,{locals,statements:bound});}
  /** Binds the statements of a block; a using declaration scopes over the statements that follow it. */
  bindStatementList(statements){
    const result=[];
    for(let i=0;i<statements.length;i++){const s=statements[i];if(s.kind==='UsingDeclaration'){result.push(this.bindStatement({...s,kind:'Using',body:{...s,kind:'Block',end:statements.at(-1)?.end??s.end,statements:statements.slice(i+1)}}));return result;}const bound=this.bindStatement(s);if(bound)result.push(bound);}
    return result;
  }
  bindStatement(node){
    if(!node)return null;
    if(node.kind==='Labeled')return this.bindStatement(directlyLabeledStatement(node,this.loops,(at,code,args)=>this.c.report(at,code,args)));
    if(node.kind==='ExpressionStatement'&&node.expression.kind==='Assignment'&&['ConditionalMember','ConditionalIndex'].includes(node.expression.left.kind))return this.bindConditionalAccessAssignment(node);
    switch(node.kind){
      case 'Block':return this.bindBlock(node);
      case 'Empty':return this.statement(BoundNoOpStatement,node,{});
      case 'Using':return this.bindUsing(node);
      case 'UsingDeclaration':this.c.report(node,DiagnosticId.CS1023);return this.statement(BoundBadStatement,node,{parts:[]},true);
      case 'Local':{
        if(node.declarations.some(d=>d.isConst&&d.type==='var'))this.c.report(node,DiagnosticId.CS0822);if(node.declarations.length>1&&node.declarations.some(d=>d.type==='var'))this.c.report(node,DiagnosticId.CS0819);
        const declarations=node.declarations.map(d=>{
          let declared=this.c.resolveType(d.type,d,true,this.m),initializer=null,initType;
          if(d.initializer){initializer=this.bindTyped(d.initializer,declared==='var'?null:declared);initType=initializer.legacyType;}
          if(declared==='var'){if(!d.initializer||initType==='null'||initType==='void')this.c.report(d,DiagnosticId.CS0818);declared=initType??'error';}
          if(declared==='void')this.c.report(d,DiagnosticId.CS1547);
          const local=this.local(d.name,declared,d,!!d.hidden,{synthesizedKind:d.synthesizedKind,noSymbol:!!d.synthesizedKind});const converts=!d.initializer||this.checkAssign(declared,initType,d);
          if(d.isConst&&!d.initializer)this.c.report(d,DiagnosticId.CS0145);else if(d.isConst){const value=this.constant(d.initializer);if(!value)this.c.report(d,DiagnosticId.CS0133,[d.name]);else local.constant={...value,type:declared};}
          return this.statement(BoundLocalDeclaration,d,{local,initializer},!converts);
        });
        return this.statement(BoundMultipleLocalDeclarations,node,{declarations});
      }
      case 'ExpressionStatement':{const expression=this.bindExpression(node.expression);if(!['Call','Await','Assignment','New'].includes(node.expression.kind)&&!(node.expression.kind==='Unary'&&['++','--'].includes(node.expression.operator)))this.c.report(node,DiagnosticId.CS0201);return this.statement(BoundExpressionStatement,node,{expression});}
      case 'If':{const condition=this.bindBool(node.condition),consequence=this.bindStatement(node.then)??this.statement(BoundNoOpStatement,null,{}),alternative=this.bindStatement(node.otherwise);return this.statement(BoundIfStatement,node,{condition,consequence,alternative});}
      case 'While':case 'Do':case 'For':{
        this.pushScope();let initializer=null,condition=null,increment=null;
        if(node.init)initializer=node.init.kind==='Local'?this.bindStatement(node.init):this.statement(BoundExpressionStatement,node.init,{expression:this.bindExpression(node.init)});
        this.loops.push({labels:node.labels??[]});
        if(node.kind!=='Do'&&node.condition)condition=this.bindBool(node.condition);
        const body=this.bindStatement(node.body)??this.statement(BoundNoOpStatement,null,{});
        if(node.increment)increment=this.bindExpression(node.increment);
        if(node.kind==='Do')condition=this.bindBool(node.condition);
        this.loops.pop();const locals=this.popScope(),labels=node.labels??[];
        return node.kind==='While'?this.statement(BoundWhileStatement,node,{locals,condition,body,labels}):node.kind==='Do'?this.statement(BoundDoStatement,node,{locals,body,condition,labels}):this.statement(BoundForStatement,node,{locals,initializer,condition,body,increment,labels});
      }
      case 'OverflowContext':return this.statement(BoundCheckedStatement,node,{isChecked:node.checked,body:this.inCheckedContext(node.checked,()=>this.bindStatement(node.body))});
      case 'Foreach':return this.bindForeach(node);
      case 'Break':case 'Continue':{
        if(node.label)this.c.requireFeature(node,15,'Labeled break and continue');
        const loop=node.label?[...this.loops].reverse().find(l=>l.labels?.includes(node.label)&&(node.kind!=='Continue'||!l.switch)):node.kind==='Continue'?[...this.loops].reverse().find(l=>!l.switch):this.loops.at(-1);
        if(loop&&this.finallyScopes.length&&!this.loops.slice(this.finallyScopes.at(-1)).includes(loop))this.c.report(this.c.firstToken(node),DiagnosticId.CS0157);if(!loop)this.c.report(node,DiagnosticId.CS0139);
        return this.statement(node.kind==='Break'?BoundBreakStatement:BoundContinueStatement,node,{label:node.label??null},!loop);
      }
      case 'Switch':return this.bindSwitchStatement(node);
      case 'Return':{
        if(this.finallyScopes.length)this.c.report(node,DiagnosticId.CS0157);let expression=null;
        if(node.expression){expression=this.bindTyped(node.expression,this.m.returnType);this.checkAssign(this.m.returnType,expression.legacyType,node);}else if(this.m.returnType!=='void')this.c.report(node,DiagnosticId.CS0126,[typeText(this.m.returnType)]);
        return this.statement(BoundReturnStatement,node,{expression});
      }
      case 'Throw':return bindLegacyThrow(this,node);
      case 'Try':return bindLegacyTry(this,node);
      default:this.c.report(node,DiagnosticId.SF2099,[node.kind]);return this.statement(BoundBadStatement,node,{parts:[]},true);
    }
  }
  bindForeach(node){
    const collectionType=this.infer(node.expression),getEnumerator=this.frameworkMethod(collectionType,'GetEnumerator',false),labels=node.labels??[];
    if(getEnumerator)return this.bindEnumeratorForeach(node,getEnumerator);
    this.pushScope();const expression=this.bindExpression(node.expression),arrayType=expression.legacyType;if(!arrayType.endsWith('[]'))this.c.report(node,DiagnosticId.CS1579,[typeText(arrayType),'GetEnumerator']);
    const element=arrayType.endsWith('[]')?arrayType.slice(0,-2):'error',local=this.local(node.name,node.type==='var'?element:this.c.resolveType(node.type,node,false,this.m),{...node,isIteration:true},false,{synthesizedKind:node.synthesizedKind,noSymbol:!!node.synthesizedKind});this.checkAssign(local.legacyType,element,node);
    this.loops.push({labels});const body=this.bindStatement(node.body)??this.statement(BoundNoOpStatement,null,{});this.loops.pop();const locals=this.popScope();
    return this.statement(BoundForEachStatement,node,{expression,enumerator:null,iterationVariable:local,locals,body,labels},!arrayType.endsWith('[]'));
  }
  /**
   * foreach over a type with GetEnumerator(): binds, in evaluation order, the enumerator declaration, MoveNext(),
   * the iteration variable declaration from Current, the body and Dispose().
   */
  bindEnumeratorForeach(node,getEnumerator){
    const name=this.syntheticName('$enumerator'),base={uri:node.uri,start:node.start,end:node.end},N=n=>({...base,kind:'Name',name:n}),M=(target,member)=>({...base,kind:'Member',target,name:member}),call=(target,member)=>({...base,kind:'Call',target:M(target,member),args:[]}),enumName=N(name),currentType=this.frameworkMethod(getEnumerator.result,'get_Current',false)?.result,labels=node.labels??[];
    const outer={...base,kind:'Block'},previous=this.scopeNode;this.scopeNode=outer;this.pushScope(outer);
    const declaration=this.bindStatement({...base,kind:'Local',declarations:[{...base,name,type:getEnumerator.result,hidden:true,synthesizedKind:'enumerator',initializer:call(node.expression,'GetEnumerator')}]});
    this.pushScope();this.loops.push({labels});const moveNext=this.bindBool(call(enumName,'MoveNext'));
    const inner={...base,kind:'Block'};this.scopeNode=inner;this.pushScope(inner);
    const current=this.bindStatement({...base,kind:'Local',declarations:[{...base,name:node.name,nameSpan:node.nameSpan,type:node.type==='var'?currentType:node.type,isIteration:true,synthesizedKind:node.synthesizedKind,initializer:M(enumName,'Current')}]}),body=this.bindStatement(node.body)??this.statement(BoundNoOpStatement,null,{});
    const locals=this.popScope();this.scopeNode=outer;this.loops.pop();this.popScope();
    this.finallyScopes.push(this.loops.length);const cleanup={...base,kind:'Block'};this.scopeNode=cleanup;this.pushScope(cleanup);
    const dispose=this.bindStatement({...base,kind:'ExpressionStatement',expression:call(enumName,'Dispose')});this.popScope();this.scopeNode=outer;this.finallyScopes.pop();
    const enumeratorLocal=this.popScope()[0];this.scopeNode=previous;
    return this.statement(BoundForEachStatement,node,{expression:null,enumerator:this.statement(BoundForEachEnumerator,null,{enumeratorLocal,declaration,moveNext,current,dispose}),iterationVariable:locals[0],locals,body,labels});
  }
  /** using (resources) body: binds declarations outermost first, then the body, then each `!= null` test and Dispose() innermost first. */
  bindUsing(node){
    if(node.resources.kind==='Local'&&node.resources.declarations.length>1&&node.resources.declarations.some(d=>d.type==='var'))this.c.report(node,DiagnosticId.CS0819);
    const declarations=node.resources.kind==='Local'?node.resources.declarations:[{...node.resources,kind:'Variable',name:this.syntheticName('$using'),type:'var',initializer:node.resources,hidden:true,synthesizedKind:'using'}];
    for(const d of declarations){
      const type=d.type==='var'?this.infer(d.initializer):this.c.typeName(d.type,this.m),owner=this.c.findType(type,this.m);if(!d.initializer)this.c.report(d,DiagnosticId.CS0210);
      if(!owner?.interfaces.includes('System.IDisposable')&&!(['network','bcl','bcl14'].includes(frameworkType(type)?.kind)&&this.framework.methods(type,'Dispose',false).some(m=>!m.parameters.length)))this.c.report(usingSpan(node,d),DiagnosticId.CS1674,[typeText(type)]);
    }
    const resources=[],bindLevel=index=>{
      if(index>=declarations.length)return this.bindStatement(node.body)??this.statement(BoundNoOpStatement,null,{});
      const d=declarations[index],block={...node,kind:'Block'},previous=this.scopeNode;this.scopeNode=block;this.pushScope(block);
      const declaration=this.bindStatement({...d,kind:'Local',declarations:[{...d,isUsing:true}]}),body=bindLevel(index+1);
      this.finallyScopes.push(this.loops.length);const cleanup={...d,kind:'Block'};this.scopeNode=cleanup;this.pushScope(cleanup);
      const name={...d,kind:'Name',name:d.name},nil={...d,kind:'Literal',type:'null',value:null},nullCheck=this.bindBool({...d,kind:'Binary',operator:'!=',left:name,right:nil});
      const dispose=this.bindStatement({...d,debugHidden:true,kind:'ExpressionStatement',expression:{...d,kind:'Call',target:{...d,kind:'Member',target:name,name:'Dispose'},args:[]}});
      this.popScope();this.finallyScopes.pop();this.popScope();this.scopeNode=previous;
      resources[index]=this.statement(BoundUsingResource,d,{declaration,nullCheck,dispose});return body;
    };
    const body=bindLevel(0);return this.statement(BoundUsingStatement,node,{resources,body});
  }
  bindSwitchStatement(node){
    const dispatch=this.bindSwitchDispatch(node,node.sections.map(s=>s.labels)),labels=node.labels??[];this.loops.push({switch:true,labels});this.pushScope();
    const sections=node.sections.map((section,i)=>this.statement(BoundSwitchSection,section,{switchLabels:dispatch.labels[i].map((pattern,j)=>this.statement(BoundSwitchLabel,section.labels[j]??null,{pattern})),statements:section.statements.map(s=>this.bindStatement(s)).filter(Boolean)}));
    this.loops.pop();const locals=this.popScope();return this.statement(BoundSwitchStatement,node,{expression:dispatch.expression,locals,sections,labels});
  }
  /** receiver?.member = value; (C# 14): evaluates the receiver once and assigns only when it is not null. */
  bindConditionalAccessAssignment(node){
    this.c.requireFeature(node,14,'Null-conditional assignment');const assignment=node.expression,left=assignment.left,type=this.infer(left.target),receiverLocal=this.temp(type),base={uri:node.uri,start:node.start,end:node.end,debugHidden:true};
    if(['int','double','bool','void'].includes(type))this.c.report(left,DiagnosticId.CS0023,['?',typeText(type)]);
    const receiver=this.bindExpression(left.target),bound=this.bindExpression({...assignment,left:{...left,kind:left.kind==='ConditionalMember'?'Member':'Index',target:{...base,kind:'BoundTemp',local:receiverLocal,type}}});
    return this.statement(BoundConditionalAccessAssignment,node,{receiver,receiverLocal,assignment:bound});
  }
};
