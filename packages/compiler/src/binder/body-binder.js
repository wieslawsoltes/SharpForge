/**
 * Binding method bodies over the lossless syntax tree with the type-system modules of SF-A02-E01: every expression
 * gets a TypeSymbol, conversions come from conversions/classify.js, calls from overload/resolution.js, operators from
 * overload/operators.js, generic calls from overload/type-inference.js and binder/constraints.js, by-reference rules
 * from binder/ref-kinds.js and friends. The result is a tree of plain bound nodes `{kind,syntax,type,constantValue,...}`
 * (see `dumpSemanticTree`) that later passes (definite assignment, nullable walker, ref safety, lowering) consume.
 *
 * Framework members come from the closed registry bridge, which lists only part of the BCL. A lookup or overload
 * resolution that fails on a registry type is therefore not reported: the expression becomes a silent `Bad` node and
 * the binder records `incomplete`, so no false CS1061/CS1501 is produced for members the registry does not know.
 */
import {SymbolKind,TypeKind,RefKind,ErrorTypeSymbol,ArrayTypeSymbol,NamedTypeSymbol,TypeParameterSymbol,typeOf} from '../symbols/types.js';
import {MethodKind,LocalSymbol,LocalDeclarationKind,DeclarationModifiers,ParameterSymbol} from '../symbols/members.js';
import {ConstantValue,isFoldError} from '../constants/constant-value.js';
import {foldUnary,foldBinary,foldConversion,defaultValue} from '../constants/fold.js';
import {Conversion,ConversionKind} from '../conversions/classify.js';
import {numericKind} from '../conversions/numeric.js';
import {classifyConstantNarrowing} from '../conversions/constant-narrowing.js';
import {isNullableType,stripNullable,acceptsNullLiteral} from '../conversions/nullable.js';
import {typeTestOutcome,asOperatorTargetValid} from '../conversions/reference.js';
import {convertMethodGroup,naturalDelegateType} from '../conversions/method-group.js';
import {delegateInvoke} from '../overload/type-inference.js';
import {resolveExtensionInvocation,extensionScopes} from '../overload/extension-methods.js';
import {lookupMembers} from './inheritance.js';
import {isAccessible} from './accessibility.js';
import {checkWritable,argumentRefKind,classifyVariable} from './ref-kinds.js';
import {checkConstructedMethod,checkConstructedType} from './constraints.js';
import {isVirtualCall} from './overrides.js';
import {receiverPassing} from './readonly.js';
import {staticMembersOfTypeParameter} from './interface-members.js';
import {findConstruction} from '../symbols/substitution.js';
import {statementMethods} from './body-statements.js';

const unknown=ErrorTypeSymbol.unknown;
const binaryOperators={AddExpression:'+',SubtractExpression:'-',MultiplyExpression:'*',DivideExpression:'/',ModuloExpression:'%',LeftShiftExpression:'<<',RightShiftExpression:'>>',UnsignedRightShiftExpression:'>>>',LogicalOrExpression:'||',LogicalAndExpression:'&&',BitwiseOrExpression:'|',BitwiseAndExpression:'&',ExclusiveOrExpression:'^',EqualsExpression:'==',NotEqualsExpression:'!=',LessThanExpression:'<',LessThanOrEqualExpression:'<=',GreaterThanExpression:'>',GreaterThanOrEqualExpression:'>='};
const unaryOperators={UnaryPlusExpression:'+',UnaryMinusExpression:'-',BitwiseNotExpression:'~',LogicalNotExpression:'!'};
/** True for symbols whose member lists are authoritative: declared in source or imported from a referenced assembly's metadata. */
const isSource=symbol=>{for(let s=symbol?.originalDefinition??symbol;s;s=s.containingSymbol)if(s.isSource||s.containingAssembly)return true;return false;};
const keywordOf=type=>numericKind(type)??({System_Boolean:'bool',System_String:'string',System_Char:'char',System_Object:'object'})[type?.specialType]??null;

