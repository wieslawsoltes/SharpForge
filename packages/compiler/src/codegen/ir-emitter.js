import {emitScalarExpression} from './scalar-expressions.js';
import {scalarImageConstant, isScalarType, scalarDefault} from './scalar-values.js';
import {canonicalType,frameworkType,enumTypes} from '@sharpforge/framework';
import {EnumConvertBase,Op,Binary,Unary,BuiltinMap,frameworkBuiltin} from '@sharpforge/bytecode';
import {isReference,defaultValue} from '../type-utils.js';
import {classifyBinary,binaryMode} from '../binder/operators.js';
/**
 * Bytecode IR generation from lowered bound trees.
 *
 * The emitter makes no semantic decisions and reports no diagnostics: it translates bound nodes to the 30-opcode
 * stack IR of @sharpforge/bytecode, allocates local slots and temporaries, records sequence points and exception
 * handlers, and fills the method record (`code`, `locals`, `handlers`). The instruction sequences, slot order and
 * local metadata are those of the fused string-typed compiler, so images stay byte-identical.
 * It expects error-free trees that went through lowering (no using statements, no pattern-based foreach,
 * no interpolated strings, awaits or boxing conversions).
 */
const synthesizedPrefixes=Object.freeze({enumerator:'$enumerator',spread:'$spread',using:'$using'});
export class IrEmitter {
  /** @param compilation the Compilation (constant pool, sequence points, sources); @param method the method record to fill. */
  constructor(compilation,method){
    this.c=compilation;this.m=method;this.code=[];this.locals=[];this.slots=new Map();this.names=new Map();this.loops=[];this.handlers=[];this.scopeNode=null;
    if(!method.isStatic)this.thisSlot=this.addLocal('this',method.owner.name,method.node,true).slot;
    this.parameterSlots=method.parameters.map(p=>this.addLocal(p.name,p.type,p,false).slot);
  }
  get pc(){return this.code.length/3;}
  emit(op,a=0,b=0){const at=this.pc;this.code.push(op,a,b);return at;}
  patch(at,target=this.pc){this.code[at*3+1]=target;}
  emitConstant(value,type){this.emit(Op.CONST,this.c.constant(isScalarType(type)?scalarImageConstant(value,type):value),type==='double'?1:0);}
  emitContract(contract){const b=frameworkBuiltin(contract);this.emit(Op.BUILTIN,b.id,b.min);}
  // ---- locals ------------------------------------------------------------------------------------------------
  addLocal(name,type,node,hidden){const slot=this.locals.length,local={name,type,slot,hidden,scopeStartPc:this.pc,isConst:node.isConst??false,isUsing:node.isUsing??false,isIteration:node.isIteration??false,declaredAt:node.start,scopeEnd:this.scopeNode?.end??this.m.node.end};this.locals.push(local);return local;}
  temp(type='object'){const slot=this.locals.length;this.locals.push({name:`$t${slot}`,type,slot,hidden:true});return slot;}
  /** Fixes the final name of synthesized, name-bearing locals at the point their statement starts. */
  nameSynthesized(locals){for(const local of locals){const prefix=synthesizedPrefixes[local.synthesizedKind];if(prefix&&!this.names.has(local))this.names.set(local,prefix+this.locals.length+(local.synthesizedKind==='using'?'_'+this.pc:''));}}
  /** Allocates the slot of a declared local. */
  declare(local){const record=this.addLocal(this.names.get(local)??local.name,local.legacyType,local.syntax,!!local.hidden);this.slots.set(local,record.slot);return record;}
  /** Allocates a compiler temporary for a synthesized local. */
  declareTemp(local){const slot=this.temp(local.legacyType);this.slots.set(local,slot);return slot;}
  slot(variable){
    if(variable.kind==='Parameter')return variable.isThis?this.thisSlot:this.parameterSlots[variable.ordinal];
    const slot=this.slots.get(variable);if(slot===undefined)throw new Error(`Local '${variable.name}' is used before its declaration was emitted`);return slot;
  }
  clear(slot){if(!isReference(this.locals[slot].type))return;this.emitConstant(null);this.emit(Op.STLOC,slot);this.emit(Op.POP);}
  closeScope(locals){for(const local of locals){const slot=this.slots.get(local);if(slot!==undefined)this.locals[slot].scopeEndPc=this.pc;}}
  seq(node){if(!node||node.debugHidden)return;const source=this.c.sources.get(node.uri);if(!source)return;const pos=source.positionAt(node.start),point={id:this.c.sequencePoints.length,methodId:this.m.id,offset:this.pc,uri:node.uri,start:node.start,end:node.end,line:pos.line+1,column:pos.character+1};this.c.sequencePoints.push(point);this.emit(Op.SEQ,point.id);}
  /** Emits a complete method body followed by the implicit return. */
  build(body){this.stmt(body);this.emitConstant(isScalarType(this.m.returnType)?scalarDefault(this.m.returnType):defaultValue(this.m.returnType),this.m.returnType);this.emit(Op.RET);this.finish();}
  finish(){this.m.code=Int32Array.from(this.code);this.m.locals=this.locals.map(l=>({...l,...(!l.hidden?{scopeEndPc:l.scopeEndPc??this.pc}:{})}));this.m.handlers=this.handlers;}
  // ---- statements --------------------------------------------------------------------------------------------
  stmt(node){
    if(!node)return;const s=node.syntax;
    switch(node.kind){
      case 'Block':{const previous=this.scopeNode;this.scopeNode=s;this.nameSynthesized(node.locals);for(const child of node.statements)this.stmt(child);for(const local of node.locals)if(isReference(local.legacyType))this.clear(this.slot(local));this.closeScope(node.locals);this.scopeNode=previous;break;}
      case 'NoOpStatement':break;
      case 'CheckedStatement':this.stmt(node.body);break;
      case 'MultipleLocalDeclarations':this.seq(s);for(const d of node.declarations){if(d.initializer)this.expr(d.initializer);const l=this.declare(d.local);if(d.initializer){this.emit(Op.STLOC,l.slot);this.emit(Op.POP);}if(d.local.constant)l.constantValue=d.local.constant;}break;
      case 'ExpressionStatement':this.seq(s);this.expr(node.expression);this.emit(Op.POP);break;
      case 'IfStatement':{this.seq({...s,end:s.condition.end});this.expr(node.condition);const jump=this.emit(Op.JFALSE);this.stmt(node.consequence);const end=this.emit(Op.JUMP);this.patch(jump);this.stmt(node.alternative);this.patch(end);break;}
      case 'WhileStatement':case 'DoStatement':case 'ForStatement':{
        const isDo=node.kind==='DoStatement';if(node.initializer)this.stmt(node.initializer);
        const start=this.pc,loop={breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);let exit;
        if(!isDo){this.seq(s.condition??s);if(node.condition){this.expr(node.condition);exit=this.emit(Op.JFALSE);}}
        this.stmt(node.body);const continuePc=this.pc;for(const p of loop.continues)this.patch(p,continuePc);
        if(node.increment){this.seq(s.increment);this.expr(node.increment);this.emit(Op.POP);}
        if(isDo){this.seq(s.condition);this.expr(node.condition);this.emit(Op.JTRUE,start);}else this.emit(Op.JUMP,start);
        if(exit!==undefined)this.patch(exit);for(const p of loop.breaks)this.patch(p);this.loops.pop();this.closeScope(node.locals);break;}
      case 'ForEachStatement':{
        if(node.enumerator)throw new Error('A pattern-based foreach must be lowered before code generation');
        this.nameSynthesized(node.locals);this.seq({...s,end:s.expression.end});this.expr(node.expression);const arr=this.temp(node.expression.legacyType),index=this.temp('int');this.emit(Op.STLOC,arr);this.emit(Op.POP);this.emitConstant(0);this.emit(Op.STLOC,index);this.emit(Op.POP);
        const l=this.declare(node.iterationVariable),start=this.pc;this.seq({...s,end:s.expression.end});this.emit(Op.LDLOC,index);this.emit(Op.LDLOC,arr);this.emit(Op.LENGTH);this.emit(Op.BINARY,Binary['<']);const exit=this.emit(Op.JFALSE);this.emit(Op.LDLOC,arr);this.emit(Op.LDLOC,index);this.emit(Op.LDELEM);this.emit(Op.STLOC,l.slot);this.emit(Op.POP);
        const loop={breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);this.stmt(node.body);for(const p of loop.continues)this.patch(p);this.emit(Op.LDLOC,index);this.emitConstant(1);this.emit(Op.BINARY,Binary['+'],1);this.emit(Op.STLOC,index);this.emit(Op.POP);this.emit(Op.JUMP,start);this.patch(exit);for(const p of loop.breaks)this.patch(p);this.loops.pop();
        this.clear(arr);for(const local of node.locals)if(isReference(local.legacyType))this.clear(this.slot(local));this.closeScope(node.locals);break;}
      case 'BreakStatement':case 'ContinueStatement':{this.seq(s);const isContinue=node.kind==='ContinueStatement',loop=node.label?[...this.loops].reverse().find(l=>l.labels?.includes(node.label)&&(!isContinue||!l.switch)):isContinue?[...this.loops].reverse().find(l=>!l.switch):this.loops.at(-1);loop[isContinue?'continues':'breaks'].push(this.emit(Op.JUMP));break;}
      case 'SwitchStatement':{
        const dispatch=this.switchDispatch(s,node.expression,node.sections.map(section=>section.switchLabels.map(l=>l.pattern))),loop={switch:true,breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);const ends=[];
        node.sections.forEach((section,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);for(const child of section.statements)this.stmt(child);ends.push(this.emit(Op.JUMP));});
        if(dispatch.fallback<0)this.patch(dispatch.otherwise);for(const p of [...ends,...loop.breaks])this.patch(p);this.loops.pop();for(const local of node.locals)this.clear(this.slot(local));this.closeScope(node.locals);this.clear(dispatch.slot);break;}
      case 'ReturnStatement':this.seq(s);if(node.expression)this.expr(node.expression);else this.emitConstant(null);this.emit(Op.RET);break;
      case 'ThrowStatement':this.seq(s);if(node.expression){this.expr(node.expression);this.emit(Op.THROW);}else this.emit(Op.RETHROW);break;
      case 'TryStatement':{
        if(!node.finallyBlock){this.tryCatch(node);break;}
        const start=this.pc;if(node.catchBlocks.length)this.tryCatch(node);else this.stmt(node.tryBlock);
        if(this.pc===start)this.emit(Op.NOP);const end=this.pc,jump=this.emit(Op.JUMP),handler={kind:'finally',start,end,target:this.pc,handlerEnd:0};this.handlers.push(handler);
        this.stmt(node.finallyBlock);this.emit(Op.ENDFINALLY);handler.handlerEnd=this.pc;this.patch(jump);break;}
      case 'ConditionalAccessAssignment':{const slot=this.declareTemp(node.receiverLocal);this.seq(s);this.expr(node.receiver);this.emit(Op.STLOC,slot);this.emit(Op.POP);this.emit(Op.LDLOC,slot);this.emitConstant(null);this.emit(Op.BINARY,Binary['!=']);const done=this.emit(Op.JFALSE);this.expr(node.assignment);this.emit(Op.POP);this.patch(done);this.clear(slot);break;}
      default:throw new Error(`Bound statement '${node.kind}' reached code generation without being lowered`);
    }
  }
  tryCatch(node){
    const start=this.pc;this.stmt(node.tryBlock);if(this.pc===start)this.emit(Op.NOP);const end=this.pc,jumps=[this.emit(Op.JUMP)];
    for(const ca of node.catchBlocks){
      const type=this.c.semantic.nameOf(ca.exceptionType),slot=this.temp('Exception');
      if(ca.local){const l=this.declare(ca.local);l.scopeEnd=ca.body.syntax.end;this.handlers.push({start,end,target:this.pc,slot:l.slot,type});}else this.handlers.push({start,end,target:this.pc,slot,type});
      this.stmt(ca.body);jumps.push(this.emit(Op.JUMP));this.closeScope(ca.local?[ca.local]:[]);
    }
    for(const jump of jumps)this.patch(jump);
  }
  /** Evaluates the governing expression once and emits one equality test per constant label. */
  switchDispatch(syntax,expression,groups){
    this.seq({...syntax,end:syntax.expression.end});this.expr(expression);const slot=this.temp(expression.legacyType);this.emit(Op.STLOC,slot);this.emit(Op.POP);
    const branches=groups.map(()=>[]);let fallback=-1;
    groups.forEach((labels,index)=>labels.forEach(label=>{if(label===null){fallback=index;return;}this.emit(Op.LDLOC,slot);this.emitConstant(label.value,label.valueType);this.emit(Op.BINARY,Binary['==']);branches[index].push(this.emit(Op.JTRUE));}));
    return {branches,fallback,otherwise:this.emit(Op.JUMP),slot};
  }
  // ---- expressions -------------------------------------------------------------------------------------------
  args(list){for(const a of list)this.expr(a);}
  binary(operator,left,right,checked,method,negate){
    if(method){this.emitContract(method.contract);if(negate)this.emit(Op.UNARY,Unary['!']);return;}
    this.emit(Op.BINARY,Binary[operator],binaryMode(operator,left,classifyBinary(operator,left,right).result,checked));
  }
  expr(node){
    if(emitScalarExpression(this,node))return;
    switch(node.kind){
      case 'Literal':this.emitConstant(node.value,node.legacyType);break;
      case 'DefaultExpression':this.emitConstant(isScalarType(node.legacyType)?scalarDefault(node.legacyType):defaultValue(node.legacyType),node.legacyType);break;
      case 'Local':this.emit(Op.LDLOC,this.slot(node.local));break;
      case 'Parameter':this.emit(Op.LDLOC,this.slot(node.parameter));break;
      case 'ThisReference':this.emit(Op.LDLOC,this.thisSlot??0);break;
      case 'FieldAccess':{const f=node.field?.legacy;if(!f){this.emit(Op.ENUM,enumTypes.indexOf(node.legacyType),node.constantValue.value);break;}if(f.isStatic)this.emit(Op.LDSTATIC,f.index);else{this.expr(node.receiver);this.emit(Op.LDFLD,f.index);}break;}
      case 'PropertyAccess':{
        const p=node.property,legacy=p.legacy;
        if(legacy){if(!legacy.isStatic)this.expr(node.receiver);this.emit(Op.CALL,legacy.get.id,legacy.isStatic?0:1);}
        else if(p.builtin){if(node.receiver)this.expr(node.receiver);this.emit(Op.BUILTIN,p.builtin.id,node.receiver?1:0);}
        else{if(node.receiver)this.expr(node.receiver);this.emitContract(p.getMethod.contract);}
        break;}
      case 'IndexerAccess':this.expr(node.receiver);this.args(node.args);this.emitContract(node.indexer.getMethod.contract);break;
      case 'ArrayAccess':this.expr(node.expression);this.expr(node.index);this.emit(Op.LDELEM);break;
      case 'ArrayLength':this.expr(node.expression);this.emit(Op.LENGTH);break;
      case 'Call':{
        if(node.receiver)this.expr(node.receiver);this.args(node.args);const count=node.args.length+(node.receiver?1:0);
        if(node.intrinsic)this.emit(Op.BUILTIN,node.intrinsic.id,count);else if(node.method.contract)this.emitContract(node.method.contract);else this.emit(Op.CALL,node.method.legacy.id,count);
        break;}
      case 'ObjectCreationExpression':this.objectCreation(node);break;
      case 'ArrayCreation':{
        if(node.length)this.expr(node.length);else this.emitConstant(node.hasInitializer?node.initializer.length:0);
        this.emit(Op.NEWARR,this.c.constant(node.legacyType.slice(0,-2)));
        if(node.hasInitializer)node.initializer.forEach((value,i)=>{this.emit(Op.DUP);this.emitConstant(i);this.expr(value);this.emit(Op.STELEM);this.emit(Op.POP);});
        break;}
      case 'DelegateCreationExpression':if(node.receiver)this.expr(node.receiver);else this.emitConstant(null);this.emit(Op.DELEGATE,node.method.legacy.id,this.c.constant(node.legacyType));break;
      case 'UnaryOperator':this.expr(node.operand);this.emit(Op.UNARY,Unary[node.operator],node.operand.legacyType==='int'?(node.isChecked?5:1):0);break;
      case 'IncrementOperator':{
        const ref=this.prepare(node.operand);this.loadRef(ref);const previous=node.isPostfix?this.temp(ref.type):null;if(previous!==null)this.emit(Op.STLOC,previous);
        this.emitConstant(1);this.binary(node.operator==='++'?'+':'-',ref.type,'int',node.isChecked,null,false);this.storeRef(ref);if(previous!==null){this.emit(Op.POP);this.emit(Op.LDLOC,previous);}
        break;}
      case 'BinaryOperator':{
        if(node.operator==='&&'||node.operator==='||'){this.expr(node.left);this.emit(Op.DUP);const jump=this.emit(node.operator==='&&'?Op.JFALSE:Op.JTRUE);this.emit(Op.POP);this.expr(node.right);this.patch(jump);break;}
        this.expr(node.left);this.expr(node.right);this.binary(node.operator,node.left.legacyType,node.right.legacyType,node.isChecked,node.method,node.negate);break;}
      case 'NullCoalescingOperator':{this.expr(node.left);this.emit(Op.DUP);this.emitConstant(null);this.emit(Op.BINARY,Binary['!=']);const jump=this.emit(Op.JTRUE);this.emit(Op.POP);this.expr(node.right);this.patch(jump);break;}
      case 'ConditionalOperator':{this.expr(node.condition);const no=this.emit(Op.JFALSE);this.expr(node.consequence);const done=this.emit(Op.JUMP);this.patch(no);this.expr(node.alternative);this.patch(done);break;}
      case 'AssignmentOperator':{const ref=this.prepare(node.left);this.expr(node.right);this.storeRef(ref);break;}
      case 'CompoundAssignmentOperator':{const ref=this.prepare(node.left);this.loadRef(ref);this.expr(node.right);this.binary(node.operator,ref.type,node.right.legacyType,node.isChecked,node.method,node.negate);this.storeRef(ref);break;}
      case 'NullCoalescingAssignmentOperator':{const ref=this.prepare(node.left);this.loadRef(ref);this.emit(Op.DUP);this.emitConstant(null);this.emit(Op.BINARY,Binary['==']);const done=this.emit(Op.JFALSE);this.emit(Op.POP);this.expr(node.right);this.storeRef(ref);this.patch(done);break;}
      case 'EventAssignmentOperator':this.expr(node.receiver);this.expr(node.argument);this.emitContract(node.event.contract);break;
      case 'Conversion':{
        this.expr(node.operand);if(!node.isExplicit)throw new Error(`Conversion '${node.conversion?.kind}' reached code generation without being lowered`);
        // Roslyn folds floating constants differently from runtime conv.i4 saturation.
        if(node.constantValue&&['int','double'].includes(node.legacyType)){this.emit(Op.POP);this.emitConstant(node.constantValue.value,node.legacyType);break;}
        this.emit(Op.CONVERT,enumTypes.includes(node.legacyType)?EnumConvertBase+enumTypes.indexOf(node.legacyType):node.legacyType==='int'?0:1,node.isChecked?1:0);break;}
      case 'SwitchExpression':{
        const dispatch=this.switchDispatch(node.syntax,node.expression,node.arms.map(a=>[a.pattern])),ends=[];
        node.arms.forEach((arm,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);this.expr(arm.value);ends.push(this.emit(Op.JUMP));});
        if(dispatch.fallback<0){this.patch(dispatch.otherwise);this.emitConstant('No switch expression arm matched.');this.emit(Op.BUILTIN,BuiltinMap.get('Exception.new').id,1);this.emit(Op.THROW);}
        for(const p of ends)this.patch(p);this.clear(dispatch.slot);break;}
      case 'CollectionExpression':{
        const slot=this.declareTemp(node.collection);this.expr(node.creation);this.emit(Op.STLOC,slot);this.emit(Op.POP);
        for(const element of node.elements){if(element.kind==='CollectionSpread'){this.nameSynthesized([element.iterationVariable]);this.stmt(element.statement);}else{this.emit(Op.LDLOC,slot);this.expr(element.value);this.emitContract(element.addMethod.contract);this.emit(Op.POP);}}
        if(node.conversion)this.expr(node.conversion);else this.emit(Op.LDLOC,slot);this.clear(slot);break;}
      case 'Sequence':for(const local of node.locals??[])this.declareTemp(local);for(const effect of node.sideEffects){if(effect.isExpression){this.expr(effect);this.emit(Op.POP);}else this.stmt(effect);}this.expr(node.value);break;
      default:throw new Error(`Bound expression '${node.kind}' reached code generation without being lowered`);
    }
  }
  objectCreation(node){
    const ctor=node.constructorMethod;
    if(ctor?.builtin){this.args(node.args);this.emit(Op.BUILTIN,ctor.builtin.id,node.args.length);return;}
    if(ctor?.contract){
      const name=node.legacyType;this.args(node.args);this.emitContract(ctor.contract);
      if(node.initializers.length){const slot=this.temp(name);this.emit(Op.STLOC,slot);this.emit(Op.POP);for(const init of node.initializers){this.emit(Op.LDLOC,slot);this.expr(init.value);this.emitContract(init.member.contract);this.emit(Op.POP);}this.emit(Op.LDLOC,slot);this.clear(slot);}
      if(node.collectionInitializers.length){const slot=this.temp(name);this.emit(Op.STLOC,slot);this.emit(Op.POP);for(const element of node.collectionInitializers){this.emit(Op.LDLOC,slot);this.args(element.args);this.emitContract(element.addMethod.contract);this.emit(Op.POP);}this.emit(Op.LDLOC,slot);this.clear(slot);}
      return;
    }
    const type=node.type.legacy;this.emit(Op.NEWOBJ,type.id);const slot=this.temp(node.legacyType);this.emit(Op.STLOC,slot);this.emit(Op.POP);
    if(type.initializer!==undefined){this.emit(Op.LDLOC,slot);this.emit(Op.CALL,type.initializer,1);this.emit(Op.POP);}
    if(ctor){this.emit(Op.LDLOC,slot);this.args(node.args);this.emit(Op.CALL,ctor.legacy.id,node.args.length+1);this.emit(Op.POP);}
    for(const init of node.initializers){
      const member=init.member.legacy;this.emit(Op.LDLOC,slot);this.expr(init.value);
      if(init.member.kind==='Property'){this.emit(Op.CALL,member.set.id,2);this.emit(Op.POP);}else{this.emit(Op.STFLD,member.index);this.emit(Op.POP);}
    }
    this.emit(Op.LDLOC,slot);this.clear(slot);
  }
  // ---- assignment targets ------------------------------------------------------------------------------------
  /** Evaluates the receiver and index of an assignment target once into temporaries and describes how to load and store it. */
  prepare(node){
    const type=node.legacyType;
    switch(node.kind){
      case 'Local':return {kind:'local',type,slot:this.slot(node.local)};
      case 'Parameter':return {kind:'local',type,slot:this.slot(node.parameter)};
      case 'ThisReference':return {kind:'local',type,slot:this.thisSlot??0};
      case 'FieldAccess':{const f=node.field.legacy;if(f.isStatic)return {kind:'static',type,index:f.index};this.expr(node.receiver);const receiver=this.temp(f.owner.name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);return {kind:'field',type,index:f.index,receiver};}
      case 'PropertyAccess':{
        const legacy=node.property.legacy;
        if(legacy){let receiver=null;if(!legacy.isStatic){this.expr(node.receiver);receiver=this.temp(legacy.owner.name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);}return {kind:'property',property:legacy,type,receiver};}
        let receiver=null;if(node.receiver){this.expr(node.receiver);const legacyType=node.receiver.legacyType;receiver=this.temp(frameworkType(legacyType==='string'?'System.String':canonicalType(legacyType)).name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);}
        return {kind:'framework',type,receiver,get:node.property.getMethod?.contract??null,set:node.property.setMethod?.contract??null};}
      case 'IndexerAccess':{
        const get=node.indexer.getMethod?.contract??null,set=node.indexer.setMethod?.contract??null;this.expr(node.receiver);const receiver=this.temp(node.receiver.legacyType);this.emit(Op.STLOC,receiver);this.emit(Op.POP);
        this.expr(node.args[0]);const key=this.temp(get?.parameters[0]??set.parameters[0]);this.emit(Op.STLOC,key);this.emit(Op.POP);return {kind:'framework',type,receiver,key,get,set};}
      case 'ArrayAccess':{this.expr(node.expression);const receiver=this.temp(node.expression.legacyType);this.emit(Op.STLOC,receiver);this.emit(Op.POP);this.expr(node.index);const index=this.temp('int');this.emit(Op.STLOC,index);this.emit(Op.POP);return {kind:'index',type,receiver,index};}
      default:throw new Error(`Bound node '${node.kind}' is not an assignment target`);
    }
  }
  loadRef(ref){
    if(ref.kind==='framework'){if(!ref.get){this.emitConstant(null);return;}if(ref.receiver!==null)this.emit(Op.LDLOC,ref.receiver);if(ref.key!==undefined)this.emit(Op.LDLOC,ref.key);this.emitContract(ref.get);}
    else if(ref.kind==='property'){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.CALL,ref.property.get.id,ref.property.isStatic?0:1);}
    else if(ref.kind==='local')this.emit(Op.LDLOC,ref.slot);else if(ref.kind==='static')this.emit(Op.LDSTATIC,ref.index);
    else{this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='field')this.emit(Op.LDFLD,ref.index);else{this.emit(Op.LDLOC,ref.index);this.emit(Op.LDELEM);}}
  }
  storeRef(ref){
    if(ref.kind==='framework'){
      const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);
      if(ref.set){if(ref.receiver!==null)this.emit(Op.LDLOC,ref.receiver);if(ref.key!==undefined)this.emit(Op.LDLOC,ref.key);this.emit(Op.LDLOC,value);this.emitContract(ref.set);this.emit(Op.POP);}
      this.emit(Op.LDLOC,value);this.clear(value);if(ref.receiver!==null)this.clear(ref.receiver);if(ref.key!==undefined)this.clear(ref.key);
    }else if(ref.kind==='property'){
      const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);
      if(ref.property.set){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.LDLOC,value);this.emit(Op.CALL,ref.property.set.id,ref.property.isStatic?1:2);this.emit(Op.POP);}
      this.emit(Op.LDLOC,value);this.clear(value);if(ref.receiver!==null)this.clear(ref.receiver);
    }else if(ref.kind==='local')this.emit(Op.STLOC,ref.slot);else if(ref.kind==='static')this.emit(Op.STSTATIC,ref.index);
    else{const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='index')this.emit(Op.LDLOC,ref.index);this.emit(Op.LDLOC,value);this.emit(ref.kind==='field'?Op.STFLD:Op.STELEM,ref.kind==='field'?ref.index:0);this.clear(value);this.clear(ref.receiver);if(ref.kind==='index')this.clear(ref.index);}
  }
}
