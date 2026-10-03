/**
 * Definite assignment over the semantic bound tree (SF-A02-T34 for the constructs of SF-A02-E01): locals, out
 * parameters, struct locals assigned field by field, and `this` in struct constructors.
 *   CS0165  use of an unassigned local            CS0170  use of a possibly unassigned field of a struct local
 *   CS0269  read of an out parameter before assignment     CS0177  out parameter not assigned when control leaves
 *   CS0171  struct field not assigned in a constructor (before C# 11; from C# 11 fields are auto-defaulted)
 * The analysis is structural (the bound tree keeps statement structure): a state is the set of definitely assigned
 * variables, `null` stands for unreachable code, branches join by intersection, conditions carry separate
 * when-true/when-false states, and try/finally adds what the finally block assigns. Methods that use goto are skipped.
 */
import {SymbolKind,TypeKind,RefKind} from '../symbols/types.js';
import {MethodKind} from '../symbols/members.js';
import {structInstanceFields} from '../binder/structs.js';

const isUserStruct=type=>!!type&&type.typeKind===TypeKind.Struct&&!type.specialType&&!type.isNullableValueType&&type.isSource;
class State{
  constructor(set=new Set()){this.set=set;}
  clone(){return new State(new Set(this.set));}
  has(key){return this.set.has(key);}
  add(key){this.set.add(key);return this;}
}
const join=(a,b)=>{if(!a)return b?b.clone():null;if(!b)return a.clone();const out=new Set();for(const k of a.set)if(b.set.has(k))out.add(k);return new State(out);};
const fieldKey=(variable,field)=>{variable.daId??=Symbol(variable.name);return variable.daId.toString()+'#'+(field.originalDefinition??field).name+'@'+((field.originalDefinition??field).locations?.[0]?.start??'');};

