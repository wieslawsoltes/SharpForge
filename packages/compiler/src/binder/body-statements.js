/**
 * Statement binding for binder/body-binder.js (a mixin over BodyBinder): blocks and scopes, local declarations
 * (var inference, const, ref, using), control flow, switch, try/catch/finally, foreach over every enumeration
 * pattern, return/yield, local functions and labels. Each bound statement records `completes` - whether its end
 * point is reachable by the structured rules of the spec (constant conditions, jumps, loops with breaks) - which
 * drives CS0162 (unreachable code), CS0161 (not all paths return), CS0163 and CS8070 (switch fall-through).
 */
import {SymbolKind,TypeKind,RefKind,ErrorTypeSymbol,ArrayTypeSymbol} from '../symbols/types.js';
import {MethodSymbol,MethodKind,LocalDeclarationKind,ParameterSymbol,DeclarationModifiers,LabelSymbol,modifiersFromSyntax} from '../symbols/members.js';
import {declareTypeParameters,bindConstraintClauses} from '../symbols/source/type-parameters.js';
import {lookupMembers} from './inheritance.js';
import {findConstruction,implementsInterface} from '../symbols/substitution.js';
import {checkRefLocalInitializer,checkRefReturn,checkRefWritability,recordRefLocal} from './ref-locals.js';
import {checkAsyncOrIteratorUse,isRefLike,checkArrayElementType} from './ref-struct.js';
import {isNullableType} from '../conversions/nullable.js';
import {numericKind} from '../conversions/numeric.js';

const unknown=ErrorTypeSymbol.unknown;
const statementExpressionKinds=new Set(['InvocationExpression','ObjectCreationExpression','ImplicitObjectCreationExpression','PreIncrementExpression','PreDecrementExpression','PostIncrementExpression','PostDecrementExpression','AwaitExpression','ConditionalAccessExpression']);
const isSourceType=t=>{for(let s=t?.originalDefinition??t;s;s=s.containingSymbol)if(s.isSource)return true;return false;};
const stmt=(kind,syntax,completes,props)=>({kind,syntax,completes,...props});