export class BodyBinder{
  /**
   * @param driver `{core,conversions,overloads,operators,typeBinder,report(uri,node,code,args),versionOf(uri),gate(uri,node,key,fallback),nullableAt(uri,pos)}`
   * @param context `{uri,scope,containingType,method,isStatic,returnType,returnRefKind,isAsync,isIterator,isFieldInitializer,parent}`
   */
  constructor(driver,context){
    this.d=driver;this.core=driver.core;this.conversions=driver.conversions;this.c=context;this.scopes=[new Map()];this.pending=[new Set()];this.locals=[];this.loopDepth=0;this.switchDepth=0;this.catchDepth=0;this.finallyDepth=0;this.quiet=context.quiet??null;this.incomplete=false;this.returns=[];this.checked=false;this.localFunctions=[];this.usesGoto=false;
    for(const p of context.parameters??context.method?.parameters??[])if(p.name)this.scopes[0].set(p.name,p);
  }
  // ---- infrastructure ----
  report(node,code,args=[]){if(this.quiet){this.quiet.push({node,code,args});return;}this.d.report(this.c.uri,node,code,args);}
  node(kind,syntax,type,props){const n={kind,syntax,type:type??null,constantValue:null,...props};if(kind==='MethodGroup'&&!n.convert)n.convert=to=>this.groupConversion(n,to);return n;}
  bad(syntax,props){return {kind:'Bad',syntax,type:unknown,hasErrors:true,constantValue:null,...props};}
  /** A silent failure caused by the closed framework registry. */
  lenient(syntax){this.incomplete=true;this.d.incomplete=true;return this.bad(syntax);}
  get version(){return this.d.versionOf(this.c.uri);}
  lookupLocal(name){for(let b=this;b;b=b.c.parent){for(let i=b.scopes.length-1;i>=0;i--){const s=b.scopes[i].get(name);if(s){if(b!==this)s.isCaptured=true;return s;}}}return null;}
  isPending(name){for(let i=this.pending.length-1;i>=0;i--)if(this.pending[i].has(name))return true;return false;}
  declare(name,symbol,node){
    const current=this.scopes.at(-1);
    if(current.has(name)){this.report(node,'CS0128',[name]);return symbol;}
    for(let b=this;b;b=b.c.parent){const from=b===this?this.scopes.length-2:b.scopes.length-1;for(let i=from;i>=0;i--)if(b.scopes[i].has(name)){this.report(node,'CS0136',[name]);current.set(name,symbol);return symbol;}}
    // A name declared later in an enclosing scope also conflicts (the outer local's scope is its whole block).
    for(let i=this.pending.length-2;i>=0;i--)if(this.pending[i].has(name)){this.report(node,'CS0136',[name]);break;}
    current.set(name,symbol);this.pending.at(-1).delete(name);return symbol;
  }
  pushScope(pendingNames=[]){this.scopes.push(new Map());this.pending.push(new Set(pendingNames));}
  popScope(){this.scopes.pop();this.pending.pop();}
  newLocal(name,type,syntax,kind=LocalDeclarationKind.Regular,extra={}){const local=new LocalSymbol({name,type:type??unknown,declarationKind:kind,containingSymbol:this.c.method,syntax,locations:[{uri:this.c.uri,start:syntax.span.start,end:syntax.span.end}],...extra});local.reads=0;local.writes=0;local.depth=this.scopes.length-1;this.locals.push(local);this.rootBinder.allLocals.push(local);return local;}
  get rootBinder(){let b=this;while(b.c.parent)b=b.c.parent;b.allLocals??=[];return b;}
  bindType(syntax,options){return this.d.typeBinder.bindType(syntax,this.typeScope,options);}
  get typeScope(){return this.c.scope;}
  display(type){return type?type.toDisplayString():'<null>';}
  // ---- conversions ----
  /** Converts a bound expression to a type implicitly, reporting the Roslyn diagnostic when no conversion exists. */
  convert(e,type,node=e.syntax,{argument=null}={}){
    if(!type||e.hasErrors||type.isErrorType()||e.type?.isErrorType?.())return e;
    if(e.kind==='TypeExpression'||e.kind==='NamespaceExpression'){this.report(e.syntax,'CS0119',[e.kind==='TypeExpression'?this.display(e.referencedType):e.namespace.toDisplayString(),e.kind==='TypeExpression'?'type':'namespace']);return this.bad(node);}
    if(e.type&&!e.literal&&!e.form&&!e.constantValue&&e.type.equals(type))return e;
    const c=this.conversions.classifyFromExpression(e,type);
    if(c.exists&&c.isImplicit&&!c.isAmbiguous)return this.applyConversion(e,type,c,node);
    this.reportConversionFailure(e,type,node,c);return this.bad(node,{operand:e});
  }
  applyConversion(e,type,c,node=e.syntax,isExplicit=false){
    if(c.kind===ConversionKind.Identity&&e.type&&!e.constantValue?.isEnum&&e.type.equals(type))return e;
    if(e.materialize&&(c.kind===ConversionKind.ObjectCreation||c.kind===ConversionKind.CollectionExpression||e.isTargetTypedConditional||e.isTargetTypedSwitch))return e.materialize(type);
    if(e.form==='lambda'&&c.kind===ConversionKind.AnonymousFunction){e.boundAs=type;return this.node('Conversion',node,type,{operand:e,conversion:c,isExplicit});}
    const result=this.node('Conversion',node,type,{operand:e,conversion:c,isExplicit,isImplicitIdentity:c.kind===ConversionKind.Identity});
    if(e.constantValue){const target=type.typeKind===TypeKind.Enum?type:keywordOf(stripNullable(type));
      if(target&&!isNullableType(type)){const folded=foldConversion(e.constantValue,target,{checked:!this.uncheckedContext});if(isFoldError(folded)){this.report(node,folded.error.code,folded.error.args);result.hasErrors=true;}else if(folded)result.constantValue=folded;}
      else if(e.constantValue.isNull&&type.isReferenceType===true)result.constantValue=ConstantValue.null(keywordOf(type)??'object');}
    return result;
  }
  reportConversionFailure(e,type,node,c){
    const to=this.display(type);
    if(c?.isAmbiguous){this.report(node,'CS0457',[c.candidates[0].toDisplayString(),c.candidates[1]?.toDisplayString()??'',this.display(e.type),to]);return;}
    if(e.literal==='null'){this.report(node,'CS0037',[to]);return;}
    if(e.form==='methodGroup'){const r=e.lastConversionError,at=e.nameNode&&node===e.syntax?e.nameNode:node;if(r&&delegateInvoke(type)){this.report(at,r.code,r.args);return;}this.report(at,'CS0428',[e.name,to]);return;}
    if(e.form==='lambda'){const r=e.lastConversionError;if(r)for(const x of r)this.report(x.node??node,x.code,x.args);else this.report(node,'CS1660',[e.isAnonymousMethod?'anonymous method':'lambda expression',to]);return;}
    if(e.noNaturalType){this.report(node,'CS0173',[this.operandDisplay(e.noNaturalType.left),this.operandDisplay(e.noNaturalType.right)]);return;}
    if(e.isTargetTypedSwitch){this.report(node,'CS8506');return;}
    if(e.form==='implicitNew'){this.report(node,'CS8752',[to]);return;}
    if(!e.type){this.report(node,'CS0029',['?',to]);return;}
    if(e.type.specialType==='System_Void'){this.report(node,'CS0029',['void',to]);return;}
    const from=this.display(e.type);
    // Numeric constants: CS0031 when the value does not fit, CS0664 for a double literal assigned to float/decimal.
    if(e.constantValue&&!e.constantValue.isNull){
      const a=this.conversions.kindOf(e.type),b=this.conversions.kindOf(stripNullable(type));
      if(a&&b){const r=classifyConstantNarrowing(a,e.constantValue.isIntegral?e.constantValue.bigint:null,b,{isRealLiteral:e.kind==='Literal'&&a==='double',display:e.constantValue.displayValue});if(r&&r.code&&r.code!=='CS0266'){this.report(node,r.code,r.args);return;}}
    }
    const explicit=this.conversions.classifyExplicit(e.type,type);
    this.report(node,explicit.exists?'CS0266':'CS0029',[from,to]);
  }
  /** Binds an expression that must produce a value (not a type, namespace or bare method group). */
  value(syntax,options){return this.asValue(this.expression(syntax,options));}
  asValue(e){
    if(e.hasErrors){if(e.kind==='Local')e.local.reads++;return e;}
    if(e.kind==='TypeExpression'){this.report(e.syntax,'CS0119',[this.display(e.referencedType),'type']);return this.bad(e.syntax);}
    if(e.kind==='NamespaceExpression'){this.report(e.syntax,'CS0119',[e.namespace.toDisplayString(),'namespace']);return this.bad(e.syntax);}
    return this.markRead(e);
  }
  markRead(e){if(e.kind==='PropertyAccess'&&!e.readChecked){e.readChecked=true;const p=e.property;if(!p.getMethod&&p.setMethod)this.report(e.syntax,'CS0154',[p.toDisplayString()]);else if(p.getMethod&&p.getMethod.declaredAccessibility!==p.declaredAccessibility&&!isAccessible(p.getMethod.originalDefinition??p.getMethod,this.c.containingType?.originalDefinition??null,{withinModule:this.d.assembly.module}))this.report(e.syntax,'CS0271',[p.toDisplayString()]);}
    if(e.kind==='Local'){e.local.reads++;}else if(e.kind==='FieldAccess'){const f=e.field.originalDefinition??e.field;f.reads=(f.reads??0)+1;}else if(e.kind==='MethodGroup'&&e.methods.length===1&&e.methods[0].methodKind===MethodKind.LocalFunction)e.methods[0].uses=(e.methods[0].uses??0)+1;return e;}
  markWrite(e,value){if(e.kind==='Local'){e.local.writes++;if(value&&!(value.constantValue||value.literal||value.kind==='Default'))e.local.nonConstantWrite=true;}else if(e.kind==='FieldAccess'){const f=e.field.originalDefinition??e.field;f.writes=(f.writes??0)+1;if(value&&!(value.constantValue||value.literal||value.kind==='Default')||!value)f.nonConstantWrite=true;}}
  /** Binds and converts to bool (conditions), accepting `operator true`. */
  condition(syntax){
    const e=this.value(syntax);if(e.hasErrors||!e.type)return e.type?e:this.convert(e,this.core.bool);
    if(e.type.specialType==='System_Boolean')return e;
    const c=this.conversions.classifyFromExpression(e,this.core.bool);if(c.exists&&c.isImplicit)return this.applyConversion(e,this.core.bool,c);
    const op=this.d.operators.trueOperator(e.type);if(op)return this.node('UserDefinedCondition',syntax,this.core.bool,{operand:e,method:op});
    return this.convert(e,this.core.bool);
  }
  // ---- expressions ----
  expression(syntax,options={}){
    const kind=syntax.kind;
    if(binaryOperators[kind])return this.binary(syntax,binaryOperators[kind]);
    if(unaryOperators[kind])return this.unary(syntax,unaryOperators[kind]);
    if(kind.endsWith('AssignmentExpression'))return this.assignment(syntax);
    switch(kind){
      case 'ParenthesizedExpression':return this.expression(syntax.expression,options);
      case 'NumericLiteralExpression':{const v=syntax.token.value;if(!v||!v.type)return this.bad(syntax);const type=this.core.keyword(v.type);let constant=null;try{constant=ConstantValue.of(v.type,v.value);}catch{constant=null;}const n=this.node('Literal',syntax,type);n.constantValue=constant;return n;}
      case 'TrueLiteralExpression':case 'FalseLiteralExpression':{const n=this.node('Literal',syntax,this.core.bool);n.constantValue=ConstantValue.bool(kind==='TrueLiteralExpression');return n;}
      case 'StringLiteralExpression':case 'Utf8StringLiteralExpression':{const n=this.node('Literal',syntax,this.core.string);if(kind==='Utf8StringLiteralExpression')return this.lenient(syntax);n.constantValue=ConstantValue.string(syntax.token.value??'');return n;}
      case 'CharacterLiteralExpression':{const n=this.node('Literal',syntax,this.core.char);const v=syntax.token.value;if(typeof v==='string'&&v.length===1)n.constantValue=ConstantValue.char(v);return n;}
      case 'NullLiteralExpression':{const n=this.node('Literal',syntax,null,{literal:'null'});n.constantValue=ConstantValue.null();return n;}
      case 'DefaultLiteralExpression':return this.node('Literal',syntax,null,{literal:'default'});
      case 'IdentifierName':return this.identifier(syntax,options);
      case 'GenericName':return this.identifier(syntax,options);
      case 'PredefinedType':return this.node('TypeExpression',syntax,null,{referencedType:this.core.keyword(syntax.keyword.text)??unknown});
      case 'ThisExpression':{
        if(this.c.isStatic||!this.c.containingType){this.report(syntax,this.c.isFieldInitializer&&!this.c.isStaticInitializer?'CS0027':'CS0026');return this.bad(syntax);}
        if(this.c.isFieldInitializer){this.report(syntax,'CS0027');return this.bad(syntax);}
        return this.node('This',syntax,this.c.containingType);
      }
      case 'BaseExpression':{
        if(this.c.isStatic||!this.c.containingType){this.report(syntax,'CS1511');return this.bad(syntax);}
        const base=this.c.containingType.baseType;if(!base)return this.bad(syntax);
        return this.node('Base',syntax,base,{isBase:true});
      }
      case 'SimpleMemberAccessExpression':return this.memberAccess(syntax,options);
      case 'InvocationExpression':return this.invocation(syntax);
      case 'ElementAccessExpression':return this.elementAccess(syntax);
      case 'ObjectCreationExpression':return this.objectCreation(syntax);
      case 'ImplicitObjectCreationExpression':return this.implicitCreation(syntax);
      case 'ArrayCreationExpression':case 'ImplicitArrayCreationExpression':return this.arrayCreation(syntax);
      case 'CastExpression':return this.cast(syntax);
      case 'ConditionalExpression':return this.conditional(syntax);
      case 'CoalesceExpression':return this.coalesce(syntax);
      case 'IsExpression':case 'IsPatternExpression':return this.isExpression(syntax);
      case 'AsExpression':return this.asExpression(syntax);
      case 'PreIncrementExpression':case 'PreDecrementExpression':case 'PostIncrementExpression':case 'PostDecrementExpression':return this.increment(syntax);
      case 'SuppressNullableWarningExpression':{const e=this.expression(syntax.operand,options);return e.hasErrors?e:{...e,syntax,suppressed:true};}
      case 'DefaultExpression':{const type=this.bindType(syntax.type).type;const n=this.node('Default',syntax,type);if(!type.isErrorType()&&!isNullableType(type)&&(keywordOf(type)||type.typeKind===TypeKind.Enum||type.isReferenceType===true)){try{n.constantValue=defaultValue(type.typeKind===TypeKind.Enum?type:keywordOf(type)??'object');}catch{n.constantValue=null;}}return n;}
      case 'TypeOfExpression':{this.bindType(syntax.type,{allowUnbound:true});return this.node('TypeOf',syntax,this.core.type);}
      case 'SizeOfExpression':{const type=this.bindType(syntax.type).type;const n=this.node('SizeOf',syntax,this.core.int);const size={sbyte:1,byte:1,bool:1,short:2,ushort:2,char:2,int:4,uint:4,float:4,long:8,ulong:8,double:8,decimal:16}[keywordOf(type)];if(size)n.constantValue=ConstantValue.int(size);return n;}
      case 'CheckedExpression':case 'UncheckedExpression':{const saved=[this.checked,this.uncheckedContext];this.checked=kind==='CheckedExpression';this.uncheckedContext=!this.checked;try{const e=this.value(syntax.expression);return e.hasErrors?e:{...e,syntax};}finally{[this.checked,this.uncheckedContext]=saved;}}
      case 'InterpolatedStringExpression':{const parts=[];for(const content of syntax.contents)if(content.kind==='Interpolation'){parts.push(this.value(content.expression));if(content.alignmentClause)this.convert(this.value(content.alignmentClause.value),this.core.int);}return this.node('InterpolatedString',syntax,this.core.string,{parts,form:'interpolatedString'});}
      case 'AwaitExpression':return this.await(syntax);
      case 'ThrowExpression':{const e=this.value(syntax.expression);this.checkThrown(e,syntax.expression);return this.node('Throw',syntax,null,{operand:e,form:'throw'});}
      case 'SimpleLambdaExpression':case 'ParenthesizedLambdaExpression':case 'AnonymousMethodExpression':return this.lambda(syntax);
      case 'TupleExpression':return this.tuple(syntax);
      case 'ConditionalAccessExpression':return this.conditionalAccess(syntax);
      case 'RefExpression':{const e=this.value(syntax.expression);return e.hasErrors?e:this.node('Ref',syntax,e.type,{operand:e,isRef:true});}
      case 'DeclarationExpression':return this.declarationExpression(syntax,null);
      case 'SwitchExpression':return this.switchExpression(syntax);
      case 'CollectionExpression':return this.collectionExpression(syntax);
      case 'AnonymousObjectCreationExpression':case 'QueryExpression':case 'RangeExpression':case 'WithExpression':case 'StackAllocArrayCreationExpression':case 'ImplicitStackAllocArrayCreationExpression':case 'IndexExpression':
        // Bound by later epics (anonymous types, queries, ranges, records): operands are still bound for their own diagnostics.
        for(const child of syntax.childNodes())if(/Expression$|Name$/.test(child.kind)&&kind!=='QueryExpression'&&kind!=='AnonymousObjectCreationExpression')this.expression(child);
        return this.lenient(syntax);
      default:return this.lenient(syntax);
    }
  }
  typeArgumentsOf(syntax){return syntax.kind==='GenericName'?syntax.typeArgumentList.arguments.map(a=>this.bindType(a).type):null;}
  /** A simple name: local, parameter, member of an enclosing type, type, namespace or using-static member. */
  identifier(syntax,options={}){
    const name=syntax.identifier.valueText,typeArguments=this.typeArgumentsOf(syntax),arity=typeArguments?.length??0;
    if(syntax.identifier.isMissing)return this.bad(syntax);
    {
      const local=this.lookupLocal(name);
      if(local&&(!arity||local.kind===SymbolKind.Method)){
        if(local.kind===SymbolKind.Local)return this.localNode(local,syntax);
        if(local.kind===SymbolKind.Parameter)return this.node('Parameter',syntax,local.type,{parameter:local});
        if(local.kind===SymbolKind.Method)return this.node('MethodGroup',syntax,null,{methods:[local],receiver:null,name,form:'methodGroup',typeArguments});
      }
      if(!arity&&this.isPending(name)){this.report(syntax,'CS0841',[name]);(this.rootBinder.usedBeforeDeclaration??=new Set()).add(name);return this.bad(syntax);}
      if(!arity&&name==='_'&&options.allowDiscard)return this.node('Discard',syntax,null,{isOutVarOrDiscard:true});
    }
    // Members of the containing types, innermost first.
    for(let type=this.c.containingType,first=true;type;type=type.containingType,first=false){
      const found=lookupMembers(type,name,this.core,{within:this.c.containingType});
      if(found.members.length){const r=this.memberResult(found.members,syntax,null,type,name,typeArguments,options,!first);if(r)return r;}
      else if(found.inaccessible.length&&!this.d.typeBinder.lookup(name,arity,this.typeScope)){this.report(syntax,'CS0122',[found.inaccessible[0].toDisplayString()]);return this.bad(syntax);}
    }
    const symbol=this.d.typeBinder.lookup(name,arity,this.typeScope);
    if(symbol&&!symbol.ambiguous&&!symbol.wrongArity){
      if(symbol.kind===SymbolKind.Namespace)return this.node('NamespaceExpression',syntax,null,{namespace:symbol});
      const type=arity?this.bindType(syntax).type:symbol;return this.node('TypeExpression',syntax,null,{referencedType:type});
    }
    if(symbol?.ambiguous){this.report(syntax,'CS0104',[name,symbol.ambiguous[0].toDisplayString(),symbol.ambiguous[1].toDisplayString()]);return this.bad(syntax);}
    // using static members
    for(const level of this.typeScope.namespaceChain){const usings=level.scope.usings?this.d.typeBinder.usingsOf(level.scope):null;if(!usings)continue;
      const members=usings.staticTypes.flatMap(t=>t.getMembers(name).filter(m=>m.isStatic));if(members.length)return this.memberResult(members.filter(m=>m.kind===members[0].kind),syntax,null,members[0].containingType,name,typeArguments,options,false)??this.bad(syntax);}
    if(name==='nameof'&&options.invoked)return this.node('NameOfMarker',syntax,null,{});
    if(name==='var'||name==='dynamic')return this.lenient(syntax);
    if(this.d.isKnownFrameworkName(name))return this.lenient(syntax);
    this.report(syntax.kind==='GenericName'?syntax:syntax.identifier,'CS0103',[name]);return this.bad(syntax);
  }
  localNode(local,syntax){const n=this.node('Local',syntax,local.type,{local});if(local.isConst&&local.constantValueObject)n.constantValue=local.constantValueObject;if(local.type?.isErrorType?.())n.hasErrors=true;return n;}
  /** Turns looked-up members into a bound node; `receiver` null means an implicit `this` or a static access through a simple name. */
  memberResult(members,syntax,receiver,type,name,typeArguments,options={},outer=false){
    const first=members[0],nameNode=syntax.kind==='SimpleMemberAccessExpression'?syntax.name:syntax;
    if(first.kind===SymbolKind.NamedType){const t=typeArguments?this.construct(first,typeArguments,nameNode):first;return this.node('TypeExpression',syntax,null,{referencedType:t});}
    const viaType=receiver?.kind==='TypeExpression',implicit=!receiver;
    const instanceReceiver=()=>{
      if(!implicit)return receiver;
      if(this.c.isStatic||this.c.isFieldInitializer&&!this.c.isStaticInitializer||outer){return null;}
      return this.node('This',syntax,this.c.containingType,{isImplicit:true});
    };
    if(first.kind===SymbolKind.Method){
      const methods=members.filter(m=>m.kind===SymbolKind.Method);
      return this.node('MethodGroup',syntax,null,{methods,receiver:viaType?null:receiver,receiverType:viaType?receiver.referencedType:receiver?.type??type,viaType,implicitReceiver:implicit,outer,name,nameNode,form:'methodGroup',typeArguments,convert:null});
    }
    const used=()=>{if(first.kind===SymbolKind.Field){const f=first.originalDefinition??first;f.reads=(f.reads??0)+1;}};
    if(typeArguments){this.report(nameNode,'CS0307',[first.kind===SymbolKind.Field?'field':first.kind===SymbolKind.Property?'property':'event',name]);return this.bad(syntax);}
    const isStatic=first.isStatic;let r=null;
    if(isStatic){if(receiver&&!viaType&&receiver.kind!=='Base'){
        // `Color Color`: a member whose name equals its type's name may be read as the type.
        if(!(receiver.syntax?.kind==='IdentifierName'&&receiver.type&&receiver.syntax.identifier.valueText===receiver.type.name)){used();this.report(syntax,'CS0176',[first.toDisplayString()]);return this.bad(syntax);}}}
    else{
      if(viaType){
        if(receiver.syntax?.kind==='IdentifierName'&&receiver.colorColor)r=receiver.colorColor;
        else{used();this.report(syntax,'CS0120',[first.toDisplayString()]);return this.bad(syntax);}
      }else{r=instanceReceiver();if(!r){used();this.report(syntax,this.c.isFieldInitializer&&!this.c.isStatic&&!outer?'CS0236':outer&&!this.c.isStatic?'CS0038':'CS0120',this.c.isFieldInitializer&&!this.c.isStatic&&!outer?[first.toDisplayString()]:outer&&!this.c.isStatic?[type.toDisplayString(),this.c.containingType.toDisplayString()]:[first.toDisplayString()]);return this.bad(syntax);}}
    }
    switch(first.kind){
      case SymbolKind.Field:{const n=this.node('FieldAccess',syntax,first.type,{field:first,receiver:r});
        if(first.isConst||first.isEnumMember){const cv=this.d.constantOf(first.originalDefinition??first);if(cv)n.constantValue=cv;else if(first.isConst)n.hasErrors=true;
          // Inside an enum's own member initializers the other members have the underlying type (no casts needed).
          if(first.isEnumMember&&this.c.enumInitializerOf===first.containingType){n.type=this.core.enumUnderlying(first.containingType);if(cv)n.constantValue=ConstantValue.integral(cv.type,cv.bigint);else n.hasErrors=true;}}
        if(first.type?.isErrorType?.())n.hasErrors=true;return n;}
      case SymbolKind.Property:{const n=this.node('PropertyAccess',syntax,first.type,{property:first,receiver:r});if(first.type?.isErrorType?.())n.hasErrors=true;return n;}
      case SymbolKind.Event:return this.node('EventAccess',syntax,first.type,{event:first,receiver:r});
    }
    return this.lenient(syntax);
  }
  construct(definition,typeArguments,node){
    if(definition.arity!==typeArguments.length){this.report(node,definition.arity?'CS0305':'CS0308',definition.arity?[definition.toDisplayString(),'type',definition.arity]:[definition.toDisplayString(),'type']);return unknown;}
    const type=definition.construct(typeArguments);for(const v of checkConstructedType(type,this.core))this.report(node,v.code,v.args);return type;
  }
  memberAccess(syntax,options={}){
    const nameSyntax=syntax.name;if(!nameSyntax||nameSyntax.identifier?.isMissing)return this.bad(syntax);
    const name=nameSyntax.identifier.valueText,typeArguments=this.typeArgumentsOf(nameSyntax);
    let left=this.expression(syntax.expression,{...options,invoked:false,memberAccessLeft:true});if(left.hasErrors){if(left.kind==='Local')left.local.reads++;
      // A member named after a field of the enclosing type counts as a use of that field even though the access failed.
      for(let t=this.c.containingType;t;t=t.containingType)for(const f of t.getMembers(name))if(f.kind===SymbolKind.Field)(f.originalDefinition??f).reads=((f.originalDefinition??f).reads??0)+1;
      return this.bad(syntax,{operand:left});}
    // Color Color: an identifier that binds to a member whose type has the same name can also denote the type.
    if(syntax.expression.kind==='IdentifierName'&&left.type&&left.kind!=='TypeExpression'&&left.type.name===syntax.expression.identifier.valueText){const t=this.d.typeBinder.lookup(left.type.name,0,this.typeScope);if(t&&t===left.type.originalDefinition){const statics=lookupMembers(left.type,name,this.core,{within:this.c.containingType}).members;if(statics.length&&statics[0].isStatic||statics[0]?.kind===SymbolKind.NamedType)left=this.node('TypeExpression',syntax.expression,null,{referencedType:left.type,colorColor:left});}}
    if(left.kind==='NamespaceExpression'){
      const ns=left.namespace,arity=typeArguments?.length??0,type=ns.getTypeMembers(name,arity)[0];
      if(type)return this.node('TypeExpression',syntax,null,{referencedType:typeArguments?this.construct(type,typeArguments,nameSyntax):type});
      const child=arity?null:ns.getNamespace(name);if(child)return this.node('NamespaceExpression',syntax,null,{namespace:child});
      if(this.d.tolerateNamespace(ns.toDisplayString()))return this.lenient(syntax);
      this.report(nameSyntax,'CS0234',[name,ns.toDisplayString()]);return this.bad(syntax);
    }
    if(left.kind==='TypeExpression'){
      const type=left.referencedType;if(type.isErrorType())return this.bad(syntax);
      if(type.typeKind===TypeKind.TypeParameter){const statics=staticMembersOfTypeParameter(type,name,this.core);if(statics.length)return this.memberResult(statics,syntax,left,type,name,typeArguments,options);this.report(syntax.expression,'CS0119',[type.name,'type parameter']);return this.bad(syntax);}
      const found=lookupMembers(type,name,this.core,{within:this.c.containingType});
      if(!found.members.length){
        if(found.inaccessible.length){this.report(nameSyntax,'CS0122',[found.inaccessible[0].toDisplayString()]);return this.bad(syntax);}
        if(!isSource(type)&&type.typeKind!==TypeKind.Enum)return this.reportMissingFrameworkMember(type,name,nameSyntax,syntax,'CS0117');
        this.report(nameSyntax,'CS0117',[this.display(type),name]);return this.bad(syntax);
      }
      return this.memberResult(found.members,syntax,left,type,name,typeArguments,options)??this.bad(syntax);
    }
    left=this.asValue(left);if(left.hasErrors)return this.bad(syntax);
    if(left.kind==='MethodGroup'||left.form==='lambda'||left.literal){this.report(syntax,'CS0023',['.',left.literal==='null'?'<null>':left.literal==='default'?'default':left.form==='lambda'?'lambda expression':'method group']);return this.bad(syntax);}
    const type=left.type;if(!type)return this.bad(syntax);
    if(type.specialType==='System_Void'){this.report(syntax,'CS0023',['.','void']);return this.bad(syntax);}
    return this.instanceMember(left,type,name,nameSyntax,syntax,typeArguments,options);
  }
  /** Member lookup on a value of `type`; falls back to extension methods when invoked. */
  instanceMember(left,type,name,nameSyntax,syntax,typeArguments,options){
    const lookupType=type instanceof ArrayTypeSymbol?this.core.array:type;
    const found=lookupMembers(lookupType,name,this.core,{within:this.c.containingType,throughType:left.kind==='Base'?this.c.containingType:type});
    if(type instanceof ArrayTypeSymbol&&!found.members.length){if(name==='Length'||name==='Rank')return this.node('ArrayLength',syntax,this.core.int,{array:left,member:name});if(name==='LongLength')return this.node('ArrayLength',syntax,this.core.long,{array:left,member:name});}
    if(found.members.length)return this.memberResult(found.members,syntax,left,type,name,typeArguments,options)??this.bad(syntax);
    if(found.inaccessible.length){this.report(nameSyntax,'CS0122',[found.inaccessible[0].toDisplayString()]);return this.bad(syntax);}
    if(type.hasUnknownConstraint||!this.d.closedHierarchy(type))return this.lenient(syntax);
    // Extension methods (only meaningful when the name is invoked, but a method group conversion may also use them).
    const scopes=extensionScopes(this.typeScope.namespaceChain.map(l=>({namespace:l.namespace,usings:l.scope.usings?this.d.typeBinder.usingsOf(l.scope):null})),name);
    if(scopes.length)return this.node('MethodGroup',syntax,null,{methods:[],extensionScopes:scopes,receiver:left,receiverType:type,name,nameNode:nameSyntax,form:'methodGroup',typeArguments,isExtensionOnly:true});
    if(!isSource(type)&&type.typeKind!==TypeKind.TypeParameter)return this.reportMissingFrameworkMember(type,name,nameSyntax,syntax,'CS1061');
    this.report(nameSyntax,'CS1061',[this.display(type),name]);return this.bad(syntax);
  }
  /** A member the registry does not list: reported only for the types whose member set the registry is known to cover. */
  reportMissingFrameworkMember(type,name,nameSyntax,syntax,code){
    if(this.d.registryIsComplete(type,name)){this.report(nameSyntax,code,[this.display(type),name]);return this.bad(syntax);}
    return this.lenient(syntax);
  }
  // ---- arguments and calls ----
  argument(a){
    const refKind=argumentRefKind(a),name=a.nameColon?.name.identifier.valueText??null;let e;
    if(refKind===RefKind.Out&&a.expression.kind==='DeclarationExpression')e=this.declarationExpression(a.expression,a);
    else if(refKind===RefKind.Out&&a.expression.kind==='IdentifierName'&&a.expression.identifier.valueText==='_'&&!this.lookupLocal('_'))e=this.node('Discard',a.expression,null,{isOutVarOrDiscard:true});
    else e=this.expression(a.expression);
    if(e.kind==='TypeExpression'||e.kind==='NamespaceExpression')e=this.asValue(e);
    else if(refKind===RefKind.Out)this.markWrite(e,null);else this.markRead(e);
    if(e.kind==='MethodGroup'&&!e.convert)e.convert=to=>this.groupConversion(e,to);
    if(e.kind==='MethodGroup'){e.methodGroup={returnTypeFor:types=>this.groupReturnType(e,types)};}
    return Object.assign(e.hasErrors?{...e}:e,{refKind:refKind===RefKind.None?null:refKind,name,argumentSyntax:a});
  }
  arguments(list){return (list?.arguments??[]).map(a=>this.argument(a));}
  groupConversion(group,to){
    if(!delegateInvoke(to))return null;
    let methods=group.methods;
    if(group.isExtensionOnly)methods=group.extensionScopes.flatMap(s=>s.methods);
    const r=convertMethodGroup({methods,hasReceiver:group.viaType?false:group.receiver?true:undefined,isStaticContext:this.c.isStatic,typeArguments:group.typeArguments,name:group.name},to,this.d.overloads,{improvedCandidates:this.version.number>=7.3});
    group.lastConversionError=r.error??null;if(r.method)r.method.uses=(r.method.uses??0)+1;
    return r.conversion.exists?r.conversion:null;
  }
  groupReturnType(group,parameterTypes){const r=this.d.overloads.resolve(group.methods,parameterTypes.map(type=>({type})),{typeArguments:group.typeArguments});return r.succeeded?r.method.returnType:null;}
  /** Where an overload-resolution error is reported: the offending argument, or the method name. */
  errorNode(error,args,nameNode,offset=0){if(error.argument!==undefined&&args[error.argument-offset]?.argumentSyntax){const a=args[error.argument-offset].argumentSyntax;return error.code==='CS1739'||error.code==='CS1740'||error.code==='CS1744'?a.nameColon.name:error.code==='CS1620'||error.code==='CS1615'?a.expression:a.expression;}return nameNode;}
  invocation(syntax){
    const target=this.expression(syntax.expression,{invoked:true});
    if(target.kind==='NameOfMarker'){const a=syntax.argumentList.arguments[0];if(!a)return this.bad(syntax);const saved=this.quiet;this.quiet=[];let inner;try{inner=this.expression(a.expression,{nameofOperand:true});}finally{const errors=this.quiet;this.quiet=saved;if(inner.hasErrors&&!this.incomplete)for(const x of errors)this.report(x.node,x.code,x.args);}
      const last=a.expression.kind==='SimpleMemberAccessExpression'?a.expression.name:a.expression,n=this.node('NameOf',syntax,this.core.string);n.constantValue=ConstantValue.string(last.identifier?.valueText??last.toString());return n;}
    const args=this.arguments(syntax.argumentList);
    // A call that could not be bound still evaluates its arguments: `out` arguments stay assigned for flow analysis.
    const outArguments=()=>args.map(a=>({expression:a,refKind:a.refKind??null}));
    if(target.hasErrors)return this.bad(syntax,{args:outArguments()});
    if(target.kind==='MethodGroup'){const r=this.call(target,args,syntax);if(r.kind==='Bad'&&!r.args)r.args=outArguments();return r;}
    const value=this.asValue(target);if(value.hasErrors)return value;
    const invoke=value.type?delegateInvoke(value.type):null;
    if(invoke&&value.type.typeKind===TypeKind.Delegate){
      const r=this.d.overloads.resolve([invoke],args,{isDelegate:true,name:this.display(value.type)});
      if(!r.succeeded){if(args.some(a=>a.hasErrors))return this.bad(syntax);const e=r.error;this.report(this.errorNode(e,args,syntax),e.code,e.args);return this.bad(syntax);}
      return this.finishCall(r,value,args,syntax,{isDelegateInvoke:true});
    }
    if(value.type?.isErrorType?.())return this.bad(syntax);
    if((value.kind==='FieldAccess'||value.kind==='PropertyAccess'||value.kind==='EventAccess')&&!isSource(value.field??value.property??value.event))return this.lenient(syntax);
    if(value.kind==='FieldAccess'||value.kind==='PropertyAccess'||value.kind==='EventAccess'){this.report(syntax.expression.kind==='SimpleMemberAccessExpression'?syntax.expression.name:syntax.expression,'CS1955',[(value.field??value.property??value.event).toDisplayString()]);return this.bad(syntax);}
    this.report(syntax.expression,'CS0149');return this.bad(syntax);
  }
  call(group,args,syntax){
    const nameNode=group.nameNode??group.syntax,anyBad=args.some(a=>a.hasErrors);
    let result=null;
    if(group.methods.length){
      // An instance method reached without a receiver from a static context is dropped before resolution only if statics remain.
      result=this.d.overloads.resolve(group.methods,args,{typeArguments:group.typeArguments,name:group.name});
    }
    if((!result||!result.succeeded)&&group.receiver&&!group.viaType&&group.kind==='MethodGroup'){
      const scopes=group.extensionScopes??extensionScopes(this.typeScope.namespaceChain.map(l=>({namespace:l.namespace,usings:l.scope.usings?this.d.typeBinder.usingsOf(l.scope):null})),group.name);
      if(scopes.length&&!anyBad){const ext=resolveExtensionInvocation(group.name,group.receiver,args,scopes,this.d.overloads,{typeArguments:group.typeArguments});
        if(ext.succeeded)return this.finishCall(ext,null,[Object.assign({...group.receiver},{refKind:null,name:null}),...args],syntax,{isExtension:true,group});
        if(!result&&ext.found){if(ext.error&&scopes.flatMap(s=>s.methods).every(isSource)){const offset=ext.extensionArgumentOffset??1;this.report(ext.error.argument!==undefined&&ext.error.argument>=offset?this.errorNode({...ext.error},args,nameNode,offset):nameNode,ext.error.code,ext.error.argument!==undefined&&ext.error.code==='CS1503'?[ext.error.args[0],ext.error.args[1],ext.error.args[2]]:ext.error.args);return this.bad(syntax);}return this.lenient(syntax);}}
      if(!result){if(anyBad)return this.bad(syntax);if(!isSource(group.receiverType))return this.reportMissingFrameworkMember(group.receiverType,group.name,nameNode,syntax,'CS1061');this.report(nameNode,'CS1061',[this.display(group.receiverType),group.name]);return this.bad(syntax);}
    }
    if(!result)return this.bad(syntax);
    if(!result.succeeded){
      if(anyBad)return this.bad(syntax);
      // The registry lists only some overloads of framework methods: a failed resolution there proves nothing.
      if(!group.methods.every(isSource)){if(!this.d.registryIsComplete(group.methods[0].containingType,group.name))return this.lenient(syntax);}
      const e=result.error;this.report(this.errorNode(e,args,nameNode),e.code,e.args);return this.bad(syntax);
    }
    return this.finishCall(result,group.receiver,args,syntax,{group});
  }
  finishCall(result,receiver,args,syntax,{group=null,isDelegateInvoke=false,isExtension=false}={}){
    const method=result.method,nameNode=group?.nameNode??group?.syntax??syntax;
    if(group&&!isExtension&&!isDelegateInvoke){
      if(method.methodKind!==MethodKind.LocalFunction){
        if(method.isStatic){if(group.receiver&&!group.viaType&&group.receiver.kind!=='This'){this.report(nameNode===group.nameNode?group.syntax:nameNode,'CS0176',[method.toDisplayString()]);return this.bad(syntax);}receiver=null;}
        else if(group.viaType){this.report(group.syntax,'CS0120',[method.toDisplayString()]);return this.bad(syntax);}
        else if(group.implicitReceiver){
          if(this.c.isStatic||group.outer||this.c.isFieldInitializer&&!this.c.isStaticInitializer){this.report(group.syntax,this.c.isFieldInitializer&&!this.c.isStatic?'CS0236':'CS0120',[method.toDisplayString()]);return this.bad(syntax);}
          receiver=this.node('This',group.syntax,this.c.containingType,{isImplicit:true});
        }
      }else{const definition=method.originalDefinition??method;definition.uses=(definition.uses??0)+1;}
      for(const v of checkConstructedMethod(method,this.core))this.report(nameNode,v.code,v.args,v.severity);
      if(receiver?.kind==='Base'&&method.isAbstract){this.report(syntax,'CS0205',[method.toDisplayString()]);}
    }
    if(isExtension)for(const v of checkConstructedMethod(method,this.core))this.report(nameNode,v.code,v.args);
    // Convert each argument to its parameter type and check by-reference arguments are variables.
    const converted=args.map((a,i)=>{
      const p=method.parameters[result.mapping.parameterOf[i]],conversion=result.conversions[i];
      if(a.refKind===RefKind.Ref||a.refKind===RefKind.Out){
        if(a.kind==='DeclarationExpression'||a.kind==='Discard'){if(a.local&&a.local.type.isErrorType()){a.local.setType(result.parameterTypes[i]);a.type=result.parameterTypes[i];}else if(!a.type)a.type=result.parameterTypes[i];}
        else{const w=checkWritable(a,a.refKind===RefKind.Ref?'ref':'out',this.variableContext);if(w)this.report(a.syntax,w.code,w.args);}
        return {expression:a,parameter:p,refKind:a.refKind};
      }
      const value=conversion&&a.type&&!a.hasErrors?this.applyConversion(a,result.parameterTypes[i],conversion,a.syntax):a;
      if(a.form==='lambda'&&!a.hasErrors)this.finishLambda(a,result.parameterTypes[i]);
      return {expression:value,parameter:p,refKind:a.refKind??null};
    });
    const type=method.returnType??this.core.void;
    const n=this.node('Call',syntax,type,{method,receiver,args:converted,expanded:result.expanded,mapping:result.mapping,isDelegateInvoke,isExtension,isVirtual:!isDelegateInvoke&&!isExtension&&isVirtualCall(method,{isBaseAccess:receiver?.kind==='Base',receiverType:receiver?.type}),constrainedTo:receiver?.type instanceof TypeParameterSymbol?receiver.type:group?.viaType&&group.receiverType instanceof TypeParameterSymbol?group.receiverType:null});
    if(receiver&&receiver.type?.isValueType===true&&!method.isStatic){const passing=receiverPassing(receiver,method,this.variableContext);n.receiverPassing=passing.mode;if(passing.warning)this.report(syntax,passing.warning.code,passing.warning.args);}
    if(type.isErrorType?.())n.hasErrors=true;
    return n;
  }
  get variableContext(){return {method:this.c.method,containingType:this.c.containingType,isFieldInitializer:this.c.isFieldInitializer,isStatic:this.c.isStatic,inObjectInitializer:this.inObjectInitializer};}
  declarationExpression(syntax,argument){
    const designation=syntax.designation,bound=this.bindType(syntax.type,{allowVar:true}),type=bound.isVar?unknown:bound.type;
    if(designation.kind==='DiscardDesignation')return this.node('Discard',syntax,bound.isVar?null:type,{isOutVarOrDiscard:true});
    if(designation.kind!=='SingleVariableDesignation')return this.lenient(syntax);
    const name=designation.identifier.valueText,local=this.newLocal(name,type,designation.identifier,LocalDeclarationKind.Out);local.writes++;local.isOutVar=true;
    this.declare(name,local,designation.identifier);
    return this.node('DeclarationExpression',syntax,bound.isVar?null:type,{local,isOutVarOrDiscard:true});
  }
  elementAccess(syntax){
    const target=this.value(syntax.expression),args=this.arguments(syntax.argumentList);
    if(target.hasErrors||args.some(a=>a.hasErrors))return this.bad(syntax);
    const type=target.type;if(!type){this.report(syntax,'CS0021',[target.literal==='null'?'<null>':'method group']);return this.bad(syntax);}
    if(type instanceof ArrayTypeSymbol){
      if(args.length!==type.rank){this.report(syntax,'CS0022',[type.rank]);return this.bad(syntax);}
      const indices=args.map(a=>{for(const t of [this.core.int,this.core.uint,this.core.long,this.core.ulong]){const c=this.conversions.classifyFromExpression(a,t);if(c.exists&&c.isImplicit)return this.applyConversion(a,t,c);}
        if(a.type&&['Index','Range'].includes(a.type.name))return a;return this.convert(a,this.core.int);});
      if(indices.some(i=>i.type?.name==='Range'))return this.node('ArrayAccess',syntax,type,{array:target,indices});
      return this.node('ArrayAccess',syntax,type.elementType,{array:target,indices});
    }
    if(type.specialType==='System_String'&&args.length===1){const c=this.conversions.classifyFromExpression(args[0],this.core.int);if(c.exists&&c.isImplicit){const n=this.node('IndexerAccess',syntax,this.core.char,{receiver:target,property:{name:'Chars',setMethod:null,getMethod:{},toDisplayString:()=>'string.this[int]',refKind:RefKind.None},args:[{expression:this.applyConversion(args[0],this.core.int,c)}]});return n;}}
    const indexers=lookupMembers(type,'this[]',this.core,{within:this.c.containingType}).members.concat(isSource(type)?[]:lookupMembers(type,'Item',this.core,{within:this.c.containingType}).members).filter(m=>m.kind===SymbolKind.Property&&m.parameters.length);
    if(!indexers.length){if(!isSource(type)&&type.typeKind!==TypeKind.TypeParameter&&!this.d.registryIsComplete(type,'this[]'))return this.lenient(syntax);this.report(syntax,'CS0021',[this.display(type)]);return this.bad(syntax);}
    const accessorOf=p=>p.getMethod??p.setMethod,byAccessor=new Map(indexers.map(p=>[accessorOf(p),p])),shapes=indexers.map(p=>{const a=accessorOf(p);if(a===p.getMethod)return a;const copy=Object.create(a);Object.defineProperty(copy,'parameters',{value:a.parameters.slice(0,-1)});byAccessor.set(copy,p);return copy;});
    const r=this.d.overloads.resolve(shapes,args,{name:'this'});
    if(!r.succeeded){if(!indexers.every(isSource))return this.lenient(syntax);const e=r.error;this.report(this.errorNode(e,args,syntax),e.code==='CS1501'?'CS1501':e.code,e.code==='CS1501'?['this',args.length]:e.args);return this.bad(syntax);}
    const property=byAccessor.get(r.candidate.definition)??byAccessor.get(r.method)??indexers[0];
    return this.node('IndexerAccess',syntax,property.type,{receiver:target,property,args:args.map((a,i)=>({expression:r.conversions[i]&&a.type?this.applyConversion(a,r.parameterTypes[i],r.conversions[i]):a,parameter:property.parameters[r.mapping.parameterOf[i]]}))});
  }
  objectCreation(syntax){
    const type=this.bindType(syntax.type).type,args=this.arguments(syntax.argumentList);
    if(type.isErrorType()){if(syntax.initializer)this.initializerSilently(syntax.initializer);return this.bad(syntax);}
    return this.create(type,args,syntax,syntax.type,syntax.initializer);
  }
  implicitCreation(syntax){
    const args=this.arguments(syntax.argumentList);
    return this.node('ImplicitNew',syntax,null,{form:'implicitNew',args,convert:to=>{const t=stripNullable(to);return t.typeKind===TypeKind.Interface||t.typeKind===TypeKind.TypeParameter&&!t.hasConstructorConstraint||t instanceof ArrayTypeSymbol?null:new Conversion(ConversionKind.ObjectCreation);},materialize:to=>this.create(stripNullable(to),args,syntax,syntax.newKeyword,syntax.initializer)});
  }
  create(type,args,syntax,typeNode,initializer){
    const anyBad=args.some(a=>a.hasErrors);
    if(type.typeKind===TypeKind.Delegate){
      if(args.length!==1){this.report(syntax,'CS0149');return this.bad(syntax);}
      const a=args[0];if(a.hasErrors)return this.bad(syntax);
      if(a.kind==='MethodGroup'||a.form==='lambda'){const converted=this.convert(a,type,a.syntax);if(a.form==='lambda'&&!converted.hasErrors)this.finishLambda(a,type);return converted.hasErrors?converted:this.node('DelegateCreation',syntax,type,{operand:converted});}
      if(a.type?.typeKind===TypeKind.Delegate)return this.node('DelegateCreation',syntax,type,{operand:a});
      this.report(a.syntax,'CS0149');return this.bad(syntax);
    }
    if(type.typeKind===TypeKind.Interface||type.isAbstract&&type.typeKind===TypeKind.Class){this.report(syntax,'CS0144',[this.display(type)]);if(initializer)this.initializerSilently(initializer);return this.bad(syntax);}
    if(type.isStatic){this.report(typeNode,'CS0712',[this.display(type)]);return this.bad(syntax);}
    if(type.typeKind===TypeKind.TypeParameter){
      if(!type.hasConstructorConstraint&&!type.hasValueTypeConstraint){this.report(syntax,'CS0304',[type.name]);return this.bad(syntax);}
      if(args.length){this.report(syntax,'CS0417',[type.name]);return this.bad(syntax);}
      return this.withInitializer(this.node('ObjectCreation',syntax,type,{constructor:null,args:[]}),initializer);
    }
    if(type.typeKind===TypeKind.Enum||keywordOf(type)&&type.isValueType||isNullableType(type)){if(!args.length)return this.withInitializer(this.node('ObjectCreation',syntax,type,{constructor:null,args:[]}),initializer);if(!isSource(type))return this.lenient(syntax);}
    const all=type.getMembers('.ctor').filter(m=>m.kind===SymbolKind.Method&&m.methodKind===MethodKind.Constructor);
    if(!all.length){
      if(type.isValueType===true&&!args.length)return this.withInitializer(this.node('ObjectCreation',syntax,type,{constructor:null,args:[]}),initializer);
      if(!isSource(type)){if(initializer)this.initializerSilently(initializer,type);return this.lenient(syntax);}
    }
    const accessible=all.filter(c=>isAccessible(c.originalDefinition??c,this.c.containingType?.originalDefinition??null,{throughType:type.originalDefinition}));
    if(all.length&&!accessible.length){if(isAccessible(type.originalDefinition,this.c.containingType?.originalDefinition??null,{withinModule:this.d.assembly.module}))this.report(typeNode,'CS0122',[all[0].toDisplayString()]);return this.bad(syntax);}
    const r=this.d.overloads.resolve(accessible,args,{isConstructor:true});
    if(!r.succeeded){
      if(anyBad){if(initializer)this.initializerSilently(initializer,type);return this.bad(syntax);}
      if(!isSource(type)){if(initializer)this.initializerSilently(initializer,type);return this.lenient(syntax);}
      // A less accessible constructor that would have matched is reported as inaccessible.
      const hidden=all.length>accessible.length?this.d.overloads.resolve(all,args,{isConstructor:true}):null;
      if(hidden?.succeeded){this.report(typeNode,'CS0122',[hidden.method.toDisplayString()]);return this.bad(syntax);}
      const e=r.error;this.report(this.errorNode(e,args,typeNode),e.code,e.code==='CS1729'?[this.display(type),args.length]:e.args);if(initializer)this.initializerSilently(initializer,type);return this.bad(syntax);
    }
    const call=this.finishCall(r,null,args,syntax,{});
    return this.withInitializer(this.node('ObjectCreation',syntax,type,{constructor:r.method,args:call.args,expanded:r.expanded}),initializer);
  }
  initializerSilently(initializer,type=null){const saved=this.quiet;this.quiet=[];try{for(const e of initializer.expressions){if(e.kind==='SimpleAssignmentExpression')this.expression(e.right.kind.endsWith('InitializerExpression')?e.left:e.right);else if(!e.kind.endsWith('InitializerExpression'))this.expression(e);}}finally{this.quiet=saved;}}
  withInitializer(creation,initializer){
    if(!initializer)return creation;const type=creation.type,members=[];
    if(initializer.kind==='ObjectInitializerExpression'){
      for(const item of initializer.expressions){
        if(item.kind!=='SimpleAssignmentExpression'||item.left.kind!=='IdentifierName'){this.incomplete=true;this.d.incomplete=true;continue;}
        const name=item.left.identifier.valueText,found=lookupMembers(type,name,this.core,{within:this.c.containingType,throughType:type}).members.filter(m=>m.kind===SymbolKind.Field||m.kind===SymbolKind.Property);
        if(!found.length){if(!isSource(type)&&!this.d.registryIsComplete(type,name)){this.lenient(item);this.initializerSilently({expressions:[item]});continue;}this.report(item.left,'CS0117',[this.display(type),name]);this.value(item.right.kind.endsWith('InitializerExpression')?item.left:item.right);continue;}
        const m=found[0],target=this.node(m.kind===SymbolKind.Field?'FieldAccess':'PropertyAccess',item.left,m.type,{[m.kind===SymbolKind.Field?'field':'property']:m,receiver:creation,isInitializerTarget:true});
        if(m.isStatic){this.report(item.left,'CS1914',[m.toDisplayString()]);continue;}
        if(item.right.kind.endsWith('InitializerExpression')){members.push({target,value:this.withInitializer({...target,type:m.type},item.right)});continue;}
        this.inObjectInitializer=true;const w=checkWritable(target,'assignment',this.variableContext);this.inObjectInitializer=false;if(w)this.report(item.left,w.code,w.args);
        const value=this.value(item.right);this.markWrite(target,value);members.push({target,value:this.convert(value,m.type,item.right)});
      }
      return {...creation,initializers:members};
    }
    // Collection initializer: each element is an Add call.
    const elements=[];
    for(const item of initializer.expressions){
      const values=item.kind==='ComplexElementInitializerExpression'?item.expressions.map(e=>this.value(e)):[this.value(item)];
      const adds=lookupMembers(type,'Add',this.core,{within:this.c.containingType}).members.filter(m=>m.kind===SymbolKind.Method);
      if(!adds.length||values.some(v=>v.hasErrors)){if(!adds.length&&isSource(type)){this.report(item,'CS1061',[this.display(type),'Add']);}else if(!adds.length)this.incomplete=this.d.incomplete=true;continue;}
      const r=this.d.overloads.resolve(adds,values,{name:'Add'});
      if(!r.succeeded){if(adds.every(isSource)||this.d.registryIsComplete(type,'Add')){const e=r.error;this.report(e.argument!==undefined?values[e.argument].syntax:item,e.code,e.args);}else this.incomplete=this.d.incomplete=true;continue;}
      elements.push({method:r.method,args:values.map((v,i)=>r.conversions[i]&&v.type?this.applyConversion(v,r.parameterTypes[i],r.conversions[i]):v)});
    }
    return {...creation,collectionInitializers:elements};
  }
  arrayCreation(syntax){
    const implicit=syntax.kind==='ImplicitArrayCreationExpression',init=syntax.initializer;let elementType,rank=1,sizes=[];
    if(implicit){
      rank=syntax.commas.length+1;const values=init.expressions.map(e=>e.kind==='ArrayInitializerExpression'?null:this.value(e));
      if(values.some(v=>v===null))return this.lenient(syntax);if(values.some(v=>v.hasErrors))return this.bad(syntax);
      elementType=this.bestCommonType(values);if(!elementType){this.report(syntax,'CS0826');return this.bad(syntax);}
      return this.node('ArrayCreation',syntax,this.core.arrayOf(elementType,rank),{elements:values.map(v=>this.convert(v,elementType))});
    }
    const typeSyntax=syntax.type,ranks=typeSyntax.rankSpecifiers,full=this.bindType(typeSyntax).type;if(full.isErrorType()||!(full instanceof ArrayTypeSymbol)){if(init)for(const e of init.expressions)if(!e.kind.endsWith('InitializerExpression'))this.value(e);return this.bad(syntax);}
    elementType=full.elementType;rank=full.rank;
    for(const size of ranks[0].sizes){if(size.kind==='OmittedArraySizeExpression')continue;const s=this.value(size);let done=false;if(!s.hasErrors){for(const t of [this.core.int,this.core.uint,this.core.long,this.core.ulong]){const c=this.conversions.classifyFromExpression(s,t);if(c.exists&&c.isImplicit){sizes.push(this.applyConversion(s,t,c));done=true;break;}}if(!done)sizes.push(this.convert(s,this.core.int));}
      if(s.constantValue?.isIntegral&&s.constantValue.bigint<0n)this.report(size,'CS0248');}
    if(!init&&!sizes.length&&ranks[0].sizes.every(s=>s.kind==='OmittedArraySizeExpression')){this.report(typeSyntax.rankSpecifiers[0],'CS1586');}
    const elements=init?this.arrayInitializer(init,elementType,rank):null;
    return this.node('ArrayCreation',syntax,full,{sizes,elements});
  }
  arrayInitializer(init,elementType,rank){
    return init.expressions.map(e=>{
      if(e.kind==='ArrayInitializerExpression'){if(rank>1)return this.arrayInitializer(e,elementType,rank-1);if(elementType instanceof ArrayTypeSymbol)return this.node('ArrayCreation',e,elementType,{elements:this.arrayInitializer(e,elementType.elementType,elementType.rank)});this.report(e,'CS0623');return this.bad(e);}
      if(rank>1){this.report(e,'CS0846');return this.bad(e);}
      return this.convert(this.value(e),elementType,e);
    });
  }
  /** The best common type of a set of expressions (spec 12.6.3.15): the candidate type every expression converts to. */
  bestCommonType(values){
    const candidates=[];for(const v of values)if(v.type&&v.type.specialType!=='System_Void'&&!candidates.some(c=>c.equals(v.type)))candidates.push(v.type);
    const best=candidates.filter(c=>values.every(v=>{const r=this.conversions.classifyFromExpression(v,c);return r.exists&&r.isImplicit;}));
    if(best.length===1)return best[0];
    if(best.length>1){const top=best.filter(c=>best.every(o=>o===c||this.conversions.classifyImplicit(o,c).exists));if(top.length===1)return top[0];}
    return null;
  }
  cast(syntax){
    const type=this.bindType(syntax.type).type,e=this.value(syntax.expression);
    if(type.isErrorType()||e.hasErrors)return this.bad(syntax);
    if(e.form==='lambda'||e.kind==='MethodGroup'||e.form==='implicitNew'){const c=this.convert(e,type,syntax);if(e.form==='lambda'&&!c.hasErrors)this.finishLambda(e,type);return c;}
    const c=this.conversions.classifyCastFromExpression(e,type);
    if(!c.exists){
      if(e.literal==='null')this.report(syntax,'CS0037',[this.display(type)]);
      else if(e.constantValue&&!e.constantValue.isNull&&e.type&&this.conversions.kindOf(e.type)&&this.conversions.kindOf(type))this.report(syntax,'CS0030',[this.display(e.type),this.display(type)]);
      else this.report(syntax,'CS0030',[e.type?this.display(e.type):e.literal??'?',this.display(type)]);
      return this.bad(syntax);
    }
    if(c.isAmbiguous){this.report(syntax,'CS0457',[c.candidates[0].toDisplayString(),c.candidates[1]?.toDisplayString()??'',this.display(e.type),this.display(type)]);return this.bad(syntax);}
    return this.applyConversion(e,type,c,syntax,true);
  }
  unary(syntax,operator){
    // `-2147483648` and `-9223372036854775808` are literals in their own right.
    if(operator==='-'&&syntax.operand.kind==='NumericLiteralExpression'){const v=syntax.operand.token.value;if(v&&(v.type==='uint'&&BigInt(v.value)===2147483648n&&!/[uUlL]/.test(syntax.operand.token.text)||v.type==='ulong'&&BigInt(v.value)===9223372036854775808n&&!/[uU]/.test(syntax.operand.token.text))){const isInt=v.type==='uint',n=this.node('Literal',syntax,isInt?this.core.int:this.core.long);n.constantValue=isInt?ConstantValue.int(-2147483648):ConstantValue.long(-9223372036854775808n);return n;}}
    const operand=this.value(syntax.operand);if(operand.hasErrors)return this.bad(syntax,{operand});
    const r=this.d.operators.unary(operator,operand);
    if(r.kind==='error'){if(!r.suppressed)this.report(syntax,r.code,r.args);return this.bad(syntax);}
    if(r.kind==='user')return this.node('Unary',syntax,r.resultType,{operator,operand,method:r.method,isLifted:r.isLifted});
    const converted=operand.type&&r.leftType&&!operand.type.equals(r.leftType)?this.convert(operand,r.leftType):operand,n=this.node('Unary',syntax,r.resultType,{operator,operand:converted,isLifted:r.isLifted,isChecked:this.checked});
    if(converted.constantValue&&!r.isLifted){const folded=foldUnary(operator,converted.constantValue,{checked:!this.uncheckedContext});if(isFoldError(folded)){this.report(syntax,folded.error.code,folded.error.args);n.hasErrors=true;}else if(folded)n.constantValue=folded;}
    return n;
  }
  binary(syntax,operator){
    const left=this.value(syntax.left),right=this.value(syntax.right);
    if(left.hasErrors||right.hasErrors)return this.bad(syntax,{left,right});
    return this.binaryOperation(syntax,operator,left,right);
  }
  binaryOperation(syntax,operator,left,right){
    for(const e of [left,right])if(e.kind==='MethodGroup'||e.form==='lambda'||e.type?.specialType==='System_Void'){this.report(syntax,'CS0019',[operator,this.operandDisplay(left),this.operandDisplay(right)]);return this.bad(syntax);}
    const r=this.d.operators.binary(operator,left,right);
    if(r.kind==='error'){if(!r.suppressed)this.report(syntax,r.code,r.args);return this.bad(syntax);}
    if(r.kind==='user'){const args=r.conversions?[left,right].map((e,i)=>e.type?this.applyConversion(e,r.method.parameters[i].type,r.conversions[i]):e):[left,right];return this.node('Binary',syntax,r.isLogical?r.method.returnType:r.resultType,{operator,left:args[0],right:args[1],method:r.method,isLifted:r.isLifted,isLogical:!!r.isLogical});}
    const l=this.operand(left,r.leftType),rt=this.operand(right,r.rightType),n=this.node('Binary',syntax,r.resultType,{operator,left:l,right:rt,family:r.family,isLifted:r.isLifted,isChecked:this.checked,operandKind:r.operandKind??null});
    if(r.family==='tuple')this.d.gate(this.c.uri,syntax,'tupleEquality',{name:'tuple equality',version:7.3});
    if(l.constantValue&&rt.constantValue&&!r.isLifted&&!l.hasErrors&&!rt.hasErrors){
      const folded=foldBinary(operator,l.constantValue,rt.constantValue,{checked:!this.uncheckedContext});
      if(isFoldError(folded)){this.report(syntax,folded.error.code,folded.error.args);n.hasErrors=true;}else if(folded)n.constantValue=folded;
    }
    return n;
  }
  operandDisplay(e){return e.literal==='null'?'<null>':e.kind==='MethodGroup'?'method group':e.form==='lambda'?'lambda expression':e.literal==='default'?'default':this.display(e.type);}
  operand(e,type){if(!type||!e.type&&!e.literal)return e;if(e.type&&e.type.equals(type))return e;const c=this.conversions.classifyFromExpression(e,type);return c.exists?this.applyConversion(e,type,c):e;}
  assignment(syntax){
    const operator=syntax.operatorToken.text;
    if(syntax.left.kind==='TupleExpression'||syntax.left.kind==='DeclarationExpression'){
      // Deconstruction (bound in full by SF-A02-T08.5): the declared variables enter scope, the parts are bound for their own diagnostics.
      this.value(syntax.right);
      if(syntax.left.kind==='DeclarationExpression')for(const d of this.designationsIn(syntax.left))this.designation(d,unknown,{});
      for(const a of syntax.left.arguments??[]){if(a.expression.kind==='DeclarationExpression'){if(a.expression.designation.kind==='SingleVariableDesignation')this.declarationExpression(a.expression,null);else for(const d of this.designationsIn(a.expression))this.designation(d,unknown,{});}else this.markWrite(this.expression(a.expression,{allowDiscard:true}),null);}
      return this.lenient(syntax);}
    const left=this.expression(syntax.left,{allowDiscard:true});
    if(left.kind==='Discard'){const v=this.value(syntax.right);return this.node('Assignment',syntax,v.type,{left,right:v});}
    if(left.kind==='TypeExpression'||left.kind==='NamespaceExpression'){this.asValue(left);this.value(syntax.right);return this.bad(syntax);}
    if(left.hasErrors){this.value(syntax.right);return this.bad(syntax);}
    if(left.kind==='MethodGroup'){this.report(syntax.left,'CS1656',[left.name,'method group']);this.value(syntax.right);return this.bad(syntax);}
    const isRefAssign=syntax.right.kind==='RefExpression';
    if(left.kind==='EventAccess'&&(operator==='+='||operator==='-=')){const handler=this.value(syntax.right),converted=this.convert(handler,left.type,syntax.right);if(handler.form==='lambda'&&!converted.hasErrors)this.finishLambda(handler,left.type);return this.node('EventAssignment',syntax,this.core.void,{event:left.event,receiver:left.receiver,operator,handler:converted});}
    if(left.kind==='EventAccess'&&!this.inDeclaringType(left.event)){this.report(syntax.left.kind==='SimpleMemberAccessExpression'?syntax.left.name:syntax.left,'CS0070',[left.event.toDisplayString(),this.display(left.event.containingType)]);this.value(syntax.right);return this.bad(syntax);}
    if((left.kind==='PropertyAccess'||left.kind==='IndexerAccess')&&left.property.setMethod&&left.property.setMethod.declaredAccessibility!==left.property.declaredAccessibility&&!isAccessible(left.property.setMethod.originalDefinition??left.property.setMethod,this.c.containingType?.originalDefinition??null,{withinModule:this.d.assembly.module})){this.report(syntax.left,'CS0272',[left.property.toDisplayString()]);this.value(syntax.right);return this.bad(syntax);}
    const writable=checkWritable(left,operator==='='?'assignment':'compound',this.variableContext);
    if(writable&&!(isRefAssign&&left.kind==='Local'&&left.local.refKind!==RefKind.None)){this.report(syntax.left,writable.code,writable.args);this.markRead(left);this.value(syntax.right);return this.bad(syntax);}
    if(operator==='='){
      let right=this.value(syntax.right);
      if(isRefAssign){this.d.gate(this.c.uri,syntax,'refReassignment',{name:'ref reassignment',version:7.3});this.markWrite(left,right);return this.node('RefAssignment',syntax,left.type,{left,right:right.operand??right});}
      if(right.form==='implicitNew'&&left.type)right=this.materializeNew(right,left.type);
      const converted=left.type?this.convert(right,left.type,syntax.right):right;if(right.form==='lambda'&&!converted.hasErrors&&left.type)this.finishLambda(right,left.type);
      this.markWrite(left,right);
      if(this.sameVariable(left,right))this.report(syntax,'CS1717');
      return this.node('Assignment',syntax,left.type,{left,right:converted,hasErrors:converted.hasErrors});
    }
    if(operator==='??='){const right=this.value(syntax.right);this.markRead(left);this.markWrite(left,right);if(right.hasErrors)return this.bad(syntax);
      if(left.type&&!acceptsNullLiteral(left.type)&&!(left.type instanceof TypeParameterSymbol&&left.type.isValueType!==true)){this.report(syntax,'CS0019',['??=',this.display(left.type),this.operandDisplay(right)]);return this.bad(syntax);}
      const underlying=isNullableType(left.type)?stripNullable(left.type):null,asUnderlying=underlying?this.conversions.classifyFromExpression(right,underlying):null;
      if(asUnderlying?.exists&&asUnderlying.isImplicit)return this.node('CoalesceAssignment',syntax,underlying,{left,right:this.applyConversion(right,underlying,asUnderlying)});
      return this.node('CoalesceAssignment',syntax,left.type,{left,right:this.convert(right,left.type,syntax.right)});}
    // Compound assignment: x op= y is x = (T)(x op y) with x evaluated once.
    const op=operator.slice(0,-1),right=this.value(syntax.right);this.markRead(left);this.markWrite(left,null);if(left.kind==='Local')left.local.nonConstantWrite=true;
    if(right.hasErrors)return this.bad(syntax);
    const result=this.binaryOperation(syntax,op,left,right);if(result.hasErrors)return this.bad(syntax);
    if(left.type&&result.type&&!result.type.equals(left.type)){
      const implicit=this.conversions.classifyImplicit(result.type,left.type);
      if(!implicit.exists){
        // Predefined operators allow the implicit narrowing back (`byte b += 1`) when the right operand converts to the left type.
        const explicit=this.conversions.classifyExplicit(result.type,left.type),rightOk=this.conversions.classifyFromExpression(right,left.type);
        if(!(result.method===undefined&&explicit.exists&&(rightOk.exists&&rightOk.isImplicit||['<<','>>','>>>'].includes(op)))){this.report(syntax,explicit.exists?'CS0266':'CS0029',[this.display(result.type),this.display(left.type)]);return this.bad(syntax);}
      }
    }
    return this.node('CompoundAssignment',syntax,left.type,{left,right:result.right,operator:op,method:result.method??null,isChecked:this.checked,operation:result});
  }
  inDeclaringType(member){for(let t=this.c.containingType;t;t=t.containingType)if(t.originalDefinition===member.containingType?.originalDefinition)return true;return false;}
  sameVariable(a,b){if(a.kind!==b.kind)return false;if(a.kind==='Local')return a.local===b.local;if(a.kind==='Parameter')return a.parameter===b.parameter;if(a.kind==='FieldAccess')return a.field===b.field&&(!a.receiver&&!b.receiver||a.receiver?.kind==='This'&&b.receiver?.kind==='This');return false;}
  materializeNew(e,type){const c=e.convert(type);if(!c){this.reportConversionFailure(e,type,e.syntax,null);return this.bad(e.syntax);}return e.materialize(type);}
  increment(syntax){
    const operator=syntax.operatorToken.text,operand=this.expression(syntax.operand);
    if(operand.hasErrors)return this.bad(syntax);
    if(operand.kind==='TypeExpression'||operand.kind==='NamespaceExpression'){this.asValue(operand);return this.bad(syntax);}
    const w=checkWritable(operand,'increment',this.variableContext);if(w){this.report(syntax.operand,w.code==='CS0131'?'CS1059':w.code,w.args);return this.bad(syntax);}
    this.markRead(operand);this.markWrite(operand,null);if(operand.kind==='Local')operand.local.nonConstantWrite=true;
    const r=this.d.operators.unary(operator,operand);if(r.kind==='error'){if(!r.suppressed)this.report(syntax,r.code,r.args);return this.bad(syntax);}
    return this.node('Increment',syntax,operand.type,{operator,operand,isPostfix:syntax.kind.startsWith('Post'),method:r.method??null,isChecked:this.checked});
  }
  conditional(syntax){
    const condition=this.condition(syntax.condition),refTrue=syntax.whenTrue.kind==='RefExpression',refFalse=syntax.whenFalse.kind==='RefExpression';
    let a=this.value(refTrue?syntax.whenTrue.expression:syntax.whenTrue),b=this.value(refFalse?syntax.whenFalse.expression:syntax.whenFalse);
    if(a.hasErrors||b.hasErrors||condition.hasErrors)return this.bad(syntax);
    if(refTrue||refFalse)return this.node('RefConditional',syntax,a.type,{condition,whenTrue:a,whenFalse:b,isRef:true});
    let type=null;
    if(a.type&&b.type&&a.type.equals(b.type))type=a.type;
    else{const toB=b.type?this.conversions.classifyFromExpression(a,b.type):null,toA=a.type?this.conversions.classifyFromExpression(b,a.type):null,x=toB?.exists&&toB.isImplicit,y=toA?.exists&&toA.isImplicit;
      if(x&&!y)type=b.type;else if(y&&!x)type=a.type;else if(x&&y)type=a.constantValue&&!b.constantValue?b.type:a.type;}
    if(!type){
      // C# 9 target-typed conditional: no natural type, converted when a target type is known.
      const n=this.node('Conditional',syntax,null,{condition,whenTrue:a,whenFalse:b,form:'conditional'});
      n.convert=to=>{const ca=this.conversions.classifyFromExpression(a,to),cb=this.conversions.classifyFromExpression(b,to);return ca.exists&&ca.isImplicit&&cb.exists&&cb.isImplicit?new Conversion(ConversionKind.Identity):null;};
      n.noNaturalType={left:a,right:b};n.form='implicitNew';n.materialize=to=>this.node('Conditional',syntax,to,{condition,whenTrue:this.convert(a,to),whenFalse:this.convert(b,to)});n.isTargetTypedConditional=true;return n;
    }
    const n=this.node('Conditional',syntax,type,{condition,whenTrue:this.convert(a,type),whenFalse:this.convert(b,type)});
    if(condition.constantValue&&n.whenTrue.constantValue&&n.whenFalse.constantValue)n.constantValue=condition.constantValue.value?n.whenTrue.constantValue:n.whenFalse.constantValue;
    return n;
  }
  coalesce(syntax){
    const left=this.value(syntax.left),right=this.value(syntax.right);if(left.hasErrors||right.hasErrors)return this.bad(syntax);
    const fail=()=>{this.report(syntax,'CS0019',['??',this.operandDisplay(left),this.operandDisplay(right)]);return this.bad(syntax);};
    if(left.literal==='null')return right.type?this.node('Coalesce',syntax,right.type,{left,right}):fail();
    const a=left.type;if(!a||left.kind==='MethodGroup'||left.form==='lambda')return fail();
    if(a.isValueType===true&&!isNullableType(a))return fail();
    if(right.form==='throw')return this.node('Coalesce',syntax,isNullableType(a)?stripNullable(a):a,{left,right});
    if(isNullableType(a)){const a0=stripNullable(a),c=this.conversions.classifyFromExpression(right,a0);if(c.exists&&c.isImplicit)return this.node('Coalesce',syntax,a0,{left,right:this.applyConversion(right,a0,c)});}
    const toA=this.conversions.classifyFromExpression(right,a);if(toA.exists&&toA.isImplicit)return this.node('Coalesce',syntax,a,{left,right:this.applyConversion(right,a,toA)});
    if(right.type){const a0=isNullableType(a)?stripNullable(a):a,toB=this.conversions.classifyImplicit(a0,right.type);if(toB.exists)return this.node('Coalesce',syntax,right.type,{left,right,leftConversion:toB});}
    return fail();
  }
  isExpression(syntax){
    const operand=this.value(syntax.expression??syntax.left);
    if(syntax.kind==='IsPatternExpression'){const pattern=this.pattern(syntax.pattern,operand.type,operand);return this.node('IsPattern',syntax,this.core.bool,{operand,pattern});}
    // `e is T` parses as a type test; a constant on the right is a constant pattern.
    const typeSyntax=syntax.right??syntax.type;const saved=this.quiet;this.quiet=[];let type;try{type=this.bindType(typeSyntax).type;}finally{this.quiet=saved;}
    if(type.isErrorType()){const asExpr=this.tryConstantPattern(typeSyntax,operand);if(asExpr)return this.node('IsPattern',syntax,this.core.bool,{operand,pattern:asExpr});type=this.bindType(typeSyntax).type;return this.bad(syntax);}
    if(operand.hasErrors)return this.bad(syntax);
    return this.typeTest(syntax,operand,type);
  }
  typeTest(syntax,operand,type){
    if(!operand.type){if(operand.literal==='null'){this.report(syntax,'CS0184',[this.display(type)]);}return this.node('Is',syntax,this.core.bool,{operand,testedType:type});}
    const outcome=typeTestOutcome(operand.type,type,this.core);
    if(outcome==='never'){const c=this.conversions.classifyExplicit(operand.type,type);if(!c.exists||c.isUserDefined||c.kind===ConversionKind.ExplicitNumeric||c.kind===ConversionKind.ImplicitNumeric)this.report(syntax,'CS0184',[this.display(type)]);}
    else if(outcome==='always'&&operand.type.isValueType===true&&!isNullableType(operand.type))this.report(syntax,'CS0183',[this.display(type)]);
    return this.node('Is',syntax,this.core.bool,{operand,testedType:type,outcome});
  }
  tryConstantPattern(syntax,operand){const saved=this.quiet;this.quiet=[];try{const e=this.expression(syntax);if(e.hasErrors||e.kind==='TypeExpression'||!e.constantValue)return null;return {kind:'ConstantPattern',syntax,value:operand.type?this.convertQuiet(e,operand.type):e};}finally{this.quiet=saved;}}
  convertQuiet(e,type){const c=this.conversions.classifyFromExpression(e,type);return c.exists?this.applyConversion(e,type,c):e;}
  asExpression(syntax){
    const operand=this.value(syntax.left??syntax.expression),type=this.bindType(syntax.right??syntax.type).type;
    if(operand.hasErrors||type.isErrorType())return this.bad(syntax);
    if(!asOperatorTargetValid(type)){this.report(syntax,type.typeKind===TypeKind.TypeParameter?'CS0413':'CS0077',type.typeKind===TypeKind.TypeParameter?[type.name]:[this.display(type)]);return this.bad(syntax);}
    if(operand.type){const c=this.conversions.classifyStandardExplicit(operand.type,type),allowed=c.exists&&[ConversionKind.Identity,ConversionKind.ImplicitReference,ConversionKind.Boxing,ConversionKind.ExplicitReference,ConversionKind.Unboxing,ConversionKind.ImplicitNullable,ConversionKind.ExplicitNullable].includes(c.kind)&&!(c.isNullable&&!stripNullable(operand.type).equals(stripNullable(type)))||operand.type.typeKind===TypeKind.TypeParameter||type.typeKind===TypeKind.TypeParameter;
      if(!allowed){this.report(syntax,'CS0039',[this.display(operand.type),this.display(type)]);return this.bad(syntax);}}
    else if(operand.kind==='MethodGroup'||operand.form==='lambda'){this.report(syntax,'CS0837');return this.bad(syntax);}
    return this.node('As',syntax,type,{operand,targetType:type});
  }
  tuple(syntax){
    const elements=syntax.arguments.map(a=>this.value(a.expression)),names=syntax.arguments.map(a=>a.nameColon?.name.identifier.valueText??null);
    if(elements.some(e=>e.hasErrors))return this.bad(syntax);
    const typed=elements.every(e=>e.type&&e.type.specialType!=='System_Void');let type=null;
    if(typed&&elements.length>=2&&elements.length<=7){const t=this.core.bridge.coreType('System_ValueTuple_T'+elements.length).construct(elements.map(e=>e.type));type=names.some(Boolean)?t.withTupleElementNames(names):t;}
    else if(elements.length>7)return this.lenient(syntax);
    return this.node('Tuple',syntax,type,{elements,names,form:'tupleLiteral'});
  }
  conditionalAccess(syntax){
    // a?.b : the receiver is evaluated once; a value-typed result is lifted to Nullable<T> (SF-A02-B03).
    const receiver=this.value(syntax.expression);if(receiver.hasErrors)return this.bad(syntax);
    const type=receiver.type;if(!type||receiver.kind==='MethodGroup'){this.report(syntax.operatorToken,'CS0023',['?',this.operandDisplay(receiver)]);return this.bad(syntax);}
    if(type.isValueType===true&&!isNullableType(type)){this.report(syntax.operatorToken,'CS0023',['?',this.display(type)]);return this.bad(syntax);}
    const placeholder=this.node('ConditionalReceiver',syntax.expression,isNullableType(type)?stripNullable(type):type,{});
    const access=this.whenNotNull(syntax.whenNotNull,placeholder);if(access.hasErrors)return this.bad(syntax);
    const t=access.type;let result;
    if(!t||t.specialType==='System_Void')result=this.core.void;
    else if(t.isValueType===true&&!isNullableType(t))result=this.core.nullableOf(t);
    else if(t.typeKind===TypeKind.TypeParameter&&t.isReferenceType!==true&&t.isValueType!==true){this.report(syntax.whenNotNull,'CS8978',[t.name]);return this.bad(syntax);}
    else result=t;
    return this.node('ConditionalAccess',syntax,result,{receiver,whenNotNull:access,isLifted:result!==t});
  }
  whenNotNull(syntax,receiver){
    switch(syntax.kind){
      case 'MemberBindingExpression':{const name=syntax.name.identifier.valueText;return this.instanceMember(receiver,receiver.type,name,syntax.name,syntax,this.typeArgumentsOf(syntax.name),{});}
      case 'ElementBindingExpression':return this.lenient(syntax);
      case 'SimpleMemberAccessExpression':{const left=this.asValueOrGroup(this.whenNotNull(syntax.expression,receiver));if(left.hasErrors)return left;return this.instanceMember(left,left.type,syntax.name.identifier.valueText,syntax.name,syntax,this.typeArgumentsOf(syntax.name),{});}
      case 'InvocationExpression':{const target=this.whenNotNull(syntax.expression,receiver),args=this.arguments(syntax.argumentList);if(target.hasErrors)return target;if(target.kind==='MethodGroup')return this.call(target,args,syntax);const invoke=target.type?delegateInvoke(target.type):null;if(invoke){const r=this.d.overloads.resolve([invoke],args,{isDelegate:true});if(r.succeeded)return this.finishCall(r,target,args,syntax,{isDelegateInvoke:true});}return this.lenient(syntax);}
      case 'ConditionalAccessExpression':{const inner=this.asValueOrGroup(this.whenNotNull(syntax.expression,receiver));if(inner.hasErrors)return inner;const p=this.node('ConditionalReceiver',syntax.expression,isNullableType(inner.type)?stripNullable(inner.type):inner.type,{});const access=this.whenNotNull(syntax.whenNotNull,p);return access.hasErrors?access:this.node('ConditionalAccess',syntax,access.type,{receiver:inner,whenNotNull:access});}
      default:return this.lenient(syntax);
    }
  }
  asValueOrGroup(e){return e.kind==='MethodGroup'?this.bad(e.syntax):e;}
  await(syntax){
    const operand=this.value(syntax.expression);
    if(!this.c.isAsync&&!this.c.isTopLevel){this.report(syntax,this.c.isLambda?'CS4034':this.c.method?.returnsVoid!==false&&this.c.method?.returnType?.specialType==='System_Void'?'CS4033':'CS4032',this.c.isLambda?['lambda expression']:this.c.method?.returnsVoid?[]:[this.display(this.c.method?.returnType)]);return this.bad(syntax);}
    if(operand.hasErrors||!operand.type)return this.bad(syntax);
    const t=operand.type;
    if(t.originalDefinition===this.core.taskT||t.originalDefinition?.name==='ValueTask'&&t.typeArguments?.length===1)return this.node('Await',syntax,t.typeArguments[0].type,{operand});
    if(t.equals(this.core.task)||t.name==='ValueTask')return this.node('Await',syntax,this.core.void,{operand});
    const getAwaiter=lookupMembers(t,'GetAwaiter',this.core,{within:this.c.containingType}).members.find(m=>m.kind===SymbolKind.Method&&!m.parameters.length);
    if(getAwaiter){const result=lookupMembers(getAwaiter.returnType,'GetResult',this.core,{}).members.find(m=>m.kind===SymbolKind.Method);return this.node('Await',syntax,result?.returnType??unknown,{operand,getAwaiter});}
    if(!isSource(t))return this.lenient(syntax);
    this.report(syntax.expression,'CS1061',[this.display(t),'GetAwaiter']);return this.bad(syntax);
  }
  /** A thrown value converts implicitly to System.Exception (CS0029/CS0266 otherwise). */
  checkThrown(e,node){if(e.hasErrors||e.literal==='null'||e.type?.typeKind===TypeKind.TypeParameter)return;this.convert(e,this.core.exception,node);}
  // ---- lambdas ----
  lambda(syntax){
    const isAnonymousMethod=syntax.kind==='AnonymousMethodExpression',parameterSyntax=syntax.kind==='SimpleLambdaExpression'?[syntax.parameter]:syntax.parameterList?.parameters??null;
    const explicit=parameterSyntax&&parameterSyntax.length&&parameterSyntax.every(p=>p.type)?parameterSyntax.map(p=>this.bindType(p.type).type):parameterSyntax&&!parameterSyntax.length?[]:null;
    const isAsync=(syntax.modifiers??[]).some(m=>m.text==='async'),cache=new Map();
    const node=this.node('Lambda',syntax,null,{form:'lambda',isAnonymousMethod,parameterSyntax,isAsync});
    const bindWith=(parameterTypes,returnType,quiet,refKinds=null)=>{
      const key=parameterTypes.map(t=>t.toDisplayString()).join(',')+'=>'+(returnType?returnType.toDisplayString():'?');if(quiet&&cache.has(key))return cache.get(key);
      const parameters=(parameterSyntax??[]).map((p,i)=>{const mods=p.modifiers?.map(m=>m.text)??[];const s=new ParameterSymbol({name:p.identifier.valueText,type:parameterTypes[i]??unknown,ordinal:i,refKind:mods.includes('ref')?RefKind.Ref:mods.includes('out')?RefKind.Out:mods.includes('in')?RefKind.In:refKinds?.[i]??RefKind.None,syntax:p});return s;});
      const diagnostics=[],child=new BodyBinder(this.d,{...this.c,parent:this,parameters,returnType:isAsync&&returnType?this.unwrapTask(returnType):returnType,returnRefKind:RefKind.None,isAsync,isIterator:false,isLambda:true,isFieldInitializer:false,isStatic:this.c.isStatic,quiet:quiet?diagnostics:this.quiet,inferReturn:!returnType,isStaticInitializer:this.c.isStaticInitializer});
      child.checked=this.checked;
      let body;if(syntax.block)body=child.block(syntax.block);else{const e=child.expression(syntax.expressionBody.expression??syntax.expressionBody);
        if(returnType&&returnType.specialType!=='System_Void'&&child.c.returnType){const v=child.asValue(e);body=child.convert(v,child.c.returnType);if(v.form==='lambda'&&!body.hasErrors)child.finishLambda(v,child.c.returnType);child.returns.push(v);}
        else if(child.c.returnType&&child.c.returnType.specialType==='System_Void'||returnType?.specialType==='System_Void'){body=e.kind==='TypeExpression'?child.asValue(e):e;if(!body.hasErrors&&!child.isStatementExpression(body.syntax))child.report(body.syntax,'CS0201');}
        else{body=child.asValue(e);child.returns.push(body);}}
      const inferred=child.c.inferReturn?(syntax.block?(child.returns.length?child.bestCommonType(child.returns.filter(r=>r)):child.sawReturn?null:this.core.void):(body.type??(body.hasErrors?null:this.core.void))):null;
      const result={body,diagnostics,hasErrors:diagnostics.some(d=>this.d.isError(d.code))||!!body.hasErrors&&!syntax.block,inferred:inferred&&isAsync?(inferred.specialType==='System_Void'?this.core.task:this.core.taskT.construct(inferred)):inferred,child};
      if(quiet)cache.set(key,result);return result;
    };
    node.lambda={parameterTypes:explicit,inferReturnType:types=>{if(parameterSyntax&&types.length!==parameterSyntax.length)return null;const r=bindWith(explicit??types,null,true);return r.inferred&&!r.inferred.isErrorType?.()?r.inferred:null;}};
    node.convert=to=>{
      const invoke=delegateInvoke(to);if(!invoke){node.lastConversionError=null;return null;}
      const errors=[];
      if(parameterSyntax&&parameterSyntax.length!==invoke.parameters.length){node.lastConversionError=[{code:'CS1593',args:[this.display(to),parameterSyntax.length]}];return null;}
      if(explicit&&!explicit.every((t,i)=>t.equals(invoke.parameters[i].type))){const i=explicit.findIndex((t,k)=>!t.equals(invoke.parameters[k].type));node.lastConversionError=[{code:'CS1661',args:[isAnonymousMethod?'anonymous method':'lambda expression',this.display(to)]},{node:parameterSyntax[i],code:'CS1678',args:[i+1,this.display(explicit[i]),this.display(invoke.parameters[i].type)]}];return null;}
      const r=bindWith(invoke.parameters.map(p=>p.type),invoke.returnType,true,invoke.parameters.map(p=>p.refKind));
      if(r.hasErrors){node.lastConversionError=r.diagnostics.filter(d=>this.d.isError(d.code));node.bodyErrors=true;return null;}
      return new Conversion(ConversionKind.AnonymousFunction);
    };
    node.bindFinal=to=>{const invoke=delegateInvoke(to);return invoke?bindWith(invoke.parameters.map(p=>p.type),invoke.returnType,false,invoke.parameters.map(p=>p.refKind)):null;};
    // Natural type (C# 10): explicitly typed parameters and an inferable return type.
    node.naturalType=()=>{if(!explicit)return null;const r=bindWith(explicit,null,true);return r.inferred?naturalDelegateType(this.core,explicit,r.inferred):null;};
    return node;
  }
  unwrapTask(type){if(type.originalDefinition===this.core.taskT)return type.typeArguments[0].type;if(type.equals(this.core.task))return this.core.void;return type;}
  /** Binds the body of a lambda for the delegate type it was converted to, reporting its diagnostics once. */
  finishLambda(lambda,delegateType){if(lambda.finished)return;lambda.finished=true;const r=lambda.bindFinal(delegateType);if(r){lambda.body=r.body;lambda.boundAs=delegateType;}}
  switchExpression(syntax){
    const governing=this.value(syntax.governingExpression),arms=[];
    for(const arm of syntax.arms){this.pushScope();const pattern=governing.hasErrors?null:this.pattern(arm.pattern,governing.type,governing);const when=arm.whenClause?this.condition(arm.whenClause.condition):null;arms.push({pattern,when,value:this.value(arm.expression),syntax:arm});this.popScope();}
    if(governing.hasErrors||arms.some(a=>a.value.hasErrors))return this.bad(syntax);
    const type=this.bestCommonType(arms.map(a=>a.value));
    if(!type){const n=this.node('SwitchExpression',syntax,null,{governing,arms,form:'implicitNew'});n.convert=to=>arms.every(a=>{const c=this.conversions.classifyFromExpression(a.value,to);return c.exists&&c.isImplicit;})?new Conversion(ConversionKind.Identity):null;n.materialize=to=>this.node('SwitchExpression',syntax,to,{governing,arms:arms.map(a=>({...a,value:this.convert(a.value,to)}))});n.isTargetTypedSwitch=true;return n;}
    return this.node('SwitchExpression',syntax,type,{governing,arms:arms.map(a=>({...a,value:this.convert(a.value,type)}))});
  }
  collectionExpression(syntax){
    const elements=syntax.elements.map(e=>e.kind==='ExpressionElement'?this.value(e.expression):e.kind==='SpreadElement'?{spread:this.value(e.expression)}:null);
    const n=this.node('CollectionExpression',syntax,null,{elements,form:'collection'});
    n.convert=to=>{const element=to instanceof ArrayTypeSymbol?to.elementType:to instanceof NamedTypeSymbol&&to.typeArguments.length===1?to.typeArguments[0].type:null;if(!element)return null;
      return elements.every(e=>!e||e.spread||e.hasErrors||(()=>{const c=this.conversions.classifyFromExpression(e,element);return c.exists&&c.isImplicit;})())?new Conversion(ConversionKind.CollectionExpression):null;};
    n.materialize=to=>this.node('CollectionExpression',syntax,to,{elements});
    return n;
  }
  /** Patterns: constant, type, declaration, var, discard, relational, not/and/or, parenthesized; others are bound leniently. */
  pattern(syntax,inputType,input){
    switch(syntax.kind){
      case 'DiscardPattern':return {kind:'DiscardPattern',syntax};
      case 'ParenthesizedPattern':return this.pattern(syntax.pattern,inputType,input);
      case 'ConstantPattern':{
        // An identifier or member access may be a type (a type pattern).
        if(['IdentifierName','QualifiedName','GenericName','PredefinedType','SimpleMemberAccessExpression','ArrayType','NullableType'].includes(syntax.expression.kind)){const saved=this.quiet;this.quiet=[];let e;try{e=this.expression(syntax.expression);}finally{this.quiet=saved;}if(e.kind==='TypeExpression')return this.typePattern(syntax,e.referencedType,inputType);}
        const e=this.value(syntax.expression);if(e.hasErrors)return {kind:'ConstantPattern',syntax,hasErrors:true};
        if(!e.constantValue&&e.literal!=='null'){this.report(syntax.expression,'CS9135',[inputType?this.display(inputType):'?']);return {kind:'ConstantPattern',syntax,hasErrors:true};}
        if(inputType&&!inputType.isErrorType()){const c=this.conversions.classifyFromExpression(e,inputType);if(c.exists&&c.isImplicit)return {kind:'ConstantPattern',syntax,value:this.applyConversion(e,inputType,c)};
          const explicit=e.type?this.conversions.classifyExplicit(inputType,e.type):null;if(explicit?.exists&&(explicit.isUnboxing||explicit.isReference||explicit.isBoxing||explicit.isNullable||inputType.typeKind===TypeKind.TypeParameter))return {kind:'ConstantPattern',syntax,value:e};
          this.reportConversionFailure(e,inputType,syntax.expression,c);return {kind:'ConstantPattern',syntax,hasErrors:true};}
        return {kind:'ConstantPattern',syntax,value:e};
      }
      case 'TypePattern':return this.typePattern(syntax,this.bindType(syntax.type).type,inputType);
      case 'DeclarationPattern':{const type=this.bindType(syntax.type).type,p=this.typePattern(syntax,type,inputType);this.designation(syntax.designation,type,p);return {...p,kind:'DeclarationPattern'};}
      case 'VarPattern':{const p={kind:'VarPattern',syntax};this.designation(syntax.designation,inputType??unknown,p);return p;}
      case 'RelationalPattern':{const e=this.value(syntax.expression);if(!e.hasErrors&&!e.constantValue)this.report(syntax.expression,'CS0150');return {kind:'RelationalPattern',syntax,operator:syntax.operatorToken.text,value:inputType&&!e.hasErrors?this.convertQuiet(e,inputType):e};}
      case 'NotPattern':return {kind:'NotPattern',syntax,pattern:this.pattern(syntax.pattern,inputType,input)};
      case 'OrPattern':case 'AndPattern':return {kind:syntax.kind,syntax,left:this.pattern(syntax.left,inputType,input),right:this.pattern(syntax.right,inputType,input)};
      case 'RecursivePattern':{
        const type=syntax.type?this.bindType(syntax.type).type:inputType,p=syntax.type?this.typePattern(syntax,type,inputType):{kind:'RecursivePattern',syntax};
        for(const sub of syntax.propertyPatternClause?.subpatterns??[]){const nameNode=sub.expressionColon?.expression??sub.nameColon?.name;let memberType=unknown;
          if(nameNode?.kind==='IdentifierName'&&type&&!type.isErrorType()){const found=lookupMembers(type,nameNode.identifier.valueText,this.core,{within:this.c.containingType}).members.find(m=>m.kind===SymbolKind.Field||m.kind===SymbolKind.Property);if(found){memberType=found.type;if(found.kind===SymbolKind.Field)(found.originalDefinition??found).reads=((found.originalDefinition??found).reads??0)+1;}else if(isSource(type))this.report(nameNode,'CS0117',[this.display(type),nameNode.identifier.valueText]);else this.incomplete=this.d.incomplete=true;}
          this.pattern(sub.pattern,memberType,null);}
        if(syntax.positionalPatternClause){this.incomplete=this.d.incomplete=true;for(const sub of syntax.positionalPatternClause.subpatterns)this.pattern(sub.pattern,unknown,null);}
        if(syntax.designation)this.designation(syntax.designation,type??unknown,p);
        return {...p,kind:'RecursivePattern'};
      }
      default:this.incomplete=this.d.incomplete=true;for(const d of this.designationsIn(syntax))this.designation(d,unknown,{});return {kind:syntax.kind,syntax,lenient:true};
    }
  }
  designationsIn(syntax){const out=[],walk=n=>{for(const c of n.childNodes()){if(c.kind==='SingleVariableDesignation')out.push(c);else walk(c);}};walk(syntax);return out;}
  typePattern(syntax,type,inputType){
    if(type.isErrorType()||!inputType||inputType.isErrorType())return {kind:'TypePattern',syntax,testedType:type};
    const outcome=typeTestOutcome(inputType,type,this.core);
    if(outcome==='never'&&!(inputType.typeKind===TypeKind.TypeParameter||type.typeKind===TypeKind.TypeParameter)){const c=this.conversions.classifyExplicit(inputType,type);if(!c.exists||c.isNumeric||c.isUserDefined||c.kind===ConversionKind.ExplicitEnumeration)this.report(syntax.type??syntax,'CS8121',[this.display(inputType),this.display(type)]);}
    return {kind:'TypePattern',syntax,testedType:type,outcome};
  }
  designation(designation,type,pattern){
    if(!designation)return;
    if(designation.kind==='SingleVariableDesignation'){const name=designation.identifier.valueText,local=this.newLocal(name,type,designation.identifier,LocalDeclarationKind.Pattern);local.writes++;local.isPatternLocal=true;local.nonConstantWrite=true;this.declare(name,local,designation.identifier);pattern.local=local;}
    else if(designation.kind==='ParenthesizedVariableDesignation'){this.incomplete=this.d.incomplete=true;for(const v of designation.variables)this.designation(v,unknown,{});}
  }
  /** Constant expression evaluation used by const fields, enum members, parameter defaults and case labels. */
  constant(syntax,type=null){const e=this.value(syntax);if(e.hasErrors)return {errors:true,bound:e};const converted=type?this.convert(e,type,syntax):e;return {constant:converted.constantValue,type:converted.type,bound:converted,errors:!!converted.hasErrors};}
}
Object.assign(BodyBinder.prototype,statementMethods);

