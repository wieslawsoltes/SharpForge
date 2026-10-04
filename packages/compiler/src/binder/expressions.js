import {bindFrameworkDelegate} from './framework-delegates.js';
import {bindCoreProperty} from './core-properties.js';
import {executableFrameworkType} from '../framework-type-selection.js';
import {DiagnosticId} from '../diagnostics/codes.js';
import {canonicalType,frameworkType,enumValue,eventsFor} from '@sharpforge/framework';
import {BuiltinMap} from '@sharpforge/bytecode';
import {numeric,isReference,assignable,pathOf,typeText} from '../type-utils.js';
import {classifyBinary} from './operators.js';
import {bindArrayCreation} from './array-creation.js';
import {bindValueArgument} from './value-arguments.js';
import {BoundLiteral,BoundDefaultExpression,BoundLocal,BoundParameter,BoundThisReference,BoundFieldAccess,BoundPropertyAccess,BoundIndexerAccess,BoundArrayAccess,BoundArrayLength,BoundCall,BoundObjectCreationExpression,BoundObjectInitializerMember,BoundCollectionElementInitializer,BoundUnaryOperator,BoundIncrementOperator,BoundBinaryOperator,BoundNullCoalescingOperator,BoundConditionalOperator,BoundAssignmentOperator,BoundCompoundAssignmentOperator,BoundNullCoalescingAssignmentOperator,BoundEventAssignmentOperator,BoundConversion,BoundInterpolatedString,BoundStringInsert,BoundAwaitExpression,BoundSwitchExpression,BoundSwitchExpressionArm,BoundConstantPattern,BoundCollectionExpression,BoundCollectionElement,BoundCollectionSpread} from '../bound/nodes.js';
/**
 * Expression binding: syntax to bound expressions typed with TypeSymbols. No IR is produced here; evaluation order,
 * temporaries and ABI calls are the business of lowering and code generation.
 *
 * `bindExpression` binds a value, `bindTyped` binds with a target type (target-typed new, collection expressions),
 * `bindLValue` binds an assignment target, `bindBool` a condition. Reads of locals are not checked for definite
 * assignment here - that is flow analysis (flow/definite-assignment.js).
 */
