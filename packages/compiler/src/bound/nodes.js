/** GENERATED from bound/nodes.json by packages/compiler/scripts/generate-bound-nodes.js. Do not edit. */
/**
 * The bound tree: the semantic form of method bodies produced by the binder and consumed by flow analysis,
 * lowering and code generation. Nodes are immutable; `update` returns the same node when nothing changed.
 *
 * Every node has `kind`, `syntax` (the syntax node it was bound from, or null for synthesized nodes) and `hasErrors`.
 * Expressions also have `type` (a TypeSymbol; null for the null literal and for typeless expressions),
 * `constantValue` ({value} when the expression is a compile-time constant, else null) and `legacyType`
 * (the string type name the string-typed bytecode back end exchanges).
 */
export const BoundKind=Object.freeze({BadExpression:'BadExpression',Literal:'Literal',DefaultExpression:'DefaultExpression',Local:'Local',Parameter:'Parameter',ThisReference:'ThisReference',TypeExpression:'TypeExpression',FieldAccess:'FieldAccess',PropertyAccess:'PropertyAccess',IndexerAccess:'IndexerAccess',ArrayAccess:'ArrayAccess',ArrayLength:'ArrayLength',Call:'Call',ObjectCreationExpression:'ObjectCreationExpression',ObjectInitializerMember:'ObjectInitializerMember',CollectionElementInitializer:'CollectionElementInitializer',ArrayCreation:'ArrayCreation',DelegateCreationExpression:'DelegateCreationExpression',UnaryOperator:'UnaryOperator',IncrementOperator:'IncrementOperator',BinaryOperator:'BinaryOperator',NullCoalescingOperator:'NullCoalescingOperator',ConditionalOperator:'ConditionalOperator',AssignmentOperator:'AssignmentOperator',CompoundAssignmentOperator:'CompoundAssignmentOperator',NullCoalescingAssignmentOperator:'NullCoalescingAssignmentOperator',EventAssignmentOperator:'EventAssignmentOperator',Conversion:'Conversion',InterpolatedString:'InterpolatedString',StringInsert:'StringInsert',AwaitExpression:'AwaitExpression',SwitchExpression:'SwitchExpression',SwitchExpressionArm:'SwitchExpressionArm',ConstantPattern:'ConstantPattern',CollectionExpression:'CollectionExpression',CollectionElement:'CollectionElement',CollectionSpread:'CollectionSpread',Sequence:'Sequence',BadStatement:'BadStatement',NoOpStatement:'NoOpStatement',Block:'Block',LocalDeclaration:'LocalDeclaration',MultipleLocalDeclarations:'MultipleLocalDeclarations',ExpressionStatement:'ExpressionStatement',IfStatement:'IfStatement',WhileStatement:'WhileStatement',DoStatement:'DoStatement',ForStatement:'ForStatement',ForEachStatement:'ForEachStatement',ForEachEnumerator:'ForEachEnumerator',SwitchStatement:'SwitchStatement',SwitchSection:'SwitchSection',SwitchLabel:'SwitchLabel',TryStatement:'TryStatement',CatchBlock:'CatchBlock',UsingStatement:'UsingStatement',UsingResource:'UsingResource',ReturnStatement:'ReturnStatement',ThrowStatement:'ThrowStatement',BreakStatement:'BreakStatement',ContinueStatement:'ContinueStatement',CheckedStatement:'CheckedStatement',ConditionalAccessAssignment:'ConditionalAccessAssignment'});
const anyErrors=list=>{for(const x of list){if(Array.isArray(x)){if(anyErrors(x))return true;}else if(x&&x.hasErrors)return true;}return false;};
export class BoundNode {
  constructor(kind,syntax,hasErrors){this.kind=kind;this.syntax=syntax??null;this.hasErrors=!!hasErrors;}
  /** Child nodes in evaluation order. */
  get children(){return [];}
  accept(visitor,argument){return visitor.visitDefault(this,argument);}
}
export class BoundExpression extends BoundNode {
  constructor(kind,syntax,type,options,childErrors){super(kind,syntax,options?.hasErrors||childErrors||type?.typeKind==='error');this.type=type??null;this.legacyType=options?.legacyType??null;this.constantValue=options?.constantValue??null;}
  get isExpression(){return true;}
  /** Options that carry this expression's non-structural state into a copy. */
  get options(){return {legacyType:this.legacyType,constantValue:this.constantValue,hasErrors:this.ownErrors};}
}
export class BoundStatement extends BoundNode {
  constructor(kind,syntax,options,childErrors){super(kind,syntax,options?.hasErrors||childErrors);}
  get isExpression(){return false;}
}
/** An expression that could not be bound; children are kept for error recovery. */
export class BoundBadExpression extends BoundExpression {
  constructor(syntax,{parts},type=null,options=null){super('BadExpression',syntax,type,options,anyErrors([parts]));this.ownErrors=!!options?.hasErrors;this.parts=Object.freeze([...parts]);Object.freeze(this);}
  get children(){return [...this.parts];}
  update({parts=this.parts}={},type=this.type){return sameList(parts,this.parts)&&type===this.type?this:new BoundBadExpression(this.syntax,{parts},type,this.options);}
  accept(visitor,argument){return visitor.visitBadExpression(this,argument);}
}
/** A literal or folded constant (also nameof). */
export class BoundLiteral extends BoundExpression {
  constructor(syntax,{value},type=null,options=null){super('Literal',syntax,type,options,false);this.ownErrors=!!options?.hasErrors;this.value=value??null;Object.freeze(this);}
  get children(){return [];}
  update({value=this.value}={},type=this.type){return value===this.value&&type===this.type?this:new BoundLiteral(this.syntax,{value},type,this.options);}
  accept(visitor,argument){return visitor.visitLiteral(this,argument);}
}
/** default(T). */
export class BoundDefaultExpression extends BoundExpression {
  constructor(syntax,_fields={},type=null,options=null){super('DefaultExpression',syntax,type,options,false);this.ownErrors=!!options?.hasErrors;Object.freeze(this);}
  get children(){return [];}
  update(_fields,type=this.type){return type===this.type?this:new BoundDefaultExpression(this.syntax,{},type,this.options);}
  accept(visitor,argument){return visitor.visitDefaultExpression(this,argument);}
}
/** A reference to a local variable. */
export class BoundLocal extends BoundExpression {
  constructor(syntax,{local},type=null,options=null){super('Local',syntax,type,options,false);this.ownErrors=!!options?.hasErrors;this.local=local??null;Object.freeze(this);}
  get children(){return [];}
  update({local=this.local}={},type=this.type){return local===this.local&&type===this.type?this:new BoundLocal(this.syntax,{local},type,this.options);}
  accept(visitor,argument){return visitor.visitLocal(this,argument);}
}
/** A reference to a parameter. */
export class BoundParameter extends BoundExpression {
  constructor(syntax,{parameter},type=null,options=null){super('Parameter',syntax,type,options,false);this.ownErrors=!!options?.hasErrors;this.parameter=parameter??null;Object.freeze(this);}
  get children(){return [];}
  update({parameter=this.parameter}={},type=this.type){return parameter===this.parameter&&type===this.type?this:new BoundParameter(this.syntax,{parameter},type,this.options);}
  accept(visitor,argument){return visitor.visitParameter(this,argument);}
}
/** this (explicit or implied receiver). */
export class BoundThisReference extends BoundExpression {
  constructor(syntax,_fields={},type=null,options=null){super('ThisReference',syntax,type,options,false);this.ownErrors=!!options?.hasErrors;Object.freeze(this);}
  get children(){return [];}
  update(_fields,type=this.type){return type===this.type?this:new BoundThisReference(this.syntax,{},type,this.options);}
  accept(visitor,argument){return visitor.visitThisReference(this,argument);}
}
/** A type used as the receiver of a static member access. */
export class BoundTypeExpression extends BoundExpression {
  constructor(syntax,{typeSymbol},type=null,options=null){super('TypeExpression',syntax,type,options,false);this.ownErrors=!!options?.hasErrors;this.typeSymbol=typeSymbol??null;Object.freeze(this);}
  get children(){return [];}
  update({typeSymbol=this.typeSymbol}={},type=this.type){return typeSymbol===this.typeSymbol&&type===this.type?this:new BoundTypeExpression(this.syntax,{typeSymbol},type,this.options);}
  accept(visitor,argument){return visitor.visitTypeExpression(this,argument);}
}
/** Instance (receiver) or static (no receiver) field read, including enum constants. */
export class BoundFieldAccess extends BoundExpression {
  constructor(syntax,{receiver,field},type=null,options=null){super('FieldAccess',syntax,type,options,anyErrors([receiver]));this.ownErrors=!!options?.hasErrors;this.receiver=receiver??null;this.field=field??null;Object.freeze(this);}
  get children(){return [this.receiver].filter(Boolean);}
  update({receiver=this.receiver,field=this.field}={},type=this.type){return receiver===this.receiver&&field===this.field&&type===this.type?this:new BoundFieldAccess(this.syntax,{receiver,field},type,this.options);}
  accept(visitor,argument){return visitor.visitFieldAccess(this,argument);}
}
/** Property read or write target; source, framework or builtin property. */
export class BoundPropertyAccess extends BoundExpression {
  constructor(syntax,{receiver,property},type=null,options=null){super('PropertyAccess',syntax,type,options,anyErrors([receiver]));this.ownErrors=!!options?.hasErrors;this.receiver=receiver??null;this.property=property??null;Object.freeze(this);}
  get children(){return [this.receiver].filter(Boolean);}
  update({receiver=this.receiver,property=this.property}={},type=this.type){return receiver===this.receiver&&property===this.property&&type===this.type?this:new BoundPropertyAccess(this.syntax,{receiver,property},type,this.options);}
  accept(visitor,argument){return visitor.visitPropertyAccess(this,argument);}
}
/** Indexer read or write target on a framework type. */
export class BoundIndexerAccess extends BoundExpression {
  constructor(syntax,{receiver,indexer,args},type=null,options=null){super('IndexerAccess',syntax,type,options,anyErrors([receiver,args]));this.ownErrors=!!options?.hasErrors;this.receiver=receiver;this.indexer=indexer??null;this.args=Object.freeze([...args]);Object.freeze(this);}
  get children(){return [this.receiver,...this.args];}
  update({receiver=this.receiver,indexer=this.indexer,args=this.args}={},type=this.type){return receiver===this.receiver&&indexer===this.indexer&&sameList(args,this.args)&&type===this.type?this:new BoundIndexerAccess(this.syntax,{receiver,indexer,args},type,this.options);}
  accept(visitor,argument){return visitor.visitIndexerAccess(this,argument);}
}
/** Array element read or write target. */
export class BoundArrayAccess extends BoundExpression {
  constructor(syntax,{expression,index},type=null,options=null){super('ArrayAccess',syntax,type,options,anyErrors([expression,index]));this.ownErrors=!!options?.hasErrors;this.expression=expression;this.index=index;Object.freeze(this);}
  get children(){return [this.expression,this.index];}
  update({expression=this.expression,index=this.index}={},type=this.type){return expression===this.expression&&index===this.index&&type===this.type?this:new BoundArrayAccess(this.syntax,{expression,index},type,this.options);}
  accept(visitor,argument){return visitor.visitArrayAccess(this,argument);}
}
/** Length of an array or string. */
export class BoundArrayLength extends BoundExpression {
  constructor(syntax,{expression},type=null,options=null){super('ArrayLength',syntax,type,options,anyErrors([expression]));this.ownErrors=!!options?.hasErrors;this.expression=expression;Object.freeze(this);}
  get children(){return [this.expression];}
  update({expression=this.expression}={},type=this.type){return expression===this.expression&&type===this.type?this:new BoundArrayLength(this.syntax,{expression},type,this.options);}
  accept(visitor,argument){return visitor.visitArrayLength(this,argument);}
}
/** Method invocation. `method` is a source, framework or builtin MethodSymbol; `intrinsic` optionally overrides the builtin ABI entry. */
export class BoundCall extends BoundExpression {
  constructor(syntax,{receiver,method,args,intrinsic},type=null,options=null){super('Call',syntax,type,options,anyErrors([receiver,args]));this.ownErrors=!!options?.hasErrors;this.receiver=receiver??null;this.method=method??null;this.args=Object.freeze([...args]);this.intrinsic=intrinsic??null;Object.freeze(this);}
  get children(){return [this.receiver,...this.args].filter(Boolean);}
  update({receiver=this.receiver,method=this.method,args=this.args,intrinsic=this.intrinsic}={},type=this.type){return receiver===this.receiver&&method===this.method&&sameList(args,this.args)&&intrinsic===this.intrinsic&&type===this.type?this:new BoundCall(this.syntax,{receiver,method,args,intrinsic},type,this.options);}
  accept(visitor,argument){return visitor.visitCall(this,argument);}
}
/** new T(args) { initializers }. */
export class BoundObjectCreationExpression extends BoundExpression {
  constructor(syntax,{constructorMethod,args,initializers,collectionInitializers},type=null,options=null){super('ObjectCreationExpression',syntax,type,options,anyErrors([args,initializers,collectionInitializers]));this.ownErrors=!!options?.hasErrors;this.constructorMethod=constructorMethod??null;this.args=Object.freeze([...args]);this.initializers=Object.freeze([...initializers]);this.collectionInitializers=Object.freeze([...collectionInitializers]);Object.freeze(this);}
  get children(){return [...this.args,...this.initializers,...this.collectionInitializers];}
  update({constructorMethod=this.constructorMethod,args=this.args,initializers=this.initializers,collectionInitializers=this.collectionInitializers}={},type=this.type){return constructorMethod===this.constructorMethod&&sameList(args,this.args)&&sameList(initializers,this.initializers)&&sameList(collectionInitializers,this.collectionInitializers)&&type===this.type?this:new BoundObjectCreationExpression(this.syntax,{constructorMethod,args,initializers,collectionInitializers},type,this.options);}
  accept(visitor,argument){return visitor.visitObjectCreationExpression(this,argument);}
}
/** Member = value inside an object initializer. */
export class BoundObjectInitializerMember extends BoundExpression {
  constructor(syntax,{member,value},type=null,options=null){super('ObjectInitializerMember',syntax,type,options,anyErrors([value]));this.ownErrors=!!options?.hasErrors;this.member=member??null;this.value=value;Object.freeze(this);}
  get children(){return [this.value];}
  update({member=this.member,value=this.value}={},type=this.type){return member===this.member&&value===this.value&&type===this.type?this:new BoundObjectInitializerMember(this.syntax,{member,value},type,this.options);}
  accept(visitor,argument){return visitor.visitObjectInitializerMember(this,argument);}
}
/** One element of a collection initializer: a call to Add. */
export class BoundCollectionElementInitializer extends BoundExpression {
  constructor(syntax,{addMethod,args},type=null,options=null){super('CollectionElementInitializer',syntax,type,options,anyErrors([args]));this.ownErrors=!!options?.hasErrors;this.addMethod=addMethod??null;this.args=Object.freeze([...args]);Object.freeze(this);}
  get children(){return [...this.args];}
  update({addMethod=this.addMethod,args=this.args}={},type=this.type){return addMethod===this.addMethod&&sameList(args,this.args)&&type===this.type?this:new BoundCollectionElementInitializer(this.syntax,{addMethod,args},type,this.options);}
  accept(visitor,argument){return visitor.visitCollectionElementInitializer(this,argument);}
}
/** new T[length] or new T[] { ... }. */
export class BoundArrayCreation extends BoundExpression {
  constructor(syntax,{length,initializer,hasInitializer},type=null,options=null){super('ArrayCreation',syntax,type,options,anyErrors([length,initializer]));this.ownErrors=!!options?.hasErrors;this.length=length??null;this.initializer=Object.freeze([...initializer]);this.hasInitializer=hasInitializer??null;Object.freeze(this);}
  get children(){return [this.length,...this.initializer].filter(Boolean);}
  update({length=this.length,initializer=this.initializer,hasInitializer=this.hasInitializer}={},type=this.type){return length===this.length&&sameList(initializer,this.initializer)&&hasInitializer===this.hasInitializer&&type===this.type?this:new BoundArrayCreation(this.syntax,{length,initializer,hasInitializer},type,this.options);}
  accept(visitor,argument){return visitor.visitArrayCreation(this,argument);}
}
/** Method group converted to a delegate. */
export class BoundDelegateCreationExpression extends BoundExpression {
  constructor(syntax,{receiver,method},type=null,options=null){super('DelegateCreationExpression',syntax,type,options,anyErrors([receiver]));this.ownErrors=!!options?.hasErrors;this.receiver=receiver??null;this.method=method??null;Object.freeze(this);}
  get children(){return [this.receiver].filter(Boolean);}
  update({receiver=this.receiver,method=this.method}={},type=this.type){return receiver===this.receiver&&method===this.method&&type===this.type?this:new BoundDelegateCreationExpression(this.syntax,{receiver,method},type,this.options);}
  accept(visitor,argument){return visitor.visitDelegateCreationExpression(this,argument);}
}
/** Unary + - ! ~. */
export class BoundUnaryOperator extends BoundExpression {
  constructor(syntax,{operator,operand,isChecked},type=null,options=null){super('UnaryOperator',syntax,type,options,anyErrors([operand]));this.ownErrors=!!options?.hasErrors;this.operator=operator??null;this.operand=operand;this.isChecked=isChecked??null;Object.freeze(this);}
  get children(){return [this.operand];}
  update({operator=this.operator,operand=this.operand,isChecked=this.isChecked}={},type=this.type){return operator===this.operator&&operand===this.operand&&isChecked===this.isChecked&&type===this.type?this:new BoundUnaryOperator(this.syntax,{operator,operand,isChecked},type,this.options);}
  accept(visitor,argument){return visitor.visitUnaryOperator(this,argument);}
}
/** ++ and --, prefix or postfix. */
export class BoundIncrementOperator extends BoundExpression {
  constructor(syntax,{operator,operand,isPostfix,isChecked},type=null,options=null){super('IncrementOperator',syntax,type,options,anyErrors([operand]));this.ownErrors=!!options?.hasErrors;this.operator=operator??null;this.operand=operand;this.isPostfix=isPostfix??null;this.isChecked=isChecked??null;Object.freeze(this);}
  get children(){return [this.operand];}
  update({operator=this.operator,operand=this.operand,isPostfix=this.isPostfix,isChecked=this.isChecked}={},type=this.type){return operator===this.operator&&operand===this.operand&&isPostfix===this.isPostfix&&isChecked===this.isChecked&&type===this.type?this:new BoundIncrementOperator(this.syntax,{operator,operand,isPostfix,isChecked},type,this.options);}
  accept(visitor,argument){return visitor.visitIncrementOperator(this,argument);}
}
/** Arithmetic, comparison, bitwise and short-circuit operators. `method` is set for framework operator methods; `negate` for != through an equality method. */
export class BoundBinaryOperator extends BoundExpression {
  constructor(syntax,{operator,left,right,isChecked,method,negate},type=null,options=null){super('BinaryOperator',syntax,type,options,anyErrors([left,right]));this.ownErrors=!!options?.hasErrors;this.operator=operator??null;this.left=left;this.right=right;this.isChecked=isChecked??null;this.method=method??null;this.negate=negate??null;Object.freeze(this);}
  get children(){return [this.left,this.right];}
  update({operator=this.operator,left=this.left,right=this.right,isChecked=this.isChecked,method=this.method,negate=this.negate}={},type=this.type){return operator===this.operator&&left===this.left&&right===this.right&&isChecked===this.isChecked&&method===this.method&&negate===this.negate&&type===this.type?this:new BoundBinaryOperator(this.syntax,{operator,left,right,isChecked,method,negate},type,this.options);}
  accept(visitor,argument){return visitor.visitBinaryOperator(this,argument);}
}
/** left ?? right. */
export class BoundNullCoalescingOperator extends BoundExpression {
  constructor(syntax,{left,right},type=null,options=null){super('NullCoalescingOperator',syntax,type,options,anyErrors([left,right]));this.ownErrors=!!options?.hasErrors;this.left=left;this.right=right;Object.freeze(this);}
  get children(){return [this.left,this.right];}
  update({left=this.left,right=this.right}={},type=this.type){return left===this.left&&right===this.right&&type===this.type?this:new BoundNullCoalescingOperator(this.syntax,{left,right},type,this.options);}
  accept(visitor,argument){return visitor.visitNullCoalescingOperator(this,argument);}
}
/** condition ? consequence : alternative. */
export class BoundConditionalOperator extends BoundExpression {
  constructor(syntax,{condition,consequence,alternative},type=null,options=null){super('ConditionalOperator',syntax,type,options,anyErrors([condition,consequence,alternative]));this.ownErrors=!!options?.hasErrors;this.condition=condition;this.consequence=consequence;this.alternative=alternative;Object.freeze(this);}
  get children(){return [this.condition,this.consequence,this.alternative];}
  update({condition=this.condition,consequence=this.consequence,alternative=this.alternative}={},type=this.type){return condition===this.condition&&consequence===this.consequence&&alternative===this.alternative&&type===this.type?this:new BoundConditionalOperator(this.syntax,{condition,consequence,alternative},type,this.options);}
  accept(visitor,argument){return visitor.visitConditionalOperator(this,argument);}
}
/** left = right. */
export class BoundAssignmentOperator extends BoundExpression {
  constructor(syntax,{left,right},type=null,options=null){super('AssignmentOperator',syntax,type,options,anyErrors([left,right]));this.ownErrors=!!options?.hasErrors;this.left=left;this.right=right;Object.freeze(this);}
  get children(){return [this.left,this.right];}
  update({left=this.left,right=this.right}={},type=this.type){return left===this.left&&right===this.right&&type===this.type?this:new BoundAssignmentOperator(this.syntax,{left,right},type,this.options);}
  accept(visitor,argument){return visitor.visitAssignmentOperator(this,argument);}
}
/** left op= right. */
export class BoundCompoundAssignmentOperator extends BoundExpression {
  constructor(syntax,{operator,left,right,isChecked,method,negate},type=null,options=null){super('CompoundAssignmentOperator',syntax,type,options,anyErrors([left,right]));this.ownErrors=!!options?.hasErrors;this.operator=operator??null;this.left=left;this.right=right;this.isChecked=isChecked??null;this.method=method??null;this.negate=negate??null;Object.freeze(this);}
  get children(){return [this.left,this.right];}
  update({operator=this.operator,left=this.left,right=this.right,isChecked=this.isChecked,method=this.method,negate=this.negate}={},type=this.type){return operator===this.operator&&left===this.left&&right===this.right&&isChecked===this.isChecked&&method===this.method&&negate===this.negate&&type===this.type?this:new BoundCompoundAssignmentOperator(this.syntax,{operator,left,right,isChecked,method,negate},type,this.options);}
  accept(visitor,argument){return visitor.visitCompoundAssignmentOperator(this,argument);}
}
/** left ??= right. */
export class BoundNullCoalescingAssignmentOperator extends BoundExpression {
  constructor(syntax,{left,right},type=null,options=null){super('NullCoalescingAssignmentOperator',syntax,type,options,anyErrors([left,right]));this.ownErrors=!!options?.hasErrors;this.left=left;this.right=right;Object.freeze(this);}
  get children(){return [this.left,this.right];}
  update({left=this.left,right=this.right}={},type=this.type){return left===this.left&&right===this.right&&type===this.type?this:new BoundNullCoalescingAssignmentOperator(this.syntax,{left,right},type,this.options);}
  accept(visitor,argument){return visitor.visitNullCoalescingAssignmentOperator(this,argument);}
}
/** receiver.Event += handler or -= handler. */
export class BoundEventAssignmentOperator extends BoundExpression {
  constructor(syntax,{receiver,event,isAddition,argument},type=null,options=null){super('EventAssignmentOperator',syntax,type,options,anyErrors([receiver,argument]));this.ownErrors=!!options?.hasErrors;this.receiver=receiver;this.event=event??null;this.isAddition=isAddition??null;this.argument=argument;Object.freeze(this);}
  get children(){return [this.receiver,this.argument];}
  update({receiver=this.receiver,event=this.event,isAddition=this.isAddition,argument=this.argument}={},type=this.type){return receiver===this.receiver&&event===this.event&&isAddition===this.isAddition&&argument===this.argument&&type===this.type?this:new BoundEventAssignmentOperator(this.syntax,{receiver,event,isAddition,argument},type,this.options);}
  accept(visitor,argument){return visitor.visitEventAssignmentOperator(this,argument);}
}
/** A conversion; `conversion` is a Conversion classification. */
export class BoundConversion extends BoundExpression {
  constructor(syntax,{operand,conversion,isExplicit,isChecked},type=null,options=null){super('Conversion',syntax,type,options,anyErrors([operand]));this.ownErrors=!!options?.hasErrors;this.operand=operand;this.conversion=conversion??null;this.isExplicit=isExplicit??null;this.isChecked=isChecked??null;Object.freeze(this);}
  get children(){return [this.operand];}
  update({operand=this.operand,conversion=this.conversion,isExplicit=this.isExplicit,isChecked=this.isChecked}={},type=this.type){return operand===this.operand&&conversion===this.conversion&&isExplicit===this.isExplicit&&isChecked===this.isChecked&&type===this.type?this:new BoundConversion(this.syntax,{operand,conversion,isExplicit,isChecked},type,this.options);}
  accept(visitor,argument){return visitor.visitConversion(this,argument);}
}
/** $"..."; parts are Literal (text) or StringInsert. */
export class BoundInterpolatedString extends BoundExpression {
  constructor(syntax,{parts},type=null,options=null){super('InterpolatedString',syntax,type,options,anyErrors([parts]));this.ownErrors=!!options?.hasErrors;this.parts=Object.freeze([...parts]);Object.freeze(this);}
  get children(){return [...this.parts];}
  update({parts=this.parts}={},type=this.type){return sameList(parts,this.parts)&&type===this.type?this:new BoundInterpolatedString(this.syntax,{parts},type,this.options);}
  accept(visitor,argument){return visitor.visitInterpolatedString(this,argument);}
}
/** {value,alignment:format}. */
export class BoundStringInsert extends BoundExpression {
  constructor(syntax,{value,alignment,format},type=null,options=null){super('StringInsert',syntax,type,options,anyErrors([value]));this.ownErrors=!!options?.hasErrors;this.value=value;this.alignment=alignment??null;this.format=format??null;Object.freeze(this);}
  get children(){return [this.value];}
  update({value=this.value,alignment=this.alignment,format=this.format}={},type=this.type){return value===this.value&&alignment===this.alignment&&format===this.format&&type===this.type?this:new BoundStringInsert(this.syntax,{value,alignment,format},type,this.options);}
  accept(visitor,argument){return visitor.visitStringInsert(this,argument);}
}
/** await expression; `awaiter` is the runtime await method. */
export class BoundAwaitExpression extends BoundExpression {
  constructor(syntax,{expression,awaiter},type=null,options=null){super('AwaitExpression',syntax,type,options,anyErrors([expression]));this.ownErrors=!!options?.hasErrors;this.expression=expression;this.awaiter=awaiter??null;Object.freeze(this);}
  get children(){return [this.expression];}
  update({expression=this.expression,awaiter=this.awaiter}={},type=this.type){return expression===this.expression&&awaiter===this.awaiter&&type===this.type?this:new BoundAwaitExpression(this.syntax,{expression,awaiter},type,this.options);}
  accept(visitor,argument){return visitor.visitAwaitExpression(this,argument);}
}
/** value switch { arms }. */
export class BoundSwitchExpression extends BoundExpression {
  constructor(syntax,{expression,arms},type=null,options=null){super('SwitchExpression',syntax,type,options,anyErrors([expression,arms]));this.ownErrors=!!options?.hasErrors;this.expression=expression;this.arms=Object.freeze([...arms]);Object.freeze(this);}
  get children(){return [this.expression,...this.arms];}
  update({expression=this.expression,arms=this.arms}={},type=this.type){return expression===this.expression&&sameList(arms,this.arms)&&type===this.type?this:new BoundSwitchExpression(this.syntax,{expression,arms},type,this.options);}
  accept(visitor,argument){return visitor.visitSwitchExpression(this,argument);}
}
/** pattern => value; a null pattern is the discard arm. */
export class BoundSwitchExpressionArm extends BoundExpression {
  constructor(syntax,{pattern,value},type=null,options=null){super('SwitchExpressionArm',syntax,type,options,anyErrors([pattern,value]));this.ownErrors=!!options?.hasErrors;this.pattern=pattern??null;this.value=value;Object.freeze(this);}
  get children(){return [this.pattern,this.value].filter(Boolean);}
  update({pattern=this.pattern,value=this.value}={},type=this.type){return pattern===this.pattern&&value===this.value&&type===this.type?this:new BoundSwitchExpressionArm(this.syntax,{pattern,value},type,this.options);}
  accept(visitor,argument){return visitor.visitSwitchExpressionArm(this,argument);}
}
/** A constant case label or pattern. */
export class BoundConstantPattern extends BoundExpression {
  constructor(syntax,{value,valueType},type=null,options=null){super('ConstantPattern',syntax,type,options,false);this.ownErrors=!!options?.hasErrors;this.value=value??null;this.valueType=valueType??null;Object.freeze(this);}
  get children(){return [];}
  update({value=this.value,valueType=this.valueType}={},type=this.type){return value===this.value&&valueType===this.valueType&&type===this.type?this:new BoundConstantPattern(this.syntax,{value,valueType},type,this.options);}
  accept(visitor,argument){return visitor.visitConstantPattern(this,argument);}
}
/** [a, ..b] targeting an array, List<T> or HashSet<T>. `creation` builds the backing collection held in `collection`; `conversion` (optional) converts it to the target (ToArray). */
export class BoundCollectionExpression extends BoundExpression {
  constructor(syntax,{collection,creation,elements,conversion},type=null,options=null){super('CollectionExpression',syntax,type,options,anyErrors([creation,elements,conversion]));this.ownErrors=!!options?.hasErrors;this.collection=collection??null;this.creation=creation;this.elements=Object.freeze([...elements]);this.conversion=conversion??null;Object.freeze(this);}
  get children(){return [this.creation,...this.elements,this.conversion].filter(Boolean);}
  update({collection=this.collection,creation=this.creation,elements=this.elements,conversion=this.conversion}={},type=this.type){return collection===this.collection&&creation===this.creation&&sameList(elements,this.elements)&&conversion===this.conversion&&type===this.type?this:new BoundCollectionExpression(this.syntax,{collection,creation,elements,conversion},type,this.options);}
  accept(visitor,argument){return visitor.visitCollectionExpression(this,argument);}
}
/** One element added through `addMethod`. */
export class BoundCollectionElement extends BoundExpression {
  constructor(syntax,{value,addMethod},type=null,options=null){super('CollectionElement',syntax,type,options,anyErrors([value]));this.ownErrors=!!options?.hasErrors;this.value=value;this.addMethod=addMethod??null;Object.freeze(this);}
  get children(){return [this.value];}
  update({value=this.value,addMethod=this.addMethod}={},type=this.type){return value===this.value&&addMethod===this.addMethod&&type===this.type?this:new BoundCollectionElement(this.syntax,{value,addMethod},type,this.options);}
  accept(visitor,argument){return visitor.visitCollectionElement(this,argument);}
}
/** ..expression: a bound foreach statement that adds every item held in `iterationVariable`. */
export class BoundCollectionSpread extends BoundExpression {
  constructor(syntax,{iterationVariable,statement},type=null,options=null){super('CollectionSpread',syntax,type,options,anyErrors([statement]));this.ownErrors=!!options?.hasErrors;this.iterationVariable=iterationVariable??null;this.statement=statement;Object.freeze(this);}
  get children(){return [this.statement];}
  update({iterationVariable=this.iterationVariable,statement=this.statement}={},type=this.type){return iterationVariable===this.iterationVariable&&statement===this.statement&&type===this.type?this:new BoundCollectionSpread(this.syntax,{iterationVariable,statement},type,this.options);}
  accept(visitor,argument){return visitor.visitCollectionSpread(this,argument);}
}
/** Lowered form: side effects evaluated in order, then the value. `locals` are temporaries scoped to the sequence. */
export class BoundSequence extends BoundExpression {
  constructor(syntax,{locals,sideEffects,value},type=null,options=null){super('Sequence',syntax,type,options,anyErrors([sideEffects,value]));this.ownErrors=!!options?.hasErrors;this.locals=locals??null;this.sideEffects=Object.freeze([...sideEffects]);this.value=value;Object.freeze(this);}
  get children(){return [...this.sideEffects,this.value];}
  update({locals=this.locals,sideEffects=this.sideEffects,value=this.value}={},type=this.type){return locals===this.locals&&sameList(sideEffects,this.sideEffects)&&value===this.value&&type===this.type?this:new BoundSequence(this.syntax,{locals,sideEffects,value},type,this.options);}
  accept(visitor,argument){return visitor.visitSequence(this,argument);}
}
/** A statement that could not be bound. */
export class BoundBadStatement extends BoundStatement {
  constructor(syntax,{parts},options=null){super('BadStatement',syntax,options,anyErrors([parts]));this.ownErrors=!!options?.hasErrors;this.parts=Object.freeze([...parts]);Object.freeze(this);}
  get children(){return [...this.parts];}
  update({parts=this.parts}={}){return sameList(parts,this.parts)?this:new BoundBadStatement(this.syntax,{parts},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitBadStatement(this,argument);}
}
/** An empty statement. */
export class BoundNoOpStatement extends BoundStatement {
  constructor(syntax,_fields={},options=null){super('NoOpStatement',syntax,options,false);this.ownErrors=!!options?.hasErrors;Object.freeze(this);}
  get children(){return [];}
  update(_fields){return true?this:new BoundNoOpStatement(this.syntax,{},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitNoOpStatement(this,argument);}
}
/** { ... } with the locals declared directly in it. */
export class BoundBlock extends BoundStatement {
  constructor(syntax,{locals,statements},options=null){super('Block',syntax,options,anyErrors([statements]));this.ownErrors=!!options?.hasErrors;this.locals=locals??null;this.statements=Object.freeze([...statements]);Object.freeze(this);}
  get children(){return [...this.statements];}
  update({locals=this.locals,statements=this.statements}={}){return locals===this.locals&&sameList(statements,this.statements)?this:new BoundBlock(this.syntax,{locals,statements},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitBlock(this,argument);}
}
/** One declarator with its initializer. */
export class BoundLocalDeclaration extends BoundStatement {
  constructor(syntax,{local,initializer},options=null){super('LocalDeclaration',syntax,options,anyErrors([initializer]));this.ownErrors=!!options?.hasErrors;this.local=local??null;this.initializer=initializer??null;Object.freeze(this);}
  get children(){return [this.initializer].filter(Boolean);}
  update({local=this.local,initializer=this.initializer}={}){return local===this.local&&initializer===this.initializer?this:new BoundLocalDeclaration(this.syntax,{local,initializer},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitLocalDeclaration(this,argument);}
}
/** A local declaration statement: one sequence point, several declarators. */
export class BoundMultipleLocalDeclarations extends BoundStatement {
  constructor(syntax,{declarations},options=null){super('MultipleLocalDeclarations',syntax,options,anyErrors([declarations]));this.ownErrors=!!options?.hasErrors;this.declarations=Object.freeze([...declarations]);Object.freeze(this);}
  get children(){return [...this.declarations];}
  update({declarations=this.declarations}={}){return sameList(declarations,this.declarations)?this:new BoundMultipleLocalDeclarations(this.syntax,{declarations},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitMultipleLocalDeclarations(this,argument);}
}
/** expression; */
export class BoundExpressionStatement extends BoundStatement {
  constructor(syntax,{expression},options=null){super('ExpressionStatement',syntax,options,anyErrors([expression]));this.ownErrors=!!options?.hasErrors;this.expression=expression;Object.freeze(this);}
  get children(){return [this.expression];}
  update({expression=this.expression}={}){return expression===this.expression?this:new BoundExpressionStatement(this.syntax,{expression},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitExpressionStatement(this,argument);}
}
/** if (condition) consequence else alternative. */
export class BoundIfStatement extends BoundStatement {
  constructor(syntax,{condition,consequence,alternative},options=null){super('IfStatement',syntax,options,anyErrors([condition,consequence,alternative]));this.ownErrors=!!options?.hasErrors;this.condition=condition;this.consequence=consequence;this.alternative=alternative??null;Object.freeze(this);}
  get children(){return [this.condition,this.consequence,this.alternative].filter(Boolean);}
  update({condition=this.condition,consequence=this.consequence,alternative=this.alternative}={}){return condition===this.condition&&consequence===this.consequence&&alternative===this.alternative?this:new BoundIfStatement(this.syntax,{condition,consequence,alternative},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitIfStatement(this,argument);}
}
/** while (condition) body. */
export class BoundWhileStatement extends BoundStatement {
  constructor(syntax,{locals,condition,body,labels},options=null){super('WhileStatement',syntax,options,anyErrors([condition,body]));this.ownErrors=!!options?.hasErrors;this.locals=locals??null;this.condition=condition;this.body=body;this.labels=labels??null;Object.freeze(this);}
  get children(){return [this.condition,this.body];}
  update({locals=this.locals,condition=this.condition,body=this.body,labels=this.labels}={}){return locals===this.locals&&condition===this.condition&&body===this.body&&labels===this.labels?this:new BoundWhileStatement(this.syntax,{locals,condition,body,labels},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitWhileStatement(this,argument);}
}
/** do body while (condition); */
export class BoundDoStatement extends BoundStatement {
  constructor(syntax,{locals,body,condition,labels},options=null){super('DoStatement',syntax,options,anyErrors([body,condition]));this.ownErrors=!!options?.hasErrors;this.locals=locals??null;this.body=body;this.condition=condition;this.labels=labels??null;Object.freeze(this);}
  get children(){return [this.body,this.condition];}
  update({locals=this.locals,body=this.body,condition=this.condition,labels=this.labels}={}){return locals===this.locals&&body===this.body&&condition===this.condition&&labels===this.labels?this:new BoundDoStatement(this.syntax,{locals,body,condition,labels},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitDoStatement(this,argument);}
}
/** for (initializer; condition; increment) body. `locals` are the loop-scoped locals. */
export class BoundForStatement extends BoundStatement {
  constructor(syntax,{locals,initializer,condition,body,increment,labels},options=null){super('ForStatement',syntax,options,anyErrors([initializer,condition,body,increment]));this.ownErrors=!!options?.hasErrors;this.locals=locals??null;this.initializer=initializer??null;this.condition=condition??null;this.body=body;this.increment=increment??null;this.labels=labels??null;Object.freeze(this);}
  get children(){return [this.initializer,this.condition,this.body,this.increment].filter(Boolean);}
  update({locals=this.locals,initializer=this.initializer,condition=this.condition,body=this.body,increment=this.increment,labels=this.labels}={}){return locals===this.locals&&initializer===this.initializer&&condition===this.condition&&body===this.body&&increment===this.increment&&labels===this.labels?this:new BoundForStatement(this.syntax,{locals,initializer,condition,body,increment,labels},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitForStatement(this,argument);}
}
/** foreach over an array (`expression`) or over the GetEnumerator pattern (`enumerator`). `locals` holds the iteration variable. */
export class BoundForEachStatement extends BoundStatement {
  constructor(syntax,{expression,enumerator,iterationVariable,locals,body,labels},options=null){super('ForEachStatement',syntax,options,anyErrors([expression,enumerator,body]));this.ownErrors=!!options?.hasErrors;this.expression=expression??null;this.enumerator=enumerator??null;this.iterationVariable=iterationVariable??null;this.locals=locals??null;this.body=body;this.labels=labels??null;Object.freeze(this);}
  get children(){return [this.expression,this.enumerator,this.body].filter(Boolean);}
  update({expression=this.expression,enumerator=this.enumerator,iterationVariable=this.iterationVariable,locals=this.locals,body=this.body,labels=this.labels}={}){return expression===this.expression&&enumerator===this.enumerator&&iterationVariable===this.iterationVariable&&locals===this.locals&&body===this.body&&labels===this.labels?this:new BoundForEachStatement(this.syntax,{expression,enumerator,iterationVariable,locals,body,labels},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitForEachStatement(this,argument);}
}
/** The pattern-based parts of a foreach: the enumerator declaration, MoveNext(), the iteration variable declaration from Current, and Dispose(). */
export class BoundForEachEnumerator extends BoundStatement {
  constructor(syntax,{enumeratorLocal,declaration,moveNext,current,dispose},options=null){super('ForEachEnumerator',syntax,options,anyErrors([declaration,moveNext,current,dispose]));this.ownErrors=!!options?.hasErrors;this.enumeratorLocal=enumeratorLocal??null;this.declaration=declaration;this.moveNext=moveNext;this.current=current;this.dispose=dispose;Object.freeze(this);}
  get children(){return [this.declaration,this.moveNext,this.current,this.dispose];}
  update({enumeratorLocal=this.enumeratorLocal,declaration=this.declaration,moveNext=this.moveNext,current=this.current,dispose=this.dispose}={}){return enumeratorLocal===this.enumeratorLocal&&declaration===this.declaration&&moveNext===this.moveNext&&current===this.current&&dispose===this.dispose?this:new BoundForEachEnumerator(this.syntax,{enumeratorLocal,declaration,moveNext,current,dispose},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitForEachEnumerator(this,argument);}
}
/** switch (expression) { sections }. */
export class BoundSwitchStatement extends BoundStatement {
  constructor(syntax,{expression,locals,sections,labels},options=null){super('SwitchStatement',syntax,options,anyErrors([expression,sections]));this.ownErrors=!!options?.hasErrors;this.expression=expression;this.locals=locals??null;this.sections=Object.freeze([...sections]);this.labels=labels??null;Object.freeze(this);}
  get children(){return [this.expression,...this.sections];}
  update({expression=this.expression,locals=this.locals,sections=this.sections,labels=this.labels}={}){return expression===this.expression&&locals===this.locals&&sameList(sections,this.sections)&&labels===this.labels?this:new BoundSwitchStatement(this.syntax,{expression,locals,sections,labels},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitSwitchStatement(this,argument);}
}
/** case labels and their statements. */
export class BoundSwitchSection extends BoundStatement {
  constructor(syntax,{switchLabels,statements},options=null){super('SwitchSection',syntax,options,anyErrors([switchLabels,statements]));this.ownErrors=!!options?.hasErrors;this.switchLabels=Object.freeze([...switchLabels]);this.statements=Object.freeze([...statements]);Object.freeze(this);}
  get children(){return [...this.switchLabels,...this.statements];}
  update({switchLabels=this.switchLabels,statements=this.statements}={}){return sameList(switchLabels,this.switchLabels)&&sameList(statements,this.statements)?this:new BoundSwitchSection(this.syntax,{switchLabels,statements},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitSwitchSection(this,argument);}
}
/** case constant: (pattern) or default: (no pattern). */
export class BoundSwitchLabel extends BoundStatement {
  constructor(syntax,{pattern},options=null){super('SwitchLabel',syntax,options,anyErrors([pattern]));this.ownErrors=!!options?.hasErrors;this.pattern=pattern??null;Object.freeze(this);}
  get children(){return [this.pattern].filter(Boolean);}
  update({pattern=this.pattern}={}){return pattern===this.pattern?this:new BoundSwitchLabel(this.syntax,{pattern},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitSwitchLabel(this,argument);}
}
/** try/catch/finally. */
export class BoundTryStatement extends BoundStatement {
  constructor(syntax,{tryBlock,catchBlocks,finallyBlock},options=null){super('TryStatement',syntax,options,anyErrors([tryBlock,catchBlocks,finallyBlock]));this.ownErrors=!!options?.hasErrors;this.tryBlock=tryBlock;this.catchBlocks=Object.freeze([...catchBlocks]);this.finallyBlock=finallyBlock??null;Object.freeze(this);}
  get children(){return [this.tryBlock,...this.catchBlocks,this.finallyBlock].filter(Boolean);}
  update({tryBlock=this.tryBlock,catchBlocks=this.catchBlocks,finallyBlock=this.finallyBlock}={}){return tryBlock===this.tryBlock&&sameList(catchBlocks,this.catchBlocks)&&finallyBlock===this.finallyBlock?this:new BoundTryStatement(this.syntax,{tryBlock,catchBlocks,finallyBlock},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitTryStatement(this,argument);}
}
/** catch (T local) when (filter) body. */
export class BoundCatchBlock extends BoundStatement {
  constructor(syntax,{exceptionType,local,filter,body},options=null){super('CatchBlock',syntax,options,anyErrors([filter,body]));this.ownErrors=!!options?.hasErrors;this.exceptionType=exceptionType??null;this.local=local??null;this.filter=filter??null;this.body=body;Object.freeze(this);}
  get children(){return [this.filter,this.body].filter(Boolean);}
  update({exceptionType=this.exceptionType,local=this.local,filter=this.filter,body=this.body}={}){return exceptionType===this.exceptionType&&local===this.local&&filter===this.filter&&body===this.body?this:new BoundCatchBlock(this.syntax,{exceptionType,local,filter,body},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitCatchBlock(this,argument);}
}
/** using (resources) body. Each resource holds its declaration and the bound null test and Dispose call. */
export class BoundUsingStatement extends BoundStatement {
  constructor(syntax,{resources,body},options=null){super('UsingStatement',syntax,options,anyErrors([resources,body]));this.ownErrors=!!options?.hasErrors;this.resources=Object.freeze([...resources]);this.body=body;Object.freeze(this);}
  get children(){return [...this.resources,this.body];}
  update({resources=this.resources,body=this.body}={}){return sameList(resources,this.resources)&&body===this.body?this:new BoundUsingStatement(this.syntax,{resources,body},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitUsingStatement(this,argument);}
}
/** One using resource: declaration, `resource != null` and `resource.Dispose()`. */
export class BoundUsingResource extends BoundStatement {
  constructor(syntax,{declaration,nullCheck,dispose},options=null){super('UsingResource',syntax,options,anyErrors([declaration,nullCheck,dispose]));this.ownErrors=!!options?.hasErrors;this.declaration=declaration;this.nullCheck=nullCheck;this.dispose=dispose;Object.freeze(this);}
  get children(){return [this.declaration,this.nullCheck,this.dispose];}
  update({declaration=this.declaration,nullCheck=this.nullCheck,dispose=this.dispose}={}){return declaration===this.declaration&&nullCheck===this.nullCheck&&dispose===this.dispose?this:new BoundUsingResource(this.syntax,{declaration,nullCheck,dispose},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitUsingResource(this,argument);}
}
/** return expression; */
export class BoundReturnStatement extends BoundStatement {
  constructor(syntax,{expression},options=null){super('ReturnStatement',syntax,options,anyErrors([expression]));this.ownErrors=!!options?.hasErrors;this.expression=expression??null;Object.freeze(this);}
  get children(){return [this.expression].filter(Boolean);}
  update({expression=this.expression}={}){return expression===this.expression?this:new BoundReturnStatement(this.syntax,{expression},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitReturnStatement(this,argument);}
}
/** throw expression; or rethrow. */
export class BoundThrowStatement extends BoundStatement {
  constructor(syntax,{expression},options=null){super('ThrowStatement',syntax,options,anyErrors([expression]));this.ownErrors=!!options?.hasErrors;this.expression=expression??null;Object.freeze(this);}
  get children(){return [this.expression].filter(Boolean);}
  update({expression=this.expression}={}){return expression===this.expression?this:new BoundThrowStatement(this.syntax,{expression},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitThrowStatement(this,argument);}
}
/** break; or the C# 15 labeled form. */
export class BoundBreakStatement extends BoundStatement {
  constructor(syntax,{label},options=null){super('BreakStatement',syntax,options,false);this.ownErrors=!!options?.hasErrors;this.label=label??null;Object.freeze(this);}
  get children(){return [];}
  update({label=this.label}={}){return label===this.label?this:new BoundBreakStatement(this.syntax,{label},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitBreakStatement(this,argument);}
}
/** continue; or the C# 15 labeled form. */
export class BoundContinueStatement extends BoundStatement {
  constructor(syntax,{label},options=null){super('ContinueStatement',syntax,options,false);this.ownErrors=!!options?.hasErrors;this.label=label??null;Object.freeze(this);}
  get children(){return [];}
  update({label=this.label}={}){return label===this.label?this:new BoundContinueStatement(this.syntax,{label},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitContinueStatement(this,argument);}
}
/** checked { } / unchecked { }. */
export class BoundCheckedStatement extends BoundStatement {
  constructor(syntax,{isChecked,body},options=null){super('CheckedStatement',syntax,options,anyErrors([body]));this.ownErrors=!!options?.hasErrors;this.isChecked=isChecked??null;this.body=body;Object.freeze(this);}
  get children(){return [this.body];}
  update({isChecked=this.isChecked,body=this.body}={}){return isChecked===this.isChecked&&body===this.body?this:new BoundCheckedStatement(this.syntax,{isChecked,body},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitCheckedStatement(this,argument);}
}
/** receiver?.member = value; `receiverLocal` holds the receiver for the assignment. */
export class BoundConditionalAccessAssignment extends BoundStatement {
  constructor(syntax,{receiver,receiverLocal,assignment},options=null){super('ConditionalAccessAssignment',syntax,options,anyErrors([receiver,assignment]));this.ownErrors=!!options?.hasErrors;this.receiver=receiver;this.receiverLocal=receiverLocal??null;this.assignment=assignment;Object.freeze(this);}
  get children(){return [this.receiver,this.assignment];}
  update({receiver=this.receiver,receiverLocal=this.receiverLocal,assignment=this.assignment}={}){return receiver===this.receiver&&receiverLocal===this.receiverLocal&&assignment===this.assignment?this:new BoundConditionalAccessAssignment(this.syntax,{receiver,receiverLocal,assignment},{hasErrors:this.ownErrors});}
  accept(visitor,argument){return visitor.visitConditionalAccessAssignment(this,argument);}
}
function sameList(a,b){if(a===b)return true;if(!a||!b||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
export {boundNodeFields} from './fields.js';