export const statementMethods={
  isStatementExpression(syntax){while(syntax.kind==='ParenthesizedExpression')return false;return statementExpressionKinds.has(syntax.kind)||syntax.kind.endsWith('AssignmentExpression');},
  /** Binds a block with its own scope. Local functions and labels are visible in the whole block. */
  block(syntax,{statements=syntax.statements,scoped=true}={}){
    const pending=[];for(const s of statements)if(s.kind==='LocalDeclarationStatement')for(const v of s.declaration.variables)pending.push(v.identifier.valueText);
    if(scoped)this.pushScope(pending);else for(const n of pending)this.pending.at(-1).add(n);
    try{
      for(const s of statements)if(s.kind==='LocalFunctionStatement')this.declareLocalFunction(s);
      for(const s of statements)for(let l=s;l.kind==='LabeledStatement';l=l.statement)this.declareLabel(l);
      const bound=[];let reachable=true,warned=false;
      for(const s of statements){
        if(!reachable&&!warned&&s.kind!=='LocalFunctionStatement'&&s.kind!=='LabeledStatement'&&!this.usesGoto&&!this.hasLabels){this.report(s.firstToken()??s,'CS0162');warned=true;}
        if(s.kind==='LabeledStatement')reachable=true;
        const b=this.statement(s);bound.push(b);
        if(s.kind!=='LocalFunctionStatement'&&reachable)reachable=b.completes!==false;
      }
      return stmt('Block',syntax,reachable,{statements:bound});
    }finally{if(scoped)this.popScope();}
  },
  /** A statement in an embedded position (the body of if/while/...): declarations are not allowed there (CS1023). */
  embedded(syntax){
    if(syntax.kind==='LocalDeclarationStatement'||syntax.kind==='LocalFunctionStatement'||syntax.kind==='LabeledStatement'){this.report(syntax,'CS1023');this.pushScope();try{return this.statement(syntax);}finally{this.popScope();}}
    if(syntax.kind==='EmptyStatement'&&['IfStatement','ElseClause','WhileStatement','ForStatement','ForEachStatement','LockStatement','UsingStatement'].includes(syntax.parent?.kind))this.report(syntax,'CS0642');
    if(syntax.kind==='Block')return this.block(syntax);
    this.pushScope();try{return this.statement(syntax);}finally{this.popScope();}
  },
  statement(syntax){
    switch(syntax.kind){
      case 'Block':return this.block(syntax);
      case 'EmptyStatement':return stmt('Empty',syntax,true);
      case 'ExpressionStatement':{
        const e=this.expression(syntax.expression);let value=e;
        if(e.kind==='TypeExpression'||e.kind==='NamespaceExpression'){value=this.asValue(e);}
        else if(e.kind==='MethodGroup'&&!e.hasErrors){this.report(syntax.expression,'CS0201');value=this.bad(syntax.expression);}
        else if(!e.hasErrors&&!this.isStatementExpression(syntax.expression))this.report(syntax.expression,'CS0201');
        if(e.kind==='Call'&&!this.c.suppressUnawaited&&this.c.isAsync&&e.type&&(e.type.equals(this.core.task)||e.type.originalDefinition===this.core.taskT))this.report(syntax.expression,'CS4014');
        return stmt('ExpressionStatement',syntax,!(e.form==='throw'),{expression:value});
      }
      case 'LocalDeclarationStatement':return this.localDeclaration(syntax);
      case 'LocalFunctionStatement':return this.localFunction(syntax);
      case 'IfStatement':{
        const condition=this.condition(syntax.condition),constant=condition.constantValue?.type==='bool'?condition.constantValue.value:null;
        const then=this.embedded(syntax.statement),otherwise=syntax.else?this.embedded(syntax.else.statement):null;
        if(constant===false&&!this.usesGoto&&!this.hasLabels)this.unreachable(syntax.statement);
        if(constant===true&&syntax.else&&!this.usesGoto&&!this.hasLabels)this.unreachable(syntax.else.statement);
        const completes=constant===true?then.completes:constant===false?(otherwise?otherwise.completes:true):then.completes||(otherwise?otherwise.completes:true);
        return stmt('If',syntax,completes,{condition,then,otherwise});
      }
      case 'WhileStatement':{
        const condition=this.condition(syntax.condition),constant=condition.constantValue?.type==='bool'?condition.constantValue.value:null,loop=this.enterLoop();
        const body=this.embedded(syntax.statement);this.exitLoop();
        if(constant===false&&!this.usesGoto&&!this.hasLabels)this.unreachable(syntax.statement);
        return stmt('While',syntax,constant===true?loop.hasBreak:true,{condition,body});
      }
      case 'DoStatement':{
        const loop=this.enterLoop(),body=this.embedded(syntax.statement);this.exitLoop();
        const condition=this.condition(syntax.condition),constant=condition.constantValue?.type==='bool'?condition.constantValue.value:null;
        return stmt('Do',syntax,loop.hasBreak||constant!==true&&(body.completes||loop.hasContinue),{condition,body});
      }
      case 'ForStatement':{
        this.pushScope();
        try{
          const declaration=syntax.declaration?this.variableDeclaration(syntax.declaration,{}):null,initializers=syntax.initializers.map(e=>this.statementExpression(e));
          const condition=syntax.condition?this.condition(syntax.condition):null,constant=!condition?true:condition.constantValue?.type==='bool'?condition.constantValue.value:null;
          const incrementors=syntax.incrementors.map(e=>this.statementExpression(e)),loop=this.enterLoop(),body=this.embedded(syntax.statement);this.exitLoop();
          if(constant===false&&!this.usesGoto)this.unreachable(syntax.statement);
          return stmt('For',syntax,constant===true?loop.hasBreak:true,{declaration,initializers,condition,incrementors,body});
        }finally{this.popScope();}
      }
      case 'ForEachStatement':return this.forEach(syntax);
      case 'ForEachVariableStatement':{const collection=this.value(syntax.expression);this.pushScope();try{for(const d of this.designationsIn(syntax.variable))this.designation(d,unknown,{});this.incomplete=this.d.incomplete=true;const loop=this.enterLoop(),body=this.embedded(syntax.statement);this.exitLoop();return stmt('ForEach',syntax,true,{collection,body,loop});}finally{this.popScope();}}
      case 'SwitchStatement':return this.switchStatement(syntax);
      case 'ReturnStatement':return this.returnStatement(syntax);
      case 'ThrowStatement':{
        if(!syntax.expression){if(!this.catchDepth)this.report(syntax.throwKeyword,'CS0156');else if(this.finallyInCatch)this.report(syntax.throwKeyword,'CS0724');return stmt('Throw',syntax,false,{});}
        const e=this.value(syntax.expression);this.checkThrown(e,syntax.expression);return stmt('Throw',syntax,false,{expression:e});
      }
      case 'BreakStatement':{
        if(!this.loops?.length){this.report(syntax,'CS0139');return stmt('Break',syntax,false,{});}
        const target=this.loops.at(-1);target.hasBreak=true;if(this.finallyDepth>target.finallyDepth)this.report(syntax,'CS0157');return stmt('Break',syntax,false,{});
      }
      case 'ContinueStatement':{
        const target=[...(this.loops??[])].reverse().find(l=>l.isLoop);if(!target){this.report(syntax,'CS0139');return stmt('Continue',syntax,false,{});}
        target.hasContinue=true;if(this.finallyDepth>target.finallyDepth)this.report(syntax,'CS0157');return stmt('Continue',syntax,false,{});
      }
      case 'GotoStatement':case 'GotoCaseStatement':case 'GotoDefaultStatement':{
        this.usesGoto=true;this.rootBinder.usesGoto=true;
        if(syntax.kind==='GotoStatement'&&syntax.expression?.kind==='IdentifierName'){const name=syntax.expression.identifier.valueText,label=this.findLabel(name);if(!label)this.report(syntax.expression,'CS0159',[name]);else label.uses++;}
        else if(syntax.kind!=='GotoStatement'){if(!this.switchDepth)this.report(syntax,'CS0153');else{const sw=[...this.loops].reverse().find(l=>!l.isLoop);if(sw)sw.hasGotoCase=true;if(syntax.expression)this.value(syntax.expression);}}
        return stmt('Goto',syntax,false,{});
      }
      case 'LabeledStatement':{const inner=this.statement(syntax.statement);return stmt('Labeled',syntax,inner.completes,{label:syntax.identifier.valueText,statement:inner});}
      case 'CheckedStatement':case 'UncheckedStatement':{const saved=[this.checked,this.uncheckedContext];this.checked=syntax.kind==='CheckedStatement';this.uncheckedContext=!this.checked;try{const b=this.block(syntax.block);return stmt('Checked',syntax,b.completes,{isChecked:this.checked,block:b});}finally{[this.checked,this.uncheckedContext]=saved;}}
      case 'UnsafeStatement':{const b=this.block(syntax.block);return stmt('Unsafe',syntax,b.completes,{block:b});}
      case 'LockStatement':{
        const e=this.value(syntax.expression);if(!e.hasErrors&&e.type&&e.type.isReferenceType!==true)this.report(syntax.expression,'CS0185',[this.display(e.type)]);
        const body=this.embedded(syntax.statement);return stmt('Lock',syntax,body.completes,{expression:e,body});
      }
      case 'UsingStatement':{
        this.pushScope();
        try{
          let resources=null;
          if(syntax.declaration)resources=this.variableDeclaration(syntax.declaration,{isUsing:true,isAwait:!!syntax.awaitKeyword});
          else if(syntax.expression){const e=this.value(syntax.expression);this.checkDisposable(e.type,syntax.expression,!!syntax.awaitKeyword,e);resources=e;}
          const body=this.embedded(syntax.statement);return stmt('Using',syntax,body.completes,{resources,body});
        }finally{this.popScope();}
      }
      case 'TryStatement':return this.tryStatement(syntax);
      case 'YieldReturnStatement':case 'YieldBreakStatement':{
        this.c.isIterator=true;this.rootBinder.isIterator=true;
        if(syntax.kind==='YieldBreakStatement')return stmt('YieldBreak',syntax,false,{});
        const element=this.iteratorElementType(),e=this.value(syntax.expression);
        return stmt('YieldReturn',syntax,true,{expression:element?this.convert(e,element,syntax.expression):e});
      }
      case 'FixedStatement':{this.pushScope();try{const d=this.variableDeclaration(syntax.declaration,{isFixed:true});const body=this.embedded(syntax.statement);return stmt('Fixed',syntax,body.completes,{declaration:d,body});}finally{this.popScope();}}
      default:this.incomplete=this.d.incomplete=true;return stmt('Bad',syntax,true,{});
    }
  },
  unreachable(statement){const first=statement.kind==='Block'?statement.statements[0]:statement;if(first)this.report(first.firstToken()??first,'CS0162');},
  enterLoop(isLoop=true){this.loops??=[];const l={isLoop,hasBreak:false,hasContinue:false,finallyDepth:this.finallyDepth};this.loops.push(l);if(isLoop)this.loopDepth++;else this.switchDepth++;return l;},
  exitLoop(){const l=this.loops.pop();if(l.isLoop)this.loopDepth--;else this.switchDepth--;return l;},
  statementExpression(syntax){const e=this.expression(syntax);if(e.kind==='TypeExpression')return this.asValue(e);if(!e.hasErrors&&!this.isStatementExpression(syntax))this.report(syntax,'CS0201');return e;},
  declareLabel(syntax){const name=syntax.identifier.valueText,root=this;root.labels??=[];if(root.labels.some(l=>l.name===name)){this.report(syntax.identifier,'CS0140',[name]);return;}const label=new LabelSymbol({name,syntax});label.uses=0;label.binder=this;label.depth=this.scopes.length;root.labels.push(label);this.hasLabels=true;this.rootBinder.hasLabelsAnywhere=true;(this.rootBinder.allLabels??=[]).push({label,node:syntax.identifier,uri:this.c.uri});},
  findLabel(name){for(let b=this;b;b=b.c.isLambda||b.c.isLocalFunction?null:b.c.parent){const l=(b.labels??[]).find(x=>x.name===name&&x.depth<=b.scopes.length);if(l)return l;}return null;},
  localDeclaration(syntax){
    const modifiers=syntax.modifiers.map(m=>m.text),isConst=modifiers.includes('const'),isUsing=!!syntax.usingKeyword;
    const d=this.variableDeclaration(syntax.declaration,{isConst,isUsing,isAwait:!!syntax.awaitKeyword,isScoped:modifiers.includes('scoped')});
    return stmt('LocalDeclaration',syntax,true,{declarations:d});
  },
  /** `Type a = x, b = y` (locals, for-initializers, using and fixed declarations). */
  variableDeclaration(syntax,{isConst=false,isUsing=false,isAwait=false,isFixed=false,isScoped=false}){
    let typeSyntax=syntax.type,isRef=false,isRefReadonly=false;
    if(typeSyntax.kind==='ScopedType'){isScoped=true;typeSyntax=typeSyntax.type;}
    if(typeSyntax.kind==='RefType'){isRef=true;isRefReadonly=!!typeSyntax.readOnlyKeyword;typeSyntax=typeSyntax.type;}
    const bound=this.bindType(typeSyntax,{allowVar:true}),isVar=!!bound.isVar,declaredType=isVar?null:bound.type,results=[];
    if(isVar&&syntax.variables.length>1)this.report(syntax,'CS0819');
    if(declaredType&&declaredType.isStatic)this.report(typeSyntax,'CS0723',[this.display(declaredType)]);
    if(declaredType&&!declaredType.isErrorType()){const bad=checkAsyncOrIteratorUse(declaredType,'local',{isAsync:this.c.isAsync,isIterator:this.c.isIterator},this.version.number);if(bad)this.report(typeSyntax,bad.code,bad.args);if(declaredType instanceof ArrayTypeSymbol){const e=checkArrayElementType(declaredType.elementType);if(e)this.report(typeSyntax,e.code,e.args);}}
    for(const v of syntax.variables){
      const name=v.identifier.valueText,init=v.initializer?.value??null,kind=isConst?LocalDeclarationKind.Constant:isUsing?LocalDeclarationKind.Using:isFixed?LocalDeclarationKind.Fixed:LocalDeclarationKind.Regular;
      const local=this.newLocal(name,declaredType??unknown,v.identifier,kind,{refKind:isRef?(isRefReadonly?RefKind.RefReadOnly:RefKind.Ref):RefKind.None});local.isScoped=isScoped;
      let value=null;
      if(isVar){
        // `var x = x;` cannot see x: the initializer is bound before the local enters scope.
        this.pending.at(-1).add(name);
        if(!init){this.report(v.identifier,'CS0818');this.declare(name,local,v.identifier);results.push({local,value:null});continue;}
        if(init.kind==='ArrayInitializerExpression'){this.report(v.identifier,'CS0820');this.declare(name,local,v.identifier);results.push({local,value:null});continue;}
        value=this.value(isRef&&init.kind==='RefExpression'?init.expression:init);this.declare(name,local,v.identifier);
        if(!value.hasErrors){
          let type=value.type;
          if(value.noNaturalType){this.report(init,'CS0173',[this.operandDisplay(value.noNaturalType.left),this.operandDisplay(value.noNaturalType.right)]);type=null;value=this.bad(init);}
          else if(value.isTargetTypedSwitch){this.report(init.switchKeyword??init,'CS8506');type=null;value=this.bad(init);}
          else if(value.form==='lambda'||value.kind==='MethodGroup'){
            // C# 10: lambdas and method groups have a natural delegate type when it can be inferred.
            const natural=this.version.number>=10?(value.form==='lambda'?value.naturalType():value.methods.length===1&&!value.methods[0].arity?this.naturalGroupType(value):null):null;
            if(natural){const lambda=value;value=this.convert(value,natural,init);if(lambda.form==='lambda'&&!value.hasErrors)this.finishLambda(lambda,natural);type=natural;}
            else{this.report(v,this.version.number>=10?(value.form==='lambda'?'CS8917':'CS8917'):'CS0815',this.version.number>=10?[]:[value.form==='lambda'?(value.isAnonymousMethod?'anonymous method':'lambda expression'):'method group']);type=null;}
          }
          else if(!type){if(value.form==='collection')this.report(init,'CS9176');else if(value.form==='implicitNew')this.report(init,'CS8754',['new()']);else this.report(v,'CS0815',[value.literal==='null'?'<null>':value.literal==='default'?'default':value.kind==='Tuple'?'(...)':'?']);}
          else if(type.specialType==='System_Void'){this.report(v,'CS0815',['void']);type=null;}
          local.setType(type??unknown);
        }
      }else{
        this.declare(name,local,v.identifier);
        if(init){
          if(init.kind==='ArrayInitializerExpression'){
            if(declaredType instanceof ArrayTypeSymbol)value=this.node('ArrayCreation',init,declaredType,{elements:this.arrayInitializer(init,declaredType.elementType,declaredType.rank)});
            else{if(!declaredType.isErrorType())this.report(init,'CS0622');value=this.bad(init);}
          }else{
            const raw=this.value(isRef&&init.kind==='RefExpression'?init.expression:init);
            if(isRef){value=raw;if(!raw.hasErrors&&raw.type&&!raw.type.equals(declaredType)&&!declaredType.isErrorType())this.report(init,'CS8173',[this.display(declaredType)]);}
            else{value=this.convert(raw,declaredType,init);if(raw.form==='lambda'&&!value.hasErrors)this.finishLambda(raw,declaredType);}
          }
        }else if(isConst)this.report(v.identifier,'CS0145');
      }
      if(init||isRef){const r=checkRefLocalInitializer(isRef,init?.kind==='RefExpression',value&&!value.hasErrors?value:null,this.variableContext);
        if(r&&!(value?.hasErrors))this.report(r.code==='CS8174'?v.identifier:init??v,r.code,r.args);
        else if(isRef&&value&&!value.hasErrors){const w=checkRefWritability(value,isRefReadonly,this.variableContext);if(w)this.report(init,w.code,w.args);recordRefLocal(local,value,this.variableContext);}}
      if(init){local.writes++;local.hasInitializer=true;if(value&&!(value.constantValue||value.literal||value.kind==='Default'))local.nonConstantWrite=true;if(isUsing||isFixed)local.nonConstantWrite=true;}
      if(isConst&&value&&!value.hasErrors){
        const t=local.type;
        if(!value.constantValue){this.report(init,'CS0133',[name]);}
        else{local.constantValueObject=value.constantValue;local.hasConstantValue=true;}
        if(t&&!t.isErrorType()&&!(numericKind(t)||['System_Boolean','System_String','System_Char'].includes(t.specialType)||t.typeKind===TypeKind.Enum||t.isReferenceType===true))this.report(typeSyntax,'CS0283',[this.display(t)]);
      }
      if(isUsing&&local.type&&!local.type.isErrorType())this.checkDisposable(local.type,syntax,isAwait,value);
      results.push({local,value});
    }
    return results;
  },
  naturalGroupType(group){const m=group.methods[0];if(m.parameters.some(p=>p.refKind!==RefKind.None)||m.parameters.length>4)return null;const types=m.parameters.map(p=>p.type);return m.returnsVoid?(types.length?this.core.action(types.length).construct(types):this.core.action(0)):types.length>4?null:this.core.func(types.length+1).construct([...types,m.returnType]);},
  /** A `using` resource must convert to IDisposable (or, for ref structs, have a Dispose method; IAsyncDisposable for await using). */
  checkDisposable(type,node,isAwait,value){
    if(!type||type.isErrorType?.()||value?.hasErrors||value?.literal==='null')return;
    if(implementsInterface(type,this.core.idisposable,this.core))return;
    if(type.typeKind===TypeKind.TypeParameter&&type.constraintTypes.length)return;
    const pattern=lookupMembers(type,isAwait?'DisposeAsync':'Dispose',this.core,{}).members.some(m=>m.kind===SymbolKind.Method&&!m.isStatic&&m.parameters.every(p=>p.isOptional||p.isParams));
    if(pattern&&(isRefLike(type)||isAwait))return;
    // Registry types do not list their interfaces completely: only source types and primitives are known not to be disposable.
    if(!isSourceType(type)&&!numericKind(type)&&!['System_Boolean','System_String','System_Object','System_Char'].includes(type.specialType)&&!(type instanceof ArrayTypeSymbol)&&type.typeKind!==TypeKind.Enum){this.incomplete=this.d.incomplete=true;return;}
    this.report(node,isAwait?'CS8410':'CS1674',[this.display(type)]);
  },
  forEach(syntax){
    const collection=this.value(syntax.expression);this.pushScope();
    try{
      let element=null;const type=collection.type;
      if(!collection.hasErrors&&type&&!type.isErrorType()){
        if(type instanceof ArrayTypeSymbol)element=type.elementType;
        else if(type.specialType==='System_String')element=this.core.char;
        else{
          const getEnumerator=lookupMembers(type,'GetEnumerator',this.core,{within:this.c.containingType}).members.find(m=>m.kind===SymbolKind.Method&&!m.isStatic&&!m.parameters.length&&m.declaredAccessibility==='public');
          if(getEnumerator&&getEnumerator.returnType&&!getEnumerator.returnType.isErrorType()){const current=lookupMembers(getEnumerator.returnType,'Current',this.core,{}).members.find(m=>m.kind===SymbolKind.Property);if(current)element=current.type;else{const generic=findConstruction(getEnumerator.returnType,this.core.ienumeratorT,this.core);element=generic?generic.typeArguments[0].type:isSourceType(getEnumerator.returnType)?null:unknown;if(!element){this.report(syntax.expression,'CS0117',[this.display(getEnumerator.returnType),'Current']);element=unknown;}}}
          else{
            const generic=findConstruction(type,this.core.ienumerableT,this.core);
            if(generic)element=generic.typeArguments[0].type;
            else if(implementsInterface(type,this.core.ienumerable,this.core))element=this.core.object;
            else if(!isSourceType(type)&&type.typeKind!==TypeKind.TypeParameter&&!numericKind(type)&&!['System_Boolean','System_Object','System_Char'].includes(type.specialType)&&type.typeKind!==TypeKind.Enum){element=unknown;this.incomplete=this.d.incomplete=true;}
            else{this.report(syntax.expression,'CS1579',[this.display(type),'GetEnumerator']);element=unknown;}
          }
        }
      }else if(!collection.hasErrors&&!type){this.report(syntax.expression,'CS0186');}
      element??=unknown;
      const bound=this.bindType(syntax.type.kind==='RefType'?syntax.type.type:syntax.type,{allowVar:true}),iterationType=bound.isVar?element:bound.type;
      if(!bound.isVar&&!element.isErrorType()&&!iterationType.isErrorType()){const c=this.conversions.classifyExplicit(element,iterationType);if(!c.exists)this.report(syntax.forEachKeyword,'CS0030',[this.display(element),this.display(iterationType)]);}
      const name=syntax.identifier.valueText,local=this.newLocal(name,iterationType,syntax.identifier,LocalDeclarationKind.Foreach);local.writes++;local.nonConstantWrite=true;local.reads++;this.declare(name,local,syntax.identifier);
      const loop=this.enterLoop(),body=this.embedded(syntax.statement);this.exitLoop();
      return stmt('ForEach',syntax,true,{collection,local,elementType:element,body});
    }finally{this.popScope();}
  },
  switchStatement(syntax){
    const governing=this.value(syntax.expression),sw=this.enterLoop(false),sections=[],seen=new Map();let hasDefault=false,anyCompletes=false;
    this.pushScope();
    try{
      const type=governing.hasErrors?null:governing.type,pendingNames=[];
      for(const section of syntax.sections)for(const s of section.statements)if(s.kind==='LocalDeclarationStatement')for(const v of s.declaration.variables)this.pending.at(-1).add(v.identifier.valueText);
      syntax.sections.forEach((section,index)=>{
        const labels=[];this.pushScope();
        for(const label of section.labels){
          if(label.kind==='DefaultSwitchLabel'){if(hasDefault)this.report(label,'CS0152',['default']);hasDefault=true;labels.push({kind:'default'});continue;}
          if(label.kind==='CaseSwitchLabel'){
            // A case label that names a type is a type pattern (C# 9).
            const p=this.pattern({kind:'ConstantPattern',expression:label.value,span:label.value.span},type,governing);
            if(p.kind==='ConstantPattern'&&p.value?.constantValue){const key=p.value.constantValue.toString();if(seen.has(key))this.report(label,'CS0152',[p.value.constantValue.isNull?'null':p.value.constantValue.type==='string'?p.value.constantValue.value:p.value.constantValue.displayValue]);else seen.set(key,label);}
            labels.push(p);continue;
          }
          const p=type?this.pattern(label.pattern,type,governing):{kind:'Bad'},when=label.whenClause?this.condition(label.whenClause.condition):null;labels.push({...p,when});
        }
        const body=this.block(section,{statements:section.statements,scoped:false});
        if(body.completes&&section.statements.length){const last=section.labels.at(-1),text=last.kind==='DefaultSwitchLabel'?'default:':'case '+(last.value??last.pattern).toString()+(last.whenClause?' '+last.whenClause.toString():'')+':';this.report(lastLabelSpan(last),index===syntax.sections.length-1?'CS8070':'CS0163',[text]);}
        if(body.completes)anyCompletes=true;
        this.popScope();sections.push({labels,body,syntax:section});
      });
    }finally{this.popScope();this.exitLoop();}
    const exhaustive=hasDefault||sections.some(s=>s.labels.some(l=>l.kind==='DiscardPattern'||l.kind==='VarPattern'&&!l.when));
    return stmt('Switch',syntax,sw.hasBreak||!exhaustive||anyCompletes,{governing,sections});
  },
  tryStatement(syntax){
    const body=this.block(syntax.block),catches=[],caught=[];let completes=body.completes;
    for(const clause of syntax.catches){
      this.pushScope();
      try{
        let type=this.core.exception,local=null;
        if(clause.declaration){
          type=this.bindType(clause.declaration.type).type;
          if(!type.isErrorType()&&!(type.equals(this.core.exception)||this.conversions.classifyImplicit(type,this.core.exception).exists||type.typeKind===TypeKind.TypeParameter)){this.report(clause.declaration.type,'CS0155');type=unknown;}
          if(clause.declaration.identifier){local=this.newLocal(clause.declaration.identifier.valueText,type,clause.declaration.identifier,LocalDeclarationKind.Catch);local.writes++;local.isCatch=true;this.declare(local.name,local,clause.declaration.identifier);}
        }
        const filter=clause.filter?this.condition(clause.filter.filterExpression):null;
        if(!type.isErrorType()&&!filter){const previous=caught.find(t=>t.equals(type)||this.conversions.classifyImplicit(type,t).exists);if(previous)this.report(clause.declaration?.type??clause.catchKeyword,clause.declaration?'CS0160':'CS1017',[this.display(previous)]);}
        if(!filter)caught.push(type);
        this.catchDepth++;const savedFinally=this.finallyInCatch;this.finallyInCatch=false;const block=this.block(clause.block);this.finallyInCatch=savedFinally;this.catchDepth--;
        if(block.completes)completes=true;catches.push({type,local,filter,block});
      }finally{this.popScope();}
    }
    let finallyBlock=null;
    if(syntax.finally){this.finallyDepth++;const saved=this.finallyInCatch;this.finallyInCatch=this.catchDepth>0;finallyBlock=this.block(syntax.finally.block);this.finallyInCatch=saved;this.finallyDepth--;if(!finallyBlock.completes)completes=false;}
    return stmt('Try',syntax,completes,{body,catches,finallyBlock});
  },
  iteratorElementType(){
    const t=this.c.declaredReturnType??this.c.returnType;if(!t||t.isErrorType?.())return null;
    if(t.typeArguments?.length===1&&['IEnumerable','IEnumerator','IAsyncEnumerable','IAsyncEnumerator'].includes(t.name))return t.typeArguments[0].type;
    if(['IEnumerable','IEnumerator'].includes(t.name))return this.core.object;
    return null;
  },
  returnStatement(syntax){
    this.sawReturn=true;
    if(this.finallyDepth)this.report(syntax.returnKeyword,'CS0157');
    if(this.c.isIterator&&!this.c.isLambda){if(syntax.expression)this.value(syntax.expression);this.report(syntax,'CS1622');return stmt('Return',syntax,false,{});}
    const isRefReturn=syntax.expression?.kind==='RefExpression',expressionSyntax=isRefReturn?syntax.expression.expression:syntax.expression;
    if(this.c.inferReturn){const e=expressionSyntax?this.value(expressionSyntax):null;this.returns.push(e);return stmt('Return',syntax,false,{expression:e});}
    const type=this.c.returnType;
    if(!expressionSyntax){
      if(type&&type.specialType!=='System_Void'&&!type.isErrorType()&&!this.c.isTopLevel)this.report(syntax.returnKeyword,'CS0126',[this.display(type)]);
      return stmt('Return',syntax,false,{});
    }
    const e=this.value(expressionSyntax);
    if(!type||type.specialType==='System_Void'){
      if(this.c.isTopLevel&&!type){return stmt('Return',syntax,false,{expression:this.convert(e,this.core.int,expressionSyntax)});}
      if(!e.hasErrors)this.report(syntax.returnKeyword,this.c.isAsync&&this.c.declaredReturnType&&this.c.declaredReturnType.equals(this.core.task)?'CS1997':'CS0127',this.c.isAsync&&this.c.declaredReturnType?.equals(this.core.task)?[]:[this.c.isLambda?(this.c.isAnonymousMethod?'anonymous method':'lambda expression'):this.c.method?.toDisplayString()??'']);
      return stmt('Return',syntax,false,{expression:e});
    }
    const refError=checkRefReturn(this.c.returnRefKind,isRefReturn,e.hasErrors?null:e,this.variableContext);
    if(refError&&!e.hasErrors)this.report(refError.code==='CS8150'||refError.code==='CS8149'?syntax:expressionSyntax,refError.code,refError.args);
    if(isRefReturn){if(!e.hasErrors&&e.type&&!e.type.equals(type)&&!type.isErrorType())this.report(expressionSyntax,'CS8151',[this.display(type)]);return stmt('Return',syntax,false,{expression:e,isRef:true});}
    const converted=this.convert(e,type,expressionSyntax);if(e.form==='lambda'&&!converted.hasErrors)this.finishLambda(e,type);
    return stmt('Return',syntax,false,{expression:converted});
  },
  // ---- local functions ----
  declareLocalFunction(syntax){
    const name=syntax.identifier.valueText,modifiers=syntax.modifiers.map(m=>m.text);
    const method=new MethodSymbol({name,methodKind:MethodKind.LocalFunction,containingSymbol:this.c.method??this.c.containingType,modifiers:modifiersFromSyntax(modifiers),syntax,locations:[{uri:this.c.uri,start:syntax.identifier.span.start,end:syntax.identifier.span.end}],typeParameters:[]});
    const typeParameters=declareTypeParameters(syntax.typeParameterList,method,this.c.uri,(n,c,a)=>this.report(n,c,a));method.typeParameters=Object.freeze(typeParameters);
    const scope=typeParameters.length?this.typeScope.child('typeParameters',{parameters:typeParameters}):this.typeScope;method.scope=scope;method.uses=0;
    let returnSyntax=syntax.returnType;if(returnSyntax.kind==='RefType'){method.refKind=returnSyntax.readOnlyKeyword?RefKind.RefReadOnly:RefKind.Ref;returnSyntax=returnSyntax.type;}
    method.returnTypeWithAnnotations=this.d.typeBinder.bindType(returnSyntax,scope);
    const seen=new Set(),parameters=syntax.parameterList.parameters.map((p,ordinal)=>{const mods=p.modifiers.map(m=>m.text),pname=p.identifier.valueText;if(seen.has(pname))this.report(p.identifier,'CS0100',[pname]);seen.add(pname);
      const parameter=new ParameterSymbol({name:pname,type:p.type?this.d.typeBinder.bindType(p.type,scope):unknown,ordinal,refKind:mods.includes('out')?RefKind.Out:mods.includes('ref')?RefKind.Ref:mods.includes('in')?RefKind.In:RefKind.None,isParams:mods.includes('params'),isThis:mods.includes('this'),...(p.default?{explicitDefaultValue:{value:undefined}}:{}),syntax:p,locations:[{uri:this.c.uri,start:p.identifier.span.start,end:p.identifier.span.end}]});parameter.defaultSyntax=p.default?.value??null;return parameter;});
    method.parameters=Object.freeze(parameters.map((p,i)=>{p.ordinal=i;p.containingSymbol=method;return p;}));
    if(syntax.constraintClauses?.length)bindConstraintClauses(typeParameters,syntax.constraintClauses,t=>this.d.typeBinder.bindType(t,scope).type,(n,c,a)=>this.report(n,c,a),{ownerDisplay:name});
    this.declare(name,method,syntax.identifier);this.localFunctions.push(method);(this.rootBinder.allLocalFunctions??=[]).push({method,uri:this.c.uri});
    return method;
  },
  localFunction(syntax){
    const method=this.scopes.flatMap(s=>[...s.values()]).find(s=>s.kind===SymbolKind.Method&&s.syntax===syntax);if(!method)return stmt('LocalFunction',syntax,true,{});
    const isStatic=method.isStatic,isAsync=method.isAsync;
    for(const p of method.parameters)if(p.defaultSyntax)this.d.bindParameterDefault(p,this);
    method.body=this.d.bindMethodBody(method,{uri:this.c.uri,scope:method.scope,containingType:this.c.containingType,isStatic:this.c.isStatic,parent:isStatic?this.staticParent():this,isLocalFunction:true,isFieldInitializer:false,isStaticInitializer:this.c.isStaticInitializer,quiet:this.quiet,isTopLevel:false});
    return stmt('LocalFunction',syntax,true,{method});
  },
  /** A static local function sees enclosing local functions and constants but captures no state (CS8421). */
  staticParent(){return this;}
};
function lastLabelSpan(label){const s=label.span;return {start:s.start,end:s.end};}
export {DeclarationModifiers,isNullableType};