/** A stable text dump of a semantic bound tree, one node per line (`Kind detail : type = constant`). */
export function dumpSemanticTree(node,indent=''){
  if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>dumpSemanticTree(n,indent));
  if(!node.kind)return [];
  const detail=[];for(const [k,v] of Object.entries(node)){if(['kind','syntax','type','constantValue','convert','materialize','lambda','bindFinal','naturalType','argumentSyntax','methodGroup','mapping','hasErrors','form','locals'].includes(k)||v===null||v===undefined||v===false)continue;
    if(typeof v==='string'||typeof v==='number'||v===true)detail.push(k+'='+v);else if(v?.kind===SymbolKind.Local||v?.kind===SymbolKind.Parameter)detail.push(k+'='+v.name);else if(typeof v?.toDisplayString==='function'&&!v.syntax?.kind?.endsWith?.('Expression'))detail.push(k+'='+v.toDisplayString());else if(v instanceof Conversion)detail.push(k+'='+v.toString());}
  const line=indent+node.kind+(detail.length?' '+detail.join(' '):'')+(node.type!==undefined&&'type' in node?' : '+(node.type?node.type.toDisplayString():node.literal?'<'+node.literal+'>':'?'):'')+(node.constantValue&&!node.constantValue.isNull?' = '+node.constantValue.toString():'')+(node.hasErrors?' !':'');
  const lines=[line];
  for(const [k,v] of Object.entries(node)){if(['syntax','type','lambda','operation','conversion','mapping'].includes(k)||!v||typeof v!=='object')continue;
    if(Array.isArray(v)){for(const item of v){if(item?.kind&&typeof item.kind==='string'&&!item.toDisplayString)lines.push(...dumpSemanticTree(item,indent+'  '));else if(item?.expression?.kind)lines.push(...dumpSemanticTree(item.expression,indent+'  '));else if(item?.value?.kind||item?.target?.kind){if(item.target)lines.push(...dumpSemanticTree(item.target,indent+'  '));if(item.value)lines.push(...dumpSemanticTree(item.value,indent+'  '));}}}
    else if(typeof v.kind==='string'&&!v.toDisplayString&&!(v instanceof Conversion)&&v.kind!==SymbolKind.Local&&v.kind!==SymbolKind.Parameter)lines.push(...dumpSemanticTree(v,indent+'  '));}
  return lines;
}
export {isSource,keywordOf,DeclarationModifiers,typeOf,findConstruction,classifyVariable};