export const ExpressionBinder=Base=>class ExpressionBinder extends Base {
  bindBool(node){const bound=this.bindExpression(node);this.checkAssign('bool',bound.legacyType,node);return bound;}
  /** A reference to a local, parameter or `this`. */
  variable(syntax,variable){return variable===this.thisParameter?this.node(BoundThisReference,syntax,{},variable.legacyType):variable.kind==='Parameter'?this.node(BoundParameter,syntax,{parameter:variable},variable.legacyType):this.node(BoundLocal,syntax,{local:variable},variable.legacyType,variable.constant?{constantValue:{value:variable.constant.value}}:undefined);}
  /** The implied `this` receiver of an unqualified instance member access. */
  implicitThis(syntax){const self=this.thisParameter;return this.node(BoundThisReference,null,{},self?.legacyType??this.m.owner?.name??'error',self?null:{hasErrors:true});}
  bindTyped(node,type){
    if(node?.kind==='New'&&node.type==='<target>'){this.c.requireFeature(this.c.firstToken(node),9,'target-typed object creation');if(!type||['void','var','error','null','int','double','bool','string'].includes(type)){this.c.report(node,DiagnosticId.CS8754,['new()']);return this.bad(node);}return this.bindExpression({...node,type});}
    if(node?.kind==='CollectionExpression')return this.bindCollectionExpression(node,type);
    if(node?.kind==='Conditional'&&type)return this.bindExpression({...node,whenTrue:this.contextualize(node.whenTrue,type),whenFalse:this.contextualize(node.whenFalse,type)});
    return this.bindExpression(node);
  }
  contextualize(node,type){if(node?.kind==='New'&&node.type==='<target>'){this.c.requireFeature(this.c.firstToken(node),9,'target-typed object creation');return {...node,type};}if(node?.kind==='CollectionExpression')return {...node,targetType:type};return node;}
  bindExpression(node){
    if(!node)return this.bad(null);
    if(node.kind==='BoundTemp')return this.node(BoundLocal,null,{local:node.local},node.type);
    if(node.kind==='CollectionExpression')return this.bindCollectionExpression(node,node.targetType);
    if(node.kind==='New'&&node.type==='<target>')return this.bindTyped(node,null);
    if(['ConditionalMember','ConditionalIndex'].includes(node.kind)||node.kind==='Assignment'&&['ConditionalMember','ConditionalIndex'].includes(node.left.kind)){this.c.report(node,DiagnosticId.SF2141);return this.bad(node);}
    const external=this.bindFrameworkExpression(node);if(external!==undefined)return external;
    // Constant folding reports CS0220/CS0020/CS0221 and gives the bound node its constant value.
    const folded=['Binary','Unary','Cast'].includes(node.kind)?this.constant(node):null,constant=folded?{constantValue:{value:folded.value}}:null;
    switch(node.kind){
      case 'InterpolatedString':{
        const parts=node.parts.map(part=>{if(part.text!==undefined)return this.node(BoundLiteral,null,{value:part.text},'string');const value=this.bindExpression(part.expression);if(part.alignmentExpression){const width=this.constant(part.alignmentExpression);if(!width||width.type!=='int')this.c.report(part.alignmentExpression,DiagnosticId.CS0150);}if(value.legacyType==='void')this.c.report(part.expression,DiagnosticId.CS0029,['void','object']);return this.node(BoundStringInsert,null,{value,alignment:part.alignment,format:part.format},'string');});
        return this.node(BoundInterpolatedString,node,{parts},'string');
      }
      case 'Await':{if(!this.m.node.asyncBody&&!this.m.name.startsWith('<startup>'))this.c.report(node,DiagnosticId.CS4032,[typeText(this.m.returnType)]);const expression=this.bindExpression(node.expression),type=expression.legacyType,d=this.frameworkExactMethod('SharpForge.Runtime.Async','Await',[type]);if(!d){this.c.report(node,DiagnosticId.CS1061,[typeText(type),'GetAwaiter']);return this.bad(node,[expression]);}return this.node(BoundAwaitExpression,node,{expression,awaiter:this.sym.contract(d)},d.result);}
      case 'Default':{const type=this.c.resolveType(node.type,node,false,this.m);if(type==='void')this.c.report(node,DiagnosticId.CS1547);return this.node(BoundDefaultExpression,node,{},type);}
      case 'Checked':case 'Unchecked':return this.inCheckedContext(node.kind==='Checked',()=>this.bindExpression(node.expression));
      case 'Cast':{const operand=this.bindExpression(node.expression),from=operand.legacyType,to=this.c.resolveType(node.type,node,false,this.m);if((!numeric(from)&&frameworkType(from)?.kind!=='enum')||(!numeric(to)&&frameworkType(to)?.kind!=='enum'))this.c.report(node,DiagnosticId.CS0030,[typeText(from),typeText(to)]);return this.node(BoundConversion,node,{operand,conversion:{kind:from===to?'Identity':'ExplicitNumeric',from,to},isExplicit:true,isChecked:this.overflowChecked(node)&&to!=='double'},to,constant);}
      case 'SwitchExpression':return this.bindSwitchExpression(node);
      case 'Error':return this.bad(node);
      case 'Literal':if(node.type==='char')this.c.report(node,DiagnosticId.SF2003);if(node.type==='int'&&node.value>2147483647&&!this.c.reportedAt(node,DiagnosticId.SF1004))this.c.report(node,DiagnosticId.SF2004);return this.node(BoundLiteral,node,{value:node.value},node.type,{constantValue:{value:node.value}});
      case 'Name':{
        const l=this.lookup(node.name);if(l){if(l.ideSymbol)this.c.reference(node,l.ideSymbol);return this.variable(node,l);}
        const property=this.property(node);if(property)return this.readProperty(property,node);
        const f=this.field(node);if(f){this.c.reference(node,f.symbol);if(f.isStatic)return this.node(BoundFieldAccess,node,{receiver:null,field:this.sym.field(f)},f.type);if(!this.thisParameter)this.c.report(node,DiagnosticId.CS0120,[node.name]);return this.node(BoundFieldAccess,node,{receiver:this.implicitThis(node),field:this.sym.field(f)},f.type);}
        this.c.report(node,DiagnosticId.CS0103,[node.name]);return this.bad(node);}
      case 'Member':{
        const type=this.infer(node.target);
        if(node.name==='Length'&&(type==='string'||type.endsWith('[]')))return this.node(BoundArrayLength,node,{expression:this.bindExpression(node.target)},'int');
        const coreProperty=bindCoreProperty(this,node,type);if(coreProperty)return coreProperty;
        const property=this.property(node);if(property)return this.readProperty(property,node);
        const f=this.field(node);if(f){this.c.reference(node,f.symbol);return this.node(BoundFieldAccess,node,{receiver:f.isStatic?null:this.bindExpression(node.target),field:this.sym.field(f)},f.type);}
        this.c.report(node,DiagnosticId.CS1061,[typeText(type),node.name]);return this.bad(node);}
      case 'Index':{const expression=this.bindExpression(node.target),type=expression.legacyType,index=this.bindExpression(node.index);this.checkAssign('int',index.legacyType,node.index);if(!type.endsWith('[]'))this.c.report(node,DiagnosticId.SF2005,[typeText(type)]);return this.node(BoundArrayAccess,node,{expression,index},type.endsWith('[]')?type.slice(0,-2):'error');}
      case 'Binary':{
        if(['&&','||','??'].includes(node.operator)){
          const left=this.bindExpression(node.left),lt=left.legacyType,coalesce=node.operator==='??';
          if(coalesce){if(!isReference(lt)&&lt!=='null'&&lt!=='error')this.c.report(node,DiagnosticId.CS0019,['??',typeText(lt),typeText(this.infer(node.right))]);}else this.checkAssign('bool',lt,node.left);
          const right=this.bindExpression(node.right),rt=right.legacyType;if(!coalesce)this.checkAssign('bool',rt,node.right);else if(lt!=='null')this.checkAssign(lt,rt,node);
          return coalesce?this.node(BoundNullCoalescingOperator,node,{left,right},lt==='null'?rt:lt):this.node(BoundBinaryOperator,node,{operator:node.operator,left,right,isChecked:false,method:null,negate:false},'bool',constant);
        }
        const left=this.bindExpression(node.left),right=this.bindExpression(node.right),info=this.binary(node.operator,left.legacyType,right.legacyType,node);
        return this.node(BoundBinaryOperator,node,{operator:node.operator,left,right,isChecked:this.overflowChecked(node),method:this.sym.contract(info.contract),negate:info.negate},info.result,info.implemented?constant:{hasErrors:true});}
      case 'Unary':{
        if(['++','--'].includes(node.operator)){const operand=this.bindLValue(node.operand);this.bindLoad(operand);const info=this.binary(node.operator==='++'?'+':'-',operand.legacyType,'int',node);return this.node(BoundIncrementOperator,node,{operator:node.operator,operand,isPostfix:!!node.postfix,isChecked:this.overflowChecked(node)},operand.legacyType,info.implemented?null:{hasErrors:true});}
        if(node.operator==='-'&&node.operand.kind==='Literal'&&node.operand.type==='int'&&node.operand.value===2147483648)return this.node(BoundLiteral,node,{value:-2147483648},'int',{constantValue:{value:-2147483648}});
        const operand=this.bindExpression(node.operand),type=operand.legacyType;if(node.operator==='!')this.checkAssign('bool',type,node);else if(!numeric(type))this.c.report(node,DiagnosticId.CS0023,[node.operator,typeText(type)]);if(node.operator==='~')this.checkAssign('int',type,node);
        return this.node(BoundUnaryOperator,node,{operator:node.operator,operand,isChecked:this.overflowChecked(node)&&node.operator==='-'},node.operator==='!'?'bool':type,constant);}
      case 'Assignment':{
        const left=this.bindLValue(node.left,node.operator==='='),target=left.legacyType;
        if(node.operator==='??='){if(!isReference(target))this.c.report(node,DiagnosticId.CS0019,['??=',typeText(target),typeText(this.infer(node.right))]);this.bindLoad(left);const right=this.bindTyped(node.right,target);this.checkAssign(target,right.legacyType,node);return this.node(BoundNullCoalescingAssignmentOperator,node,{left,right},target);}
        if(node.operator==='='){const right=this.bindTyped(node.right,target),converts=this.checkAssign(target,right.legacyType,node);return this.node(BoundAssignmentOperator,node,{left,right},target,converts?null:{hasErrors:true});}
        this.bindLoad(left);const right=this.bindExpression(node.right),operator=node.operator.slice(0,-1),info=this.binary(operator,target,right.legacyType,node);this.checkAssign(target,info.result,node);
        return this.node(BoundCompoundAssignmentOperator,node,{operator,left,right,isChecked:this.overflowChecked(node),method:this.sym.contract(info.contract),negate:info.negate},target,info.implemented?null:{hasErrors:true});}
      case 'Conditional':{const condition=this.bindBool(node.condition),consequence=this.bindExpression(node.whenTrue),alternative=this.bindExpression(node.whenFalse),yes=consequence.legacyType,no=alternative.legacyType;if(!assignable(yes,no)&&!assignable(no,yes))this.c.report(node,DiagnosticId.CS0173,[typeText(yes),typeText(no)]);return this.node(BoundConditionalOperator,node,{condition,consequence,alternative},yes==='null'?no:yes==='double'||no==='double'?'double':yes);}
      case 'Call':return this.bindCall(node);
      case 'NewArray':return bindArrayCreation(this,node);
      case 'New':return this.bindObjectCreation(node);
      default:this.c.report(node,DiagnosticId.SF2098,[node.kind]);return this.bad(node);
    }
  }
  /** Reports the CS0019 conditions of a binary operator over legacy operand types and returns its classification. */
  binary(operator,left,right,node){
    const info=classifyBinary(operator,left,right);
    for(const error of info.errors)this.c.report(node,DiagnosticId.CS0019,[operator,typeText(left),typeText(right)]);
    if(!info.contract&&!info.implemented){this.c.report(node,DiagnosticId.SF2006,[operator]);return {...info,result:'error'};}
    return info;
  }
  bindCall(node){
    if(this.isNameof(node)){const name=this.nameof(node);return this.node(BoundLiteral,node,{value:name},'string',{constantValue:{value:name}});}
    const builtin=this.findBuiltin(node);
    if(builtin){
      const staticPath=pathOf(node.target)?.replace(/^System\./,''),types=[];let receiver=null,count=0;
      if(staticPath!==builtin.name&&node.target.kind==='Member'){receiver=this.bindExpression(node.target.target);types.push(receiver.legacyType);count++;}
      const args=node.args.map(a=>{const bound=this.bindExpression(a);types.push(bound.legacyType);count++;return bound;});
      if(count<builtin.min||count>builtin.max)this.c.report(node,DiagnosticId.CS1501,[builtin.name,count]);
      types.forEach((type,i)=>{const target=builtin.params[i];if(target==='number'){if(!numeric(type))this.c.report(node,DiagnosticId.CS1503,[i+1,typeText(type),'double']);}else if(target==='array'){if(!type.endsWith('[]'))this.c.report(node,DiagnosticId.CS1503,[i+1,typeText(type),'System.Array']);}else if(target&&target!=='any'&&target!=='exception')this.checkAssign(target,type,node.args[Math.max(0,i-(count-node.args.length))]??node);});
      return this.node(BoundCall,node,{receiver,method:this.sym.builtin(builtin),args,intrinsic:builtin.name==='object.GetType'&&['int','double','bool','long'].includes(types[0])?BuiltinMap.get('$type.'+types[0]+'.GetType'):builtin.name==='Math.Abs'&&types[0]==='int'?BuiltinMap.get('$Math.Abs.Int32'):builtin},builtin.result==='numeric'?(types.includes('double')?'double':'int'):builtin.result);
    }
    const method=this.findMethod(node);let receiver=null;
    if(method&&!method.isStatic)receiver=node.target.kind==='Member'?this.bindExpression(node.target.target):this.implicitThis(node);
    const args=node.args.map((arg,i)=>{const bound=this.bindTyped(arg,method?.parameters[i]?.type);if(method)this.checkAssign(method.parameters[i]?.type??'error',bound.legacyType,arg);return bound;});
    if(!method)return this.bad(node,args);
    if(method.symbol){this.c.reference(node.target,method.symbol);const reference=this.c.references.at(-1);reference.call=true;reference.callerId=this.m.symbol?.id??null;}
    return this.node(BoundCall,node,{receiver,method:this.sym.method(method),args,intrinsic:null},method.returnType);
  }
  bindObjectCreation(node){
    if(node.collectionInitializers?.length)this.c.report(node,DiagnosticId.SF2013);
    const name=this.c.typeName(node.type,this.m);
    if(name==='Exception'){
      if(node.args.length>1)this.c.report(node,DiagnosticId.CS1501,['Exception',node.args.length]);let message;
      if(node.args.length){message=this.bindExpression(node.args[0]);this.checkAssign('string',message.legacyType,node.args[0]);}else message=this.node(BoundLiteral,null,{value:'An exception was thrown.'},'string');
      return this.node(BoundObjectCreationExpression,node,{constructorMethod:this.sym.builtin(BuiltinMap.get('Exception.new')),args:[message],initializers:[],collectionInitializers:[]},'Exception');
    }
    const type=this.c.findType(name,this.m);if(!type){this.c.report(node,DiagnosticId.CS0246,[typeText(name)]);return this.bad(node);}
    const ctors=type.methods.filter(m=>m.name==='.ctor'),ctor=ctors.find(m=>m.parameters.length===node.args.length&&m.parameters.every((p,i)=>assignable(p.type,this.infer(node.args[i]))));let args=[],broken=false;
    if(ctor)args=node.args.map((arg,i)=>this.bindTyped(arg,ctor.parameters[i].type));else if(node.args.length||ctors.length){this.c.report(node,DiagnosticId.CS1729,[name,node.args.length]);broken=true;}
    const initializers=[];
    for(const init of node.initializers){
      const property=type.properties.find(p=>p.name===init.name&&!p.isStatic),field=type.fields.find(f=>f.name===init.name&&!f.isStatic);if(!property&&!field){this.c.report(init,DiagnosticId.CS0117,[name,init.name]);broken=true;continue;}
      if(property){const setter=this.propertyAccess(property,{...init,kind:'Member'},'set');if(!setter){broken=true;continue;}const value=this.bindTyped(init.expression,property.type);this.checkAssign(property.type,value.legacyType,init);initializers.push(this.node(BoundObjectInitializerMember,init,{member:this.sym.property(property),value},property.type));}
      else{this.c.reference(init,field.symbol);const value=this.bindTyped(init.expression,field.type);this.checkAssign(field.type,value.legacyType,init);initializers.push(this.node(BoundObjectInitializerMember,init,{member:this.sym.field(field),value},field.type));}
    }
    return this.node(BoundObjectCreationExpression,node,{constructorMethod:ctor?this.sym.method(ctor):null,args,initializers,collectionInitializers:[]},type.name,broken?{hasErrors:true}:null);
  }
  // ---- properties and assignment targets ---------------------------------------------------------------------
  /** Checks that a source property can be read or written here; records the reference. Returns the accessor record or null. */
  propertyAccess(property,node,kind){
    const method=property[kind];this.c.reference(node,property.symbol);
    if(!method){this.c.report(node,kind==='get'?DiagnosticId.CS0154:DiagnosticId.CS0200,[property.name]);return null;}
    if(['private','protected'].includes(method.accessor.access)&&this.m.owner!==property.owner)this.c.report(node,kind==='get'?DiagnosticId.CS0271:DiagnosticId.CS0272,[property.name]);
    if(!property.isStatic&&node.kind==='Name'&&!this.thisParameter)this.c.report(node,DiagnosticId.CS0120,[property.name]);
    return method;
  }
  propertyReceiver(property,node){return property.isStatic?null:node.kind==='Member'?this.bindExpression(node.target):this.implicitThis(node);}
  readProperty(property,node){const getter=this.propertyAccess(property,node,'get');if(!getter)return this.bad(node,[],property.type);return this.node(BoundPropertyAccess,node,{receiver:this.propertyReceiver(property,node),property:this.sym.property(property)},property.type);}
  /** An assignment target read before it is written (compound assignment, ++): source properties need an accessible getter. */
  bindLoad(target){if(target.kind==='PropertyAccess'&&target.property.legacy)this.propertyAccess(target.property.legacy,target.syntax,'get');}
  /** Binds an assignment target. `allowReadOnly` permits initialising a getter-only auto-property in its constructor. */
  bindLValue(node,allowReadOnly=false){
    const framework=this.bindFrameworkLValue(node);if(framework)return framework;
    if(node.kind==='Name'){const l=this.lookup(node.name);if(l){if(l.isConst)this.c.report(node,DiagnosticId.CS0131);if(l.isUsing)this.c.report(node,DiagnosticId.CS1656,[node.name,'using variable']);if(l.isForEach)this.c.report(node,DiagnosticId.CS1656,[node.name,'foreach iteration variable']);if(l.ideSymbol)this.c.reference(node,l.ideSymbol);return this.variable(node,l);}}
    const property=this.property(node);
    if(property){
      // A getter-only auto-property may be assigned only on this in its owning constructor: that writes the backing field.
      if(allowReadOnly&&!property.set&&property.backing&&this.m.owner===property.owner&&this.m.name==='.ctor'&&!property.isStatic&&(node.kind==='Name'||node.target?.kind==='Name'&&node.target.name==='this')){this.c.reference(node,property.symbol);return this.node(BoundFieldAccess,node,{receiver:this.implicitThis(node),field:this.sym.field(property.backing)},property.type);}
      this.propertyAccess(property,node,'set');return this.node(BoundPropertyAccess,node,{receiver:this.propertyReceiver(property,node),property:this.sym.property(property)},property.type);
    }
    const f=node.kind==='Name'||node.kind==='Member'?this.field(node):null;
    if(f){this.c.reference(node,f.symbol);if(f.isStatic)return this.node(BoundFieldAccess,node,{receiver:null,field:this.sym.field(f)},f.type);if(node.kind==='Member')return this.node(BoundFieldAccess,node,{receiver:this.bindExpression(node.target),field:this.sym.field(f)},f.type);if(!this.thisParameter)this.c.report(node,DiagnosticId.CS0120,[node.name]);return this.node(BoundFieldAccess,node,{receiver:this.implicitThis(node),field:this.sym.field(f)},f.type);}
    if(node.kind==='Index'){const expression=this.bindExpression(node.target),type=expression.legacyType,index=this.bindExpression(node.index);this.checkAssign('int',index.legacyType,node.index);if(!type.endsWith('[]'))this.c.report(node,DiagnosticId.CS0021,[typeText(type)]);return this.node(BoundArrayAccess,node,{expression,index},type.slice(0,-2),type.endsWith('[]')?null:{hasErrors:true});}
    this.c.report(node,DiagnosticId.CS0131);return this.bad(node);
  }
  // ---- nameof, switch, collections ---------------------------------------------------------------------------
  nameof(node,bind=true){
    const argument=node.args[0];if(node.args.length!==1||!argument||!['Name','Member'].includes(argument.kind)){if(bind)this.c.report(node,DiagnosticId.CS8081);return '';}
    // The profile supports identifier/member chains, not arbitrary receiver expressions.
    const path=pathOf(argument);if(!path||path.includes('null.')){if(bind)this.c.report(argument,DiagnosticId.CS8081);return '';}
    let symbol=null,valid=false;
    if(argument.kind==='Name'){
      const local=this.lookup(argument.name),field=this.m.owner?.fields.find(f=>f.name===argument.name)??this.m.owner?.properties.find(p=>p.name===argument.name),type=this.c.findType(argument.name,this.m),methods=this.c.methods.filter(m=>m.name===argument.name&&(m.owner===this.m.owner||!m.owner));
      symbol=local?.ideSymbol??field?.symbol??type?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!local||!!field||!!type||methods.length>0||['System','Console','Math','GC','Array','Convert','Debug','Exception'].includes(argument.name);
    }else{
      const receiver=pathOf(argument.target),local=argument.target.kind==='Name'?this.lookup(receiver):null,type=this.c.findType(receiver??'',this.m)??this.c.findType(this.infer(argument.target),this.m),field=type?.fields.find(f=>f.name===argument.name)??type?.properties.find(p=>p.name===argument.name),methods=type?.methods.filter(m=>m.name===argument.name)??[];
      symbol=field?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!field||methods.length>0||BuiltinMap.has(path.replace(/^System\./,''))||path==='System.Console'||path==='System.Math'||path==='System.GC'||path==='System.Exception'||path==='System.String'||path==='System.Int32'||argument.name==='Length'&&(local?.legacyType==='string'||local?.legacyType?.endsWith('[]'));
      if(bind&&local?.ideSymbol)this.c.reference(argument.target,local.ideSymbol);
    }
    if(!valid&&bind)this.c.report(argument,DiagnosticId.CS0103,[path]);
    if(bind&&symbol)this.c.reference(argument,symbol);return argument.name;
  }
  /** Binds a constant case label or pattern; returns the legacy {value,type} (type 'error' after CS0150). */
  constantPattern(node){
    if(this.isNameof(node))return {value:this.nameof(node),type:'string'};
    const result=this.constant(node);
    if(result&&['int','string','bool','null'].includes(result.type)){
      const visit=n=>{if(!n||typeof n!=='object')return;if(n.kind==='Name'){const local=this.lookup(n.name);if(local?.constant&&local.ideSymbol)this.c.reference(n,local.ideSymbol);}for(const [key,value]of Object.entries(n))if(!['green','tokens','source'].includes(key))for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&child.kind)visit(child);};visit(node);return result;
    }
    this.c.report(node??this.m.node,DiagnosticId.CS0150);return {value:null,type:'error'};
  }
  /** Binds the governing expression and the labels of a switch; `groups` is one label list per section or arm (null = default). */
  bindSwitchDispatch(node,groups){
    const expression=this.bindExpression(node.expression),type=expression.legacyType;if(!['int','string','bool'].includes(type))this.c.report(node,DiagnosticId.CS0151);
    const seen=new Set();let hasDefault=false;
    const labels=groups.map(group=>group.map(label=>{
      if(label===null){if(hasDefault)this.c.report(node,DiagnosticId.CS0152,['default']);hasDefault=true;return null;}
      const constant=this.constantPattern(label),key=JSON.stringify([constant.type,constant.value]);if(seen.has(key))this.c.report(label,DiagnosticId.CS0152,[String(constant.value)]);seen.add(key);this.checkAssign(type,constant.type,label);
      return this.node(BoundConstantPattern,label,{value:constant.value,valueType:constant.type},constant.type,{constantValue:{value:constant.value}});
    }));
    return {expression,labels,hasDefault};
  }
  bindSwitchExpression(node){
    const type=this.switchType(node),dispatch=this.bindSwitchDispatch(node,node.arms.map(a=>[a.pattern]));
    const arms=node.arms.map((arm,i)=>{const value=this.bindExpression(arm.expression);this.checkAssign(type,value.legacyType,arm);return this.node(BoundSwitchExpressionArm,arm,{pattern:dispatch.labels[i][0],value},value.legacyType);});
    return this.node(BoundSwitchExpression,node,{expression:dispatch.expression,arms},type);
  }
  bindCollectionExpression(node,target){
    this.c.requireFeature(this.c.firstToken(node),12,'collection expressions');target=canonicalType(target);const array=target?.endsWith('[]'),t=frameworkType(target),element=array?target.slice(0,-2):t?.element;
    if(!element||!array&&!['List','HashSet'].includes(t?.family)){this.c.report(node,DiagnosticId.CS9176);return this.bad(node);}
    if(node.arguments){this.c.requireFeature(node,15,'Collection expression constructor arguments');if(array||node.arguments.length!==1||node.arguments[0].name&&!['capacity'].includes(node.arguments[0].name))this.c.report(node,DiagnosticId.SF2143);}
    const owner=array?canonicalType('List<'+element+'>'):target,base={uri:node.uri,start:node.start,end:node.end,debugHidden:true},collection=this.temp(owner),temp={...base,kind:'BoundTemp',local:collection,type:owner},call=(name,args)=>({...base,kind:'Call',target:{...base,kind:'Member',target:temp,name},args});
    const creation=this.bindExpression({...base,kind:'New',type:owner,args:node.arguments?.map(a=>a.expression)??[],initializers:[],collectionInitializers:[]});
    const elements=node.elements.map(item=>{
      if(item.kind==='SpreadElement'){const name=this.syntheticName('$spread');const statement=this.bindStatement({...item,kind:'Foreach',type:'var',name,synthesizedKind:'spread',expression:item.expression,body:{...base,kind:'ExpressionStatement',expression:call('Add',[{...base,kind:'Name',name}])}});return this.node(BoundCollectionSpread,item,{iterationVariable:statement.iterationVariable,statement},'void');}
      const value=this.bindTyped(item,element);this.checkAssign(element,value.legacyType,item);return this.node(BoundCollectionElement,item,{value,addMethod:this.framework.methods(owner,'Add',false).find(m=>m.parameters.length===1)??null},'void');
    });
    return this.node(BoundCollectionExpression,node,{collection,creation,elements,conversion:array?this.bindExpression(call('ToArray',[])):null},target);
  }
  // ---- framework members (closed registry) -------------------------------------------------------------------
  /** A PropertySymbol-shaped view of a framework property or indexer made of its get/set contracts. */
  frameworkPropertySymbol(get,set){
    const getter=this.sym.contract(get),setter=this.sym.contract(set),owner=(getter??setter).containingType,name=(get??set).name.slice(4);
    const existing=getter?.associatedSymbol?.kind==='Property'?getter.associatedSymbol:setter?.associatedSymbol?.kind==='Property'?setter.associatedSymbol:owner.getMembers('this[]').find(p=>p.getMethod===getter);
    if(existing&&existing.getMethod===getter&&existing.setMethod===setter)return existing;
    return Object.freeze({kind:'Property',name,getMethod:getter,setMethod:setter,isStatic:(get??set).isStatic,containingSymbol:owner,toDisplayString:()=>owner.toDisplayString()+'.'+name});
  }
  bindDelegate(node,type){return bindFrameworkDelegate(this,node,type);}
  bindFrameworkArguments(args,parameters,boxPrimitives=false){
    return args.map((arg,i)=>bindValueArgument(this,arg,parameters[i],boxPrimitives));
  }
  bindFrameworkExpression(node){
    if(node.kind==='Index'){const get=this.frameworkMethod(this.infer(node.target),'get_Item',false);if(get){const receiver=this.bindExpression(node.target),index=this.bindExpression(node.index);this.checkAssign(get.parameters[0],index.legacyType,node.index);return this.node(BoundIndexerAccess,node,{receiver,indexer:this.frameworkPropertySymbol(get,this.frameworkMethod(receiver.legacyType,'set_Item',false)),args:[index]},get.result);}}
    if(node.kind==='Member'){
      const constant=enumValue(pathOf(node));if(constant){const field=this.type(constant.type)?.getMembers(node.name)[0]??null;return this.node(BoundFieldAccess,node,{receiver:null,field},constant.type,{constantValue:{value:constant.value}});}
      const p=this.frameworkProperty(node);if(p){if(!p.get){this.c.report(node,DiagnosticId.CS0154,[node.name]);return this.bad(node,[],p.type);}return this.node(BoundPropertyAccess,node,{receiver:p.receiver.isStatic?null:this.bindExpression(p.receiver.node),property:this.frameworkPropertySymbol(p.get,p.set)},p.get.result);}
    }
    if(node.kind==='Call'){
      const r=this.frameworkReceiver(node.target);if(!r)return undefined;
      if(!this.framework.method(r.type,node.target.name,r.isStatic)&&this.findBuiltin(node))return undefined;
      const call=this.frameworkCall(node,true);if(!call)return this.bad(node);
      const receiver=call.receiver.isStatic?null:this.bindExpression(call.receiver.node),args=this.bindFrameworkArguments(node.args,call.contract.parameters,frameworkType(call.contract.owner)?.kind==='bcl');
      return this.node(BoundCall,node,{receiver,method:this.sym.contract(call.contract),args,intrinsic:null},call.contract.result);
    }
    if(node.kind==='New'){
      const t=executableFrameworkType(this.c,node.type,this.m);if(!t)return undefined;if(t.kind==='delegate')return this.bindDelegate(node,t.name);
      const constructor=this.frameworkConstructor(t.name,node);
      if(!constructor){this.c.report(node,DiagnosticId.CS1729,[typeText(t.name),node.args.length]);return this.bad(node,[],t.name);}
      const args=this.bindFrameworkArguments(node.args,constructor.parameters,t.kind==='bcl'),initializers=[],collectionInitializers=[];let broken=false;
      for(const init of node.initializers){const setter=this.frameworkMethod(t.name,'set_'+init.name,false);if(!setter){this.c.report(init,DiagnosticId.CS0200,[typeText(t.name)+'.'+init.name]);broken=true;continue;}const value=this.bindExpression(init.expression);this.checkAssign(setter.parameters[0],value.legacyType,init);initializers.push(this.node(BoundObjectInitializerMember,init,{member:this.sym.contract(setter),value},setter.parameters[0]));}
      for(const values of node.collectionInitializers??[]){const add=this.frameworkAdd(t.name,values);if(!add){this.c.report(node,DiagnosticId.CS1921,[typeText(t.name)+'.Add']);broken=true;continue;}collectionInitializers.push(this.node(BoundCollectionElementInitializer,null,{addMethod:this.sym.contract(add),args:this.bindFrameworkArguments(values,add.parameters,t.kind==='bcl')},'void'));}
      return this.node(BoundObjectCreationExpression,node,{constructorMethod:this.sym.contract(constructor),args,initializers,collectionInitializers},t.name,broken?{hasErrors:true}:null);
    }
    if(node.kind==='Assignment'&&['+=','-='].includes(node.operator)){
      const r=this.frameworkReceiver(node.left),event=r&&!r.isStatic?eventsFor(r.type)[node.left.name]:null;
      if(event){const accessor=this.framework.eventAccessor(r.type,node.left.name,node.operator==='+='),receiver=this.bindExpression(r.node),argument=this.bindDelegate(node.right,event);return this.node(BoundEventAssignmentOperator,node,{receiver,event:accessor,isAddition:node.operator==='+=',argument},'void');}
    }
    return undefined;
  }
  bindFrameworkLValue(node){
    if(node.kind==='Index'){
      const type=this.infer(node.target),{get,set}=this.frameworkIndexer(type)??{};
      if(get||set){const keyType=get?.parameters[0]??set.parameters[0],valueType=get?.result??set.parameters[1];if(!set)this.c.report(node,DiagnosticId.CS0200,[typeText(type)+'.this[]']);const receiver=this.bindExpression(node.target),index=this.bindExpression(node.index);this.checkAssign(keyType,index.legacyType,node.index);return this.node(BoundIndexerAccess,node,{receiver,indexer:this.frameworkPropertySymbol(get,set),args:[index]},valueType,set?null:{hasErrors:true});}
    }
    const p=this.frameworkProperty(node);if(!p)return null;
    if(!p.set)this.c.report(node,DiagnosticId.CS0200,[node.name]);
    return this.node(BoundPropertyAccess,node,{receiver:p.receiver.isStatic?null:this.bindExpression(p.receiver.node),property:this.frameworkPropertySymbol(p.get,p.set)},p.type,p.set?null:{hasErrors:true});
  }
};