class Analyzer{
  constructor(method,options){this.method=method;this.o=options;this.diagnostics=[];this.reported=new Set();this.loops=[];this.own=new Set();this.outs=(method?.parameters??[]).filter(p=>p.refKind===RefKind.Out);}
  report(node,code,args,key){if(key!==undefined){if(this.reported.has(key))return;this.reported.add(key);}this.diagnostics.push({node,code,args});}
  fieldsOf(type){return isUserStruct(type)?structInstanceFields(type.originalDefinition??type):[];}
  isAssigned(variable,state){
    if(!state||state.has(variable))return true;
    const fields=this.fieldsOf(variable.type);return fields.length>0&&fields.every(f=>state.has(fieldKey(variable,f)));
  }
  tracked(variable){return this.own.has(variable)||this.outs.includes(variable)||variable===this.thisVariable;}
  // ---- expressions ----
  /** Evaluates an expression for its effects and returns the state after it. */
  expr(e,state){
    if(!e||typeof e!=='object'||!state)return state;
    switch(e.kind){
      case 'Local':this.read(e.local,e,state);return state;
      case 'Parameter':if(e.parameter.refKind===RefKind.Out&&this.outs.includes(e.parameter)&&!this.isAssigned(e.parameter,state)){this.report(e.syntax,'CS0269',[e.parameter.name],e.parameter);state.add(e.parameter);}return state;
      case 'This':if(this.thisVariable&&!this.isAssigned(this.thisVariable,state)&&!e.isImplicit){this.report(e.syntax,'CS0188',['this'],'this');state.add(this.thisVariable);}return state;
      case 'FieldAccess':{
        const variable=this.variableOf(e.receiver);
        if(variable&&this.tracked(variable)&&!e.field.isStatic&&isUserStruct(variable.type)){
          if(!state.has(variable)&&!state.has(fieldKey(variable,e.field))){this.report(e.syntax,'CS0170',[e.field.name],fieldKey(variable,e.field));state.add(fieldKey(variable,e.field));}
          return state;
        }
        return this.expr(e.receiver,state);
      }
      case 'Assignment':case 'RefAssignment':return this.assign(e.left,this.expr(e.right,this.target(e.left,state)));
      case 'CoalesceAssignment':{const after=this.expr(e.left,state),right=this.expr(e.right,after.clone());return join(after,right)??after;}
      case 'CompoundAssignment':{let s=this.expr(e.left,state);s=this.expr(e.right,s);return s;}
      case 'Increment':return this.expr(e.operand,state);
      case 'Binary':if(e.operator==='&&'||e.operator==='||'){const c=this.cond(e,state);return join(c.t,c.f);}return this.expr(e.right,this.expr(e.left,state));
      case 'Unary':return this.expr(e.operand,state);
      case 'Conditional':case 'RefConditional':{const c=this.cond(e.condition,state);return join(this.expr(e.whenTrue,c.t),this.expr(e.whenFalse,c.f));}
      case 'Coalesce':{const s=this.expr(e.left,state);this.expr(e.right,s.clone());return s;}
      case 'ConditionalAccess':{const s=this.expr(e.receiver,state);this.expr(e.whenNotNull,s.clone());return s;}
      case 'IsPattern':{const c=this.cond(e,state);return join(c.t,c.f);}
      case 'Call':case 'ObjectCreation':case 'IndexerAccess':case 'Bad':{
        let s=this.expr(e.receiver,state);const outs=[];
        if(e.kind==='Bad')for(const k of ['operand','left','right'])s=this.expr(e[k],s);
        for(const a of e.args??[]){
          const value=a.expression??a;
          if(a.refKind===RefKind.Out){s=this.target(value,s);outs.push(value);}
          else if(a.refKind===RefKind.Ref&&value.kind==='Local'){this.read(value.local,value,s);}
          else s=this.expr(value,s);
        }
        for(const o of outs)s=this.assign(o,s);
        for(const i of e.initializers??[])s=this.expr(i.value,s);
        for(const c of e.collectionInitializers??[])for(const a of c.args)s=this.expr(a,s);
        return s;
      }
      case 'Lambda':{
        // Captured variables must be assigned where the lambda is created; assignments inside do not flow out.
        if(e.body){const inner=state.clone(),saved=this.loops;this.loops=[];if(e.body.kind&&'completes' in e.body)this.stmt(e.body,inner);else this.expr(e.body,inner);this.loops=saved;}
        return state;
      }
      case 'DeclarationExpression':case 'Discard':case 'Literal':case 'TypeExpression':case 'Default':case 'TypeOf':case 'SizeOf':case 'NameOf':case 'ConditionalReceiver':case 'MethodGroup':return state;
      default:{let s=state;for(const child of children(e))s=this.expr(child,s);return s;}
    }
  }
  /** The variable (local, out parameter or struct `this`) an expression denotes directly, or null. */
  variableOf(e){if(!e)return null;if(e.kind==='Local')return e.local;if(e.kind==='Parameter')return e.parameter;if(e.kind==='This')return this.thisVariable??null;return null;}
  read(local,node,state){if(!this.own.has(local)||this.isAssigned(local,state))return;this.report(node.syntax,'CS0165',[local.name],local);state.add(local);}
  /** Evaluates the sub-expressions of an assignment target that run before the right-hand side (receivers, indices). */
  target(left,state){
    if(!left)return state;
    switch(left.kind){
      case 'Local':case 'Parameter':case 'Discard':case 'DeclarationExpression':case 'This':return state;
      case 'FieldAccess':{const v=this.variableOf(left.receiver);if(v&&this.tracked(v))return state;return this.expr(left.receiver,state);}
      case 'PropertyAccess':case 'EventAccess':return this.expr(left.receiver,state);
      case 'ArrayAccess':{let s=this.expr(left.array,state);for(const i of left.indices)s=this.expr(i,s);return s;}
      case 'IndexerAccess':{let s=this.expr(left.receiver,state);for(const a of left.args??[])s=this.expr(a.expression??a,s);return s;}
      default:return this.expr(left,state);
    }
  }
  assign(left,state){
    if(!state||!left)return state;
    if(left.kind==='Local'||left.kind==='DeclarationExpression'){if(left.local){if(left.kind==='DeclarationExpression')this.declare(left.local);state.add(left.local);}return state;}
    if(left.kind==='Parameter'){state.add(left.parameter);return state;}
    if(left.kind==='This'&&this.thisVariable){state.add(this.thisVariable);return state;}
    if(left.kind==='FieldAccess'){const v=this.variableOf(left.receiver);if(v&&this.tracked(v)&&!left.field.isStatic)state.add(fieldKey(v,left.field));}
    if(left.kind==='PropertyAccess'&&left.property.backingField&&left.receiver?.kind==='This'&&this.thisVariable)state.add(fieldKey(this.thisVariable,left.property.backingField));
    return state;
  }
  /** Evaluates a boolean expression and returns the states when it is true and when it is false. */
  cond(e,state){
    if(!state)return {t:null,f:null};
    if(e.constantValue&&e.constantValue.type==='bool'&&e.constantValue.value!==null){const s=this.expr(e,state);return e.constantValue.value?{t:s,f:null}:{t:null,f:s};}
    switch(e.kind){
      case 'Binary':
        if(e.operator==='&&'){const l=this.cond(e.left,state),r=this.cond(e.right,l.t);return {t:r.t,f:join(l.f,r.f)};}
        if(e.operator==='||'){const l=this.cond(e.left,state),r=this.cond(e.right,l.f);return {t:join(l.t,r.t),f:r.f};}
        break;
      case 'Unary':if(e.operator==='!'&&!e.method){const c=this.cond(e.operand,state);return {t:c.f,f:c.t};}break;
      case 'Conversion':if(e.conversion?.kind==='Identity')return this.cond(e.operand,state);break;
      case 'IsPattern':{const s=this.expr(e.operand,state),t=s.clone();this.patternLocals(e.pattern,t,true);
        // `x is not T t`: the variable is assigned when the test is false.
        if(e.pattern?.kind==='NotPattern'){const f=s.clone();this.patternLocals(e.pattern.pattern,f,true);return {t:s.clone(),f};}
        return {t,f:s};}
      case 'Call':{
        // A call's out arguments are assigned in both outcomes.
        const s=this.expr(e,state);return {t:s,f:s?.clone()??null};
      }
    }
    const s=this.expr(e,state);return {t:s,f:s?.clone()??null};
  }
  patternLocals(p,state,definite){if(!p)return;if(p.local){this.declare(p.local);if(definite&&state)state.add(p.local);}if(p.kind==='AndPattern'){this.patternLocals(p.left,state,definite);this.patternLocals(p.right,state,definite);}else if(p.kind==='OrPattern'||p.kind==='NotPattern'){this.patternLocals(p.left??p.pattern,state,false);this.patternLocals(p.right,state,false);}}
  // ---- statements ----
  declare(local){this.own.add(local);}
  stmt(s,state){
    if(!s||!state)return state&&s?state:null;
    switch(s.kind){
      case 'Block':{let st=state;for(const x of s.statements){if(x.kind==='LocalFunction')this.localFunction(x,st);else if(st)st=this.stmt(x,st);}return st;}
      case 'Empty':case 'Bad':return state;
      case 'ExpressionStatement':{const after=this.expr(s.expression,state);return s.completes===false?null:after;}
      case 'ExpressionBody':{const after=this.expr(s.expression,state);if(s.isReturn){this.leave(after,null);return null;}return after;}
      case 'LocalDeclaration':return this.declarations(s.declarations,state);
      case 'If':{const c=this.cond(s.condition,state);return join(this.stmt(s.then,c.t),s.otherwise?this.stmt(s.otherwise,c.f):c.f);}
      case 'While':{const c=this.cond(s.condition,state),loop=this.enter(true);this.stmt(s.body,c.t);this.loops.pop();return join(c.f,loop.breaks);}
      case 'Do':{const loop=this.enter(true),after=this.stmt(s.body,state.clone());this.loops.pop();const c=this.cond(s.condition,join(after,loop.continues));return join(c.f,loop.breaks);}
      case 'For':{
        let st=this.declarations(s.declaration??[],state);for(const i of s.initializers)st=this.expr(i,st);
        const c=s.condition?this.cond(s.condition,st):{t:st,f:null},loop=this.enter(true),after=this.stmt(s.body,c.t?.clone()??null);this.loops.pop();
        let inc=join(after,loop.continues);for(const i of s.incrementors)inc=this.expr(i,inc);
        return join(c.f,loop.breaks);
      }
      case 'ForEach':{const st=this.expr(s.collection,state);if(s.local)this.declare(s.local);const inner=st.clone();if(s.local)inner.add(s.local);const loop=this.enter(true);this.stmt(s.body,inner);this.loops.pop();return join(st,loop.breaks);}
      case 'Switch':{
        const st=this.expr(s.governing,state),sw=this.enter(false);let exhaustive=false,fallout=null;
        for(const section of s.sections){
          const entry=st.clone();
          for(const l of section.labels){if(l.kind==='default'||l.kind==='DiscardPattern')exhaustive=true;if(l.local){this.declare(l.local);if(section.labels.length===1)entry.add(l.local);}if(l.when)this.expr(l.when,entry);}
          const end=this.stmt(section.body,entry);if(end)fallout=join(fallout,end);
        }
        this.loops.pop();
        let result=sw.breaks;if(!exhaustive)result=join(result,st);if(fallout)result=join(result,fallout);return result;
      }
      case 'Return':{const after=s.expression?this.expr(s.expression,state):state;this.leave(after,s.syntax);return null;}
      case 'Throw':if(s.expression)this.expr(s.expression,state);return null;
      case 'YieldBreak':return null;
      case 'YieldReturn':return this.expr(s.expression,state);
      case 'Break':{const target=this.loops.at(-1);if(target)target.breaks=join(target.breaks,state)??state.clone();return null;}
      case 'Continue':{const target=[...this.loops].reverse().find(l=>l.isLoop);if(target)target.continues=join(target.continues,state)??state.clone();return null;}
      case 'Goto':return null;
      case 'Labeled':return this.stmt(s.statement,state);
      case 'Checked':case 'Unsafe':return this.stmt(s.block,state);
      case 'Lock':return this.stmt(s.body,this.expr(s.expression,state));
      case 'Using':{let st=Array.isArray(s.resources)?this.declarations(s.resources,state):this.expr(s.resources,state);return this.stmt(s.body,st);}
      case 'Fixed':return this.stmt(s.body,this.declarations(s.declaration??[],state));
      case 'Try':{
        const entry=state.clone(),tryEnd=this.stmt(s.body,state.clone());let result=tryEnd;
        for(const c of s.catches){const cs=entry.clone();if(c.local){this.declare(c.local);cs.add(c.local);}if(c.filter)this.expr(c.filter,cs);result=join(result,this.stmt(c.block,cs));}
        if(s.finallyBlock){
          const fin=this.stmt(s.finallyBlock,entry.clone());if(!fin)return null;
          if(result)for(const k of fin.set)if(!entry.has(k))result.add(k);
        }
        return result;
      }
      case 'LocalFunction':this.localFunction(s,state);return state;
      default:return state;
    }
  }
  declarations(list,state){let st=state;for(const d of list){this.declare(d.local);if(d.value){st=this.expr(d.value,st);if(st)st.add(d.local);}}return st;}
  enter(isLoop){const l={isLoop,breaks:null,continues:null};this.loops.push(l);return l;}
  /** Local functions are analysed with every captured variable taken as assigned (their call sites decide in Roslyn). */
  localFunction(s,state){
    const body=s.method?.body;if(!body)return;
    const inner=new Analyzer(s.method,this.o);inner.diagnostics=this.diagnostics;inner.reported=this.reported;inner.run(body);
  }
  /** Control leaves the method: out parameters must be assigned, and - before C# 11 - every field of a struct under construction. */
  leave(state,node){
    if(!state)return;
    for(const p of this.outs)if(!this.isAssigned(p,state))this.report(this.exitNode(node),'CS0177',[p.name],'out:'+p.name+':'+(this.exitNode(node).span?.start??this.exitNode(node).start));
    if(this.thisVariable&&this.o.languageVersion<11&&!state.has(this.thisVariable)){
      for(const f of this.fieldsOf(this.thisVariable.type))if(!state.has(fieldKey(this.thisVariable,f)))this.report(this.method.locations[0],'CS0171',[(f.associatedSymbol??f).toDisplayString(),'11.0'],'field:'+f.name);
    }
  }
  /** CS0177 is reported on the return statement that leaves, or on the method name when control falls off the end. */
  exitNode(node){return node??this.method?.locations?.[0]??{start:0,end:1};}
  run(body){
    const state=new State();
    // A struct constructor without `: this(...)` starts with every field unassigned.
    const type=this.o.containingType;
    if(this.method?.methodKind===MethodKind.Constructor&&isUserStruct(type)&&this.method.initializerSyntax?.kind!=='ThisConstructorInitializer'&&!this.method.isLocalFunctionAnalysis){this.thisVariable={name:'this',type,kind:SymbolKind.Parameter,isThis:true};
      // Field and auto-property initializers run first.
      for(const m of type.getMembers())if(!m.isStatic&&m.initializerSyntax){const f=m.kind===SymbolKind.Property?m.backingField:m;if(f)state.add(fieldKey(this.thisVariable,f));}}
    const end=this.stmt(body,state);
    if(end)this.leave(end,null);
    return this.diagnostics;
  }
}
/** Child expressions of a bound node in evaluation order (generic walk for kinds without special rules). */
export function boundChildren(e){return children(e);}
function children(e){
  const out=[];
  for(const key of ['receiver','operand','left','right','array','condition','whenTrue','whenFalse','governing','handler','expression','target','value']){const v=e[key];if(v&&typeof v==='object'&&typeof v.kind==='string'&&!v.toDisplayString)out.push(v);}
  for(const key of ['indices','elements','parts','sizes','args','arms','initializers']){const v=e[key];if(Array.isArray(v))for(const item of v){if(!item)continue;if(Array.isArray(item)){out.push(...item.filter(x=>x?.kind));continue;}if(item.spread){out.push(item.spread);continue;}const x=item.expression??item.value??item;if(x&&typeof x.kind==='string'&&!x.toDisplayString)out.push(x);}}
  return out;
}
/**
 * @param method the method symbol (null for top-level statements)  @param body its bound body
 * @param {{core:object,languageVersion:number,containingType:object|null}} options
 * @returns {{node:object,code:string,args:any[]}[]}
 */
export function analyzeDefiniteAssignment(method,body,options){
  if(!body||body.binder?.usesGoto||body.binder?.hasLabelsAnywhere)return [];
  return new Analyzer(method,options).run(body);
}
