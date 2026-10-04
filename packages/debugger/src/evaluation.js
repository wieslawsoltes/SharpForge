import {evaluateTransaction} from './evaluation-transaction.js';
import {BuiltinMap} from '@sharpforge/bytecode';
import {isReference,ManagedFault} from '@sharpforge/runtime';
import {admitEvaluationMethod} from './evaluation-admission.js';

const numeric = new Set(['sbyte','byte','short','ushort','char','int','uint','long','ulong','float','double','nint','nuint']);
const normalize = t => ({'System.Int32':'int','System.Double':'double','System.String':'string','System.Boolean':'bool','System.Object':'object','System.Exception':'Exception'}[t] ?? t);
const pathOf = n => n.kind === 'Name' ? n.name : n.kind === 'Member' ? pathOf(n.target) + '.' + n.name : null;
const defaultValue = t => t === 'bool' ? false : numeric.has(t) ? 0 : null;
const error = message => { throw new Error(message); };

/** Executes only parsed C# expressions and verified managed methods. There is no host eval.
 * Target method calls are explicit, bounded, and transactional. Ordinary watches do not use this class.
 */
class EffectfulExpression {
  constructor(session,frame,check) {
    this.session=session; this.vm=session.vm; this.frame=frame; this.check=check;
    this.source=!!this.vm.image; this.checked=false; this.nodes=0;
  }
  pin(value,type) {
    if(isReference(value)) this.vm.heap.pins.push(value);
    return {value,type:normalize(type ?? (value===null?'null':isReference(value)?this.vm.heap.get(value).type:typeof value==='boolean'?'bool':typeof value==='string'?'string':value?.float?'double':typeof value==='bigint'?'long':'int'))};
  }
  convert(v,to) {
    to=normalize(to);
    if(to==='object') {
      if(this.source||v.value===null||isReference(v.value)) return v.value;
      return this.vm.heap.allocate('boxed',v.type,[v.value],[v.value]);
    }
    if(to===v.type) return v.value;
    if(v.type==='null'&&!numeric.has(to)&&to!=='bool') return null;
    if(to==='double'&&v.type==='int') return this.source?Number(v.value):this.vm.storage(v.value,'double');
    if(isReference(v.value)&&this.assignable(to,v.type)) return v.value;
    error(`Cannot convert '${v.type}' to '${to}'`);
  }
  assignable(to,from) {
    if(to===from||to==='object'&&from!=='void'||to==='double'&&from==='int'||from==='null'&&!numeric.has(to)&&to!=='bool') return true;
    if(!this.source) {
      let t=this.vm.inspector.types.find(t=>t.name===from),seen=new Set();
      while(t&&!seen.has(t.token)){seen.add(t.token);if(t.name===to)return true;t=this.vm.inspector.types.find(x=>x.token===t.baseToken);}
    }
    return false;
  }
  literal(value,type) {
    if(type==='string') return this.pin(this.vm.heap.string(value),type);
    if(!this.source&&type==='double') value=this.vm.marshal(value,'double');
    return this.pin(value,type);
  }
  local(name) {
    const f=this.frame;if(!f)return null;
    if(this.source) {
      const m=this.vm.image.methods[f.methodId],position=f.point?.start??Infinity;
      const l=m.locals.filter(l=>l.name===name&&(l.declaredAt??0)<=position&&(l.scopeEnd??Infinity)>=position).at(-1);
      if(!l)return null;
      return {type:l.type,get:()=>f.locals[l.slot],readonly:l.isConst,set:v=>{f.locals[l.slot]=v;this.vm.notifyWrite({kind:'local',frameId:f.id,index:l.slot,value:v});}};
    }
    const l=this.session.slots(f).find(l=>l.name===name||l.aliases.includes(name));
    if(!l)return null;
    return {type:l.type,get:()=>l.kind==='arg'?f.args[l.index]:l.kind==='constant'?l.raw:f.locals[l.index],readonly:l.readOnly,
      set:v=>{(l.kind==='arg'?f.args:f.locals)[l.index]=this.vm.storage(v,l.type);this.vm.writeRevision++;}};
  }
  isType(node) {
    const path=pathOf(node);if(!path||node.kind==='Name'&&this.local(node.name))return false;
    return this.source?this.vm.image.types.some(t=>t.name===path):this.vm.inspector.types.some(t=>t.name===path);
  }
  owner(receiver,explicit=null) {return explicit ?? (receiver?this.vm.heap.get(receiver).type:this.source?this.vm.image.methods[this.frame?.methodId]?.owner:this.frame?.method.owner);}
  property(owner,name) {
    if(this.source)return this.vm.image.types.find(t=>t.name===owner)?.properties?.find(p=>p.name===name);
    const t=this.vm.inspector.types.find(t=>t.name===owner),p=t?.properties.find(p=>p.name===name);if(!p)return null;
    const semantics=(this.vm.inspector.metadata.rows[24]??[]).filter(r=>(r[2]>>>1)===(p.token&0xffffff)&&(r[2]&1)===1);
    const get=semantics.find(r=>r[0]&2),set=semantics.find(r=>r[0]&1),sig=this.vm.inspector.signature(p.token);
    return {name,type:sig.returnType,isStatic:sig.isStatic,get:get?0x06000000|get[1]:null,set:set?0x06000000|set[1]:null};
  }
  field(owner,name,receiver) {
    if(this.source) {
      const t=this.vm.image.types.find(t=>t.name===owner);
      if(receiver){const f=t?.fields.find(f=>f.name===name);if(f)return {type:f.type,get:()=>this.vm.heap.get(receiver).data[f.index],set:v=>{const r=this.vm.heap.get(receiver),oldValue=r.data[f.index];r.data[f.index]=v;this.vm.notifyWrite({kind:'field',handle:receiver.h,generation:receiver.g,index:f.index,value:v,oldValue});}};}
      else {const i=this.vm.image.statics.findIndex(f=>f.name===owner+'.'+name);if(i>=0)return {type:this.vm.image.statics[i].type,get:()=>this.vm.statics[i],set:v=>{const oldValue=this.vm.statics[i];this.vm.statics[i]=v;this.vm.notifyWrite({kind:'static',index:i,value:v,oldValue});}};}
    } else {
      const f=[...this.vm.inspector.fields.values()].find(f=>f.owner===owner&&f.name===name&&f.isStatic===!receiver);
      if(f){const type=this.vm.inspector.signature(f.token).type;return receiver?{type,get:()=>{const p=this.vm.field(f.token,receiver);return p.record.data[p.index];},set:v=>{const p=this.vm.field(f.token,receiver);this.vm.dereference(this.vm.address('field',p.index,receiver),true,this.vm.storage(v,type));}}:{type,get:()=>this.vm.statics.get(f.token),set:v=>{this.vm.statics.set(f.token,this.vm.storage(v,type));this.vm.writeRevision++;}};}
    }
    return null;
  }
  location(n) {
    if(n.kind==='Name') {
      const local=this.local(n.name);if(local)return local;
      const owner=this.owner(null),f=this.frame,receiver=f&&(this.source?!this.vm.image.methods[f.methodId].isStatic:f.method.signature.isStatic===false)?(this.source?f.locals[0]:f.args[0]):null;
      return this.memberLocation(owner,n.name,receiver) ?? error(`Unknown variable '${n.name}'`);
    }
    if(n.kind==='Member') {
      if(this.isType(n.target))return this.memberLocation(pathOf(n.target),n.name,null)??error(`Unknown static member '${pathOf(n)}'`);
      const obj=this.eval(n.target),raw=this.vm.value(obj.value);
      if(n.name==='Length'&&(obj.type==='string'||obj.type.endsWith('[]'))){const length=typeof raw==='string'?raw.length:this.vm.heap.get(obj.value).data.length;return {type:'int',readonly:true,get:()=>length};}
      return this.memberLocation(this.owner(obj.value),n.name,obj.value)??error(`Unknown field or property '${n.name}'`);
    }
    if(n.kind==='Index') {
      const obj=this.eval(n.target),index=this.eval(n.index);if(index.type!=='int')error('Array index must be int');
      const r=this.vm.indexed(obj.value,index.value),type=r.type.slice(0,-2);return {type,get:()=>r.data[index.value],set:v=>{const oldValue=r.data[index.value];r.data[index.value]=v;if(this.source)this.vm.notifyWrite({kind:'array',handle:obj.value.h,generation:obj.value.g,index:index.value,value:v,oldValue});else{this.vm.writeRevision++;this.vm.heap.mutationRevision++;}}};
    }
    error('Expression is not a mutable storage location');
  }
  memberLocation(owner,name,receiver) {
    const field=this.field(owner,name,receiver);if(field)return field;
    const p=this.property(owner,name);if(!p||p.isStatic===!!receiver)return null;
    return {type:p.type,readonly:p.set===null,get:()=>{if(p.get===null)error('Property has no getter');return this.call(p.get,[],receiver).value;},set:v=>{if(p.set===null)error('Property has no setter');this.call(p.set,[this.pin(v,p.type)],receiver);}};
  }
  read(n) {const l=this.location(n),v=l.get();if(v===undefined)error('Variable is unassigned');return this.pin(v,l.type);}
  write(l,v) {if(l.readonly)error('Cannot assign a read-only or constant location');const raw=this.convert(v,l.type);l.set(raw);return this.pin(raw,l.type);}
  binary(op,l,r) {
    if(op==='+'&&(l.type==='string'||r.type==='string'))return this.literal(this.vm.format(l.value,l.type)+this.vm.format(r.value,r.type),'string');
    if(['==','!=','<','<=','>','>='].includes(op)) {
      if(!this.assignable(l.type,r.type)&&!this.assignable(r.type,l.type))error('Incompatible comparison types');
      if(this.source)return this.pin(this.vm.binary(op,l.value,r.value,0),'bool');
      const a=this.vm.value(l.value),b=this.vm.value(r.value);return this.pin(this.vm.compare(a,b,{'==':'eq','!=':'ne','<':'lt','<=':'le','>':'gt','>=':'ge'}[op],false),'bool');
    }
    if(['&','|','^'].includes(op)&&l.type==='bool'&&r.type==='bool')return this.pin(op==='&'?!!l.value&&!!r.value:op==='|'?!!l.value||!!r.value:!!l.value!==!!r.value,'bool');
    if(!numeric.has(l.type)||!numeric.has(r.type))error('Numeric operands are required');
    const type=l.type==='double'||r.type==='double'?'double':l.type;
    if(this.source)return this.pin(this.vm.binary(op,l.value,r.value,type==='int'?(this.checked&&['+','-','*'].includes(op)?5:1):0),type);
    const instruction={'+':'add','-':'sub','*':'mul','/':'div','%':'rem','&':'and','|':'or','^':'xor','<<':'shl','>>':'shr'}[op];if(!instruction)error('Unsupported operator');
    const operand=v=>type==='double'?this.vm.storage(v.value,'double'):v.value;
    return this.pin(this.vm.binary(instruction+(this.checked&&type==='int'&&['add','sub','mul'].includes(instruction)?'.ovf':''),operand(l),operand(r)),type);
  }
  truth(v){if(v.type!=='bool')error('Condition must be Boolean');return !!v.value;}
  eval(n) {
    this.check();if(++this.nodes>4096)error('Expression node budget exceeded');
    switch(n.kind) {
      case 'Literal':return this.literal(n.value,n.type);
      case 'Name':case 'Member':case 'Index':return this.read(n);
      case 'Default':return this.literal(defaultValue(n.type),n.type);
      case 'Parenthesized':return this.eval(n.expression);
      case 'Checked':case 'Unchecked':{const old=this.checked;this.checked=n.kind==='Checked';try{return this.eval(n.expression);}finally{this.checked=old;}}
      case 'Cast':{const v=this.eval(n.expression);if(!numeric.has(v.type)||!['int','double'].includes(n.type))error('Only numeric int/double casts are supported by this C# profile');if(!this.source)return this.pin(this.vm.convert(n.type==='int'?(this.checked?'conv.ovf.i4':'conv.i4'):'conv.r8',v.value),n.type);const x=Number(v.value);if(n.type==='int'&&this.checked&&(!Number.isFinite(x)||Math.trunc(x)<-2147483648||Math.trunc(x)>2147483647))throw new ManagedFault('OverflowException','Checked evaluation cast');return this.pin(n.type==='int'?(Number.isFinite(x)&&x>=-2147483648&&x<2147483648?Math.trunc(x)|0:-2147483648):x,n.type);}
      case 'Conditional':return this.eval(this.truth(this.eval(n.condition))?n.whenTrue:n.whenFalse);
      case 'Binary':{const l=this.eval(n.left);if(n.operator==='&&')return this.pin(this.truth(l)&&this.truth(this.eval(n.right)),'bool');if(n.operator==='||')return this.pin(this.truth(l)||this.truth(this.eval(n.right)),'bool');if(n.operator==='??')return l.value===null?this.eval(n.right):l;return this.binary(n.operator,l,this.eval(n.right));}
      case 'Assignment':{const l=this.location(n.left);if(n.operator==='=')return this.write(l,this.eval(n.right));const old=this.pin(l.get(),l.type);if(n.operator==='??=')return old.value!==null?old:this.write(l,this.eval(n.right));return this.write(l,this.binary(n.operator.slice(0,-1),old,this.eval(n.right)));}
      case 'Unary':{if(['++','--'].includes(n.operator)){const l=this.location(n.operand),old=this.pin(l.get(),l.type),v=this.write(l,this.binary(n.operator==='++'?'+':'-',old,this.literal(1,'int')));return n.postfix?old:v;}const v=this.eval(n.operand);if(n.operator==='!')return this.pin(!this.truth(v),'bool');if(!numeric.has(v.type))error('Numeric unary expression required');if(n.operator==='+')return v;const raw=this.vm.value(v.value);if(n.operator==='~')return this.pin(typeof raw==='bigint'?~raw:~raw,v.type);return this.binary('-',this.literal(0,v.type),v);}
      case 'Call':{
        if(n.target.kind==='Name'&&n.target.name==='nameof'&&n.args.length===1)return this.literal(n.args[0].name??pathOf(n.args[0]).split('.').at(-1),'string');
        // C# evaluates the receiver before arguments, and arguments left-to-right.
        let receiver=null,name=pathOf(n.target),owner=null;
        if(n.target.kind==='Member'){if(this.isType(n.target.target))owner=pathOf(n.target.target);else {const possible=pathOf(n.target.target);if(possible&&this.isIntrinsicOwner(possible)){owner=possible;}else{receiver=this.eval(n.target.target).value;owner=this.owner(receiver);}}name=n.target.name;}
        else owner=this.owner(null);
        const args=n.args.map(a=>this.eval(a));return this.invoke(name,args,receiver,owner);
      }
      case 'NewArray':{const values=n.values?.map(v=>this.eval(v)),element=n.type==='var[]'?values?.[0]?.type:n.type.slice(0,-2);if(!element)error('Cannot infer array element type');const length=n.length?this.eval(n.length):this.literal(values?.length??0,'int');if(length.type!=='int')error('Array length must be int');if(values&&values.length!==length.value)error('Initializer length mismatch');const ref=this.vm.heap.array(element,length.value);this.pin(ref,element+'[]');if(values)values.forEach((v,i)=>this.vm.heap.get(ref).data[i]=this.convert(v,element));return this.pin(ref,element+'[]');}
      case 'New':return this.construct(n);
      case 'SwitchExpression':{const v=this.eval(n.expression);for(const arm of n.arms){if(arm.pattern?.kind==='Name'&&arm.pattern.name==='_'||arm.pattern===null)return this.eval(arm.expression);const p=this.eval(arm.pattern);if(this.binary('==',v,p).value)return this.eval(arm.expression);}error('Switch expression has no matching arm');break;}
      default:error(`Expression '${n.kind}' is not supported by the C# execution profile`);
    }
  }
  isIntrinsicOwner(name){return ['Console','System.Console','Math','System.Math','GC','System.GC','Convert','System.Convert','int','double','string','object','Exception','System.Exception','Debug','Environment'].includes(name);}
  invoke(name,args,receiver,owner) {
    const methods=this.source?this.vm.image.methods:[...this.vm.inspector.methods.values()].map(m=>({...m,...this.vm.inspector.signature(m.token),parameters:this.vm.inspector.signature(m.token).parameters.map(type=>({type}))}));
    let candidates=methods.filter(m=>m.name===name&&(!owner||m.owner===owner)&&m.isStatic===!receiver&&m.parameters.length===args.length);
    if(!candidates.length&&receiver===null&&this.frame&&!owner){const o=this.owner(null);candidates=methods.filter(m=>m.owner===o&&m.name===name&&m.parameters.length===args.length);}
    const ranked=candidates.map(m=>({m,score:m.parameters.reduce((n,p,i)=>n+(p.type===args[i].type?0:this.assignable(p.type,args[i].type)?p.type==='object'?3:1:10000),0)})).filter(x=>x.score<10000).sort((a,b)=>a.score-b.score);
    if(ranked.length){if(ranked[0].score===ranked[1]?.score)error('Ambiguous method overload');return this.call(this.source?ranked[0].m.id:ranked[0].m.token,args,receiver);}
    if(this.isIntrinsicOwner(owner)||receiver&&(this.vm.heap.get(receiver).kind==='string'))return this.intrinsic(owner,name,args,receiver);
    error(`No matching managed method '${owner??''}.${name}(${args.map(a=>a.type).join(', ')})'`);
  }
  intrinsic(owner,name,args,receiver) {
    owner=owner?.replace(/^System\./,'');const full=owner+'.'+name,key=receiver&&this.vm.heap.get(receiver).kind==='string'?'string.'+name:full,b=BuiltinMap.get(key);
    if(!b)error(`External function '${full}' is not available in this execution profile`);
    const values=[...(receiver?[this.pin(receiver,'string')]:[]),...args];if(values.length<b.min||values.length>b.max)error('Intrinsic argument count mismatch');
    if(this.source){const result=this.vm.builtin(b.id,values.map(a=>a.value));return this.pin(result,b.result==='void'?'void':b.result==='numeric'?(values.some(v=>v.type==='double')?'double':'int'):b.result);}
    const result=b.result==='numeric'?(args.some(a=>a.type==='double')?'double':'int'):b.result;
    const signature={kind:'method',isStatic:!receiver,parameters:args.map(a=>a.type),returnType:result};
    const d={kind:'method',owner:{Console:'System.Console',Math:'System.Math',GC:'System.GC',Convert:'System.Convert',int:'System.Int32',double:'System.Double',string:'System.String'}[owner]??owner,name,signature};
    return this.pin(this.vm.intrinsic(d,values.map(a=>a.value)),result);
  }
  call(id,args,receiver) {
    const vm=this.vm,source=this.source,m=source?vm.image.methods[id]:vm.inspector.getMethod(id),signature=source?m:m.signature;
    if(m.isAsync)error('Suspendable async evaluation is not allowed; evaluate a synchronous method or resume the task');
    if(signature.parameters.length!==args.length)error('Method argument count mismatch');
    const converted=args.map((a,i)=>this.convert(a,source?m.parameters[i].type:signature.parameters[i]));
    if(!source)admitEvaluationMethod(vm,id);
    const control={frames:vm.frames,stack:vm.stack,state:vm.state,sourcePause:vm.sourcePause,point:vm.currentPoint,pendingFault:vm.pendingFault,fault:vm.fault,returnValue:vm.returnValue,exitCode:vm.exitCode};
    vm.frames=[];if(source)vm.stack=[];vm.returnValue=null;vm.pendingFault=null;vm.fault=null;vm.state='running';vm.sourcePause=false;
    vm.call(id,[...(!signature.isStatic?[receiver]:[]),...converted]);if(!source)vm.ensureInitialized(m.ownerToken);
    while(vm.frames.length&&vm.state==='running'){this.check();vm.runSlice({instructionBudget:512,timeBudgetMs:4});}
    this.check();if(vm.state==='faulted'||vm.pendingFault)throw vm.fault??vm.pendingFault;
    if(vm.state==='waiting')error('Function evaluation cannot leave a suspended continuation');
    const result=this.pin(signature.returnType==='void'?null:vm.returnValue,signature.returnType);
    Object.assign(vm,control);vm.currentPoint=control.point;delete vm.point;
    return result;
  }
  construct(n) {
    const vm=this.vm,type=normalize(n.type),args=n.args.map(a=>this.eval(a));
    if(type==='Exception'){if(args.length>1)error('Exception constructor requires zero or one argument');const message=args.length?this.convert(args[0],'string'):vm.heap.string('Exception');return this.pin(vm.heap.allocate('exception',this.source?'Exception':'System.Exception',[message],[message]),'Exception');}
    const td=this.source?vm.image.types.find(t=>t.name===type):vm.inspector.types.find(t=>t.name===type);if(!td)error('Unknown managed type');
    const fields=this.source?td.fields:vm.layout(td.token).fields,ref=vm.heap.object(type,fields.map(f=>defaultValue(f.type)));this.pin(ref,type);
    if(this.source&&td.initializer!==undefined)this.call(td.initializer,[],ref);
    const hasConstructor=this.source?vm.image.methods.some(m=>m.owner===type&&m.name==='.ctor'):td.methods.some(m=>m.name==='.ctor');
    if(hasConstructor||args.length)this.invoke('.ctor',args,ref,type);
    for(const init of n.initializers??[]){const l=this.memberLocation(type,init.name,ref);if(!l)error('Unknown object initializer member');this.write(l,this.eval(init.expression));}
    return this.pin(ref,type);
  }
}

/** Evaluate with explicit consent. commit:false rolls back managed state, including GC,
 * output, exception state and initialization. This is not a sandbox for native host effects.
 */
export function evaluateFunction(session,expression,options={}) {return evaluateTransaction(session,expression,options,EffectfulExpression);}
export function releaseEvaluationHandles(session){for(const h of session.evaluationHandles??[])session.vm.heap.releaseHandle(h);session.evaluationHandles=[];}
