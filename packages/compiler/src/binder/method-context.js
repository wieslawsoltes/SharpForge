import {DiagnosticId} from '../diagnostics/codes.js';
import {frameworkType,taskResult} from '@sharpforge/framework';
import {BuiltinMap} from '@sharpforge/bytecode';
import {evaluateConstant,ConstantError} from '../constants.js';
import {normalize,numeric,assignable,pathOf,typeText} from '../type-utils.js';
import {LocalSymbol,ParameterSymbol,LocalDeclarationKind} from '../symbols/members.js';
import {BuckStopsHereBinder,InContainerBinder,InMethodBinder,LocalScopeBinder,BinderFlags} from './binder.js';
import {BoundBadExpression} from '../bound/nodes.js';
/**
 * Shared state and semantic queries of the method-body binder.
 *
 * The binder decides with the string-typed profile's rules (the "legacy" type names of ../type-utils.js) so that it
 * accepts exactly the programs the fused compiler accepted, and it publishes what it decided as bound nodes whose
 * `type` is a TypeSymbol. Scopes, parameters and the checked context live in the binder chain; no IR is produced.
 * `infer` and the member queries are side-effect free; `bind*` methods (expressions.js, statements.js) report.
 */
export class MethodBinderContext {
  /** @param compilation the Compilation; @param method the method declaration record being bound. */
  constructor(compilation,method){
    this.c=compilation;this.m=method;this.sym=compilation.semantic;this.loops=[];this.catchDepth=0;this.finallyScopes=[];this.constantDiagnostics=new Set();this.scopeNode=null;this.synthesized=0;this.boundMap=new Map();this.scopeSpans=[];
    this.methodSymbol=this.sym.method(method);const container=compilation.containerBinder?.(method)??new InContainerBinder(method.owner?this.sym.type(method.owner):this.sym.globalNamespace,new BuckStopsHereBinder(compilation,BinderFlags.None));
    this.methodBinder=new InMethodBinder(this.methodSymbol,container);this.thisParameter=null;this.parameters=new Map();this.scope=new LocalScopeBinder(this.methodBinder,method.node);this.scopeSpans.push({binder:this.scope,start:method.node.start,end:method.node.end});
    // Parameters (and `this`) are the outermost variables; declaring them records their IDE symbols and reports duplicates.
    // Compiler-synthesized parameters (the implicit top-level `args`, the startup forwarders) have no source declaration and no IDE symbol.
    if(!method.isStatic){this.thisParameter=new ParameterSymbol({name:'this',type:this.sym.type(method.owner),isThis:true});this.thisParameter.legacyType=method.owner.name;this.thisParameter.declaredAt=method.node.start;}
    this.methodSymbol.parameters.forEach((parameter,i)=>{const p=method.parameters[i];if(this.parameters.has(p.name)||p.name==='this'&&this.thisParameter)this.c.report(p,DiagnosticId.CS0136,[p.name]);parameter.legacyType=p.type;parameter.declaredAt=p.start;parameter.ideSymbol=p.hidden?null:this.c.symbol({...p,name:p.name},'local',p.type,{method:this.m.qualifiedName,scopeStart:this.m.node.start,scopeEnd:this.m.node.end});this.parameters.set(p.name,parameter);});
  }
  // ---- types -------------------------------------------------------------------------------------------------
  /** The TypeSymbol for a legacy type name. */
  type(name){return this.sym.typeOf(name);}
  /** Options for a bound expression of a legacy type. */
  typed(legacyType,extra){return extra?{legacyType,...extra}:{legacyType};}
  /** Creates a bound expression and remembers which syntax it came from (for the semantic model). */
  node(Class,syntax,fields,legacyType,extra){const bound=new Class(syntax,fields,this.type(legacyType),this.typed(legacyType,extra));if(syntax&&!this.boundMap.has(syntax))this.boundMap.set(syntax,bound);return bound;}
  /** Creates a bound statement. */
  statement(Class,syntax,fields,hasErrors=false){const bound=new Class(syntax,fields,hasErrors?{hasErrors:true}:null);if(syntax&&!this.boundMap.has(syntax))this.boundMap.set(syntax,bound);return bound;}
  bad(syntax,children=[],legacyType='error'){return this.node(BoundBadExpression,syntax,{parts:children.filter(Boolean)},legacyType,{hasErrors:true});}
  /** Reports CS0029 unless `from` converts implicitly to `target`; returns whether it does. */
  checkAssign(target,from,node){if(assignable(target,from))return true;this.c.report(node,DiagnosticId.CS0029,[typeText(from),typeText(target)]);return false;}
  // ---- scopes ------------------------------------------------------------------------------------------------
  get localScope(){return this.scope.enclosing(LocalScopeBinder);}
  pushScope(syntax=null){this.scope=new LocalScopeBinder(this.scope,syntax);if(syntax?.start!==undefined)this.scopeSpans.push({binder:this.scope,start:syntax.start,end:syntax.end});return this.scope;}
  /** Leaves the innermost local scope and returns its locals in declaration order. */
  popScope(){const scope=this.localScope,locals=[...scope.locals.values()];this.scope=scope.next;return locals;}
  /** The local, parameter or `this` visible under a name, or null. */
  lookup(name){
    for(let b=this.scope;b;b=b.next){if(b instanceof LocalScopeBinder){const l=b.locals.get(name);if(l)return l;}else if(b instanceof InMethodBinder)return name==='this'?this.thisParameter:this.parameters.get(name)??null;}
    return null;
  }
  /** Declares a local in the current scope (CS0136 when the name is taken in an enclosing scope) and records its IDE symbol. */
  local(name,type,node,hidden=false,options={}){
    if(this.lookup(name))this.c.report(node,DiagnosticId.CS0136,[name]);
    const kind=node.isConst?LocalDeclarationKind.Constant:node.isUsing?LocalDeclarationKind.Using:node.isIteration?LocalDeclarationKind.Foreach:options.declarationKind??LocalDeclarationKind.Regular;
    const local=new LocalSymbol({name,type:this.type(type),declarationKind:kind,containingSymbol:this.methodSymbol,synthesizedKind:options.synthesizedKind??null,syntax:node,locations:node.uri===undefined?[]:[{uri:node.uri,start:node.nameSpan?.start??node.start,end:node.nameSpan?.end??node.end}]});
    local.legacyType=type;local.hidden=hidden;local.declaredAt=node.start;local.constant=null;
    local.ideSymbol=hidden||options.noSymbol?null:this.c.symbol({...node,name},'local',type,{method:this.m.qualifiedName,scopeStart:this.scopeNode?.start??this.m.node.start,scopeEnd:this.scopeNode?.end??this.m.node.end});
    this.localScope.declare(local);return local;
  }
  /** A compiler temporary that is not visible to name lookup. */
  temp(type,synthesizedKind='temp'){const local=new LocalSymbol({name:'$temp'+this.synthesized++,type:this.type(type),containingSymbol:this.methodSymbol,synthesizedKind});local.legacyType=type;local.hidden=true;return local;}
  /** A unique placeholder name for a synthesized, name-visible local; code generation assigns the final name. */
  syntheticName(prefix){return prefix+'#'+this.synthesized++;}
  // ---- context -----------------------------------------------------------------------------------------------
  get checkedContext(){return this.scope.checkedContext;}
  overflowChecked(node){return this.checkedContext??this.c.options.checkOverflowByUri?.[node?.uri??this.m.node.uri]??this.c.options.checkOverflow??false;}
  /** Runs `action` in a checked or unchecked context. */
  inCheckedContext(checked,action){const previous=this.scope;this.scope=this.scope.withCheckedContext(checked);try{return action();}finally{this.scope=previous;}}
  /** Evaluates a constant expression; reports each folding error once. Returns {type,value} or null. */
  constant(node){try{return evaluateConstant(node,{checked:this.checkedContext!==false,resolve:n=>{if(n.kind!=='Name')return null;const local=this.lookup(n.name);if(local?.constant)local.usedAsConstant=true;return local?.constant??null;}});}catch(error){if(!(error instanceof ConstantError))throw error;const key=error.node.start+':'+error.code;if(!this.constantDiagnostics.has(key)){this.constantDiagnostics.add(key);this.c.report(error.node,error.code,error.args);}return null;}}
  // ---- member queries (no diagnostics) -----------------------------------------------------------------------
  property(node){
    if(node.kind==='Name')return this.lookup(node.name)?null:this.m.owner?.properties.find(p=>p.name===node.name)??null;
    if(node.kind!=='Member')return null;
    const named=this.c.findType(pathOf(node.target),this.m);if(named)return named.properties.find(p=>p.name===node.name&&p.isStatic)??null;
    return this.c.findType(this.infer(node.target),this.m)?.properties.find(p=>p.name===node.name&&!p.isStatic)??null;
  }
  field(node){
    if(node.kind==='Name')return this.m.owner?.fields.find(f=>f.name===node.name)??null;
    const path=pathOf(node.target),owner=this.c.findType(path,this.m);if(owner)return owner.fields.find(f=>f.name===node.name&&f.isStatic)??null;
    const type=this.infer(node.target);return this.c.findType(type,this.m)?.fields.find(f=>f.name===node.name&&!f.isStatic)??null;
  }
  isNameof(node){return node?.kind==='Call'&&node.target.kind==='Name'&&node.target.name==='nameof'&&!this.c.methodIndex.named('nameof').some(m=>m.owner===this.m.owner||!m.owner);}
  findBuiltin(node){
    let name=pathOf(node.target);if(name?.startsWith('System.'))name=name.slice(7);if(BuiltinMap.has(name))return BuiltinMap.get(name);
    if(node.target.kind==='Member'){const receiver=this.infer(node.target.target);if(frameworkType(receiver)?.kind==='enum'&&node.target.name==='HasFlag')return BuiltinMap.get('Enum.HasFlag');if(receiver==='string'&&BuiltinMap.has('string.'+node.target.name))return BuiltinMap.get('string.'+node.target.name);if(node.target.name==='GetType')return BuiltinMap.get('object.GetType');if(node.target.name==='ToString')return BuiltinMap.get('object.ToString');}return null;
  }
  /** Overload selection among the user's methods; reports CS0571/CS1501/CS0121 when `report` is set. */
  findMethod(node,report=true){
    let candidates=[];const target=node.target;
    if(target.kind==='Name')candidates=this.c.methodIndex.named(target.name).filter(m=>(m.owner===this.m.owner||!m.owner)&&(!this.m.isStatic||m.isStatic));
    else if(target.kind==='Member'){const path=pathOf(target.target),type=this.c.findType(path,this.m);if(type)candidates=type.methods.filter(m=>m.name===target.name&&m.isStatic);else{const type=this.c.findType(this.infer(target.target),this.m);candidates=type?.methods.filter(m=>m.name===target.name&&!m.isStatic)??[];}}
    if(candidates.some(m=>m.accessor)){if(report)this.c.report(node,DiagnosticId.CS0571,[pathOf(target)??target.name]);candidates=candidates.filter(m=>!m.accessor);}
    const types=node.args.map(a=>this.infer(a));candidates=candidates.filter(m=>m.parameters.length===types.length&&m.parameters.every((p,i)=>assignable(p.type,types[i])));
    const rank=m=>m.parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0);candidates.sort((a,b)=>rank(a)-rank(b));
    if(!candidates.length&&report)this.c.report(node,DiagnosticId.CS1501,[target.name??'<expression>',node.args.length]);
    if(candidates.length>1&&rank(candidates[0])===rank(candidates[1])&&report)this.c.report(node,DiagnosticId.CS0121,[candidates[0].qualifiedName,candidates[1].qualifiedName]);
    return candidates[0]??null;
  }
  switchType(node){const types=node.arms.map(a=>this.infer(a.expression));return types.includes('double')&&types.every(t=>numeric(t))?'double':types.find(t=>t!=='null')??'error';}
  /** The type an expression will have, computed without binding it (used to choose overloads and targets). */
  infer(node){
    if(!node)return 'error';
    if(node.kind==='BoundTemp')return node.type;if(node.kind==='CollectionExpression')return node.targetType??'error';if(node.kind==='New'&&node.type==='<target>')return 'error';
    const external=this.frameworkInfer(node);if(external!==undefined)return external;
    switch(node.kind){
      case 'Await':return taskResult(this.infer(node.expression))??'error';case 'Checked':case 'Unchecked':return this.infer(node.expression);case 'Cast':case 'Default':return this.c.typeName(node.type,this.m);case 'SwitchExpression':return this.switchType(node);
      case 'InterpolatedString':return 'string';case 'Literal':return node.type;case 'Name':return this.lookup(node.name)?.legacyType??this.property(node)?.type??this.m.owner?.fields.find(f=>f.name===node.name)?.type??'error';
      case 'New':return this.c.typeName(node.type,this.m);case 'NewArray':return node.type==='var[]'?(node.values?.length?this.infer(node.values[0])+'[]':'error[]'):node.type;
      case 'Index':{const t=this.infer(node.target);return t.endsWith('[]')?t.slice(0,-2):'error';}
      case 'Member':if(node.name==='Length')return 'int';if(node.name==='Message'&&['Exception','System.Exception'].includes(this.infer(node.target))||['Name','FullName'].includes(node.name)&&this.infer(node.target)==='System.Type')return 'string';return this.property(node)?.type??this.field(node)?.type??'error';
      case 'Call':{if(this.isNameof(node))return 'string';const builtin=this.findBuiltin(node);if(builtin)return builtin.result==='numeric'?node.args.some(a=>this.infer(a)==='double')?'double':'int':builtin.result;return this.findMethod(node,false)?.returnType??'error';}
      case 'Assignment':return this.infer(node.left);case 'Conditional':return this.infer(node.whenTrue);case 'Unary':return node.operator==='!'?'bool':this.infer(node.operand);
      case 'Binary':if(['==','!=','<','>','<=','>=','&&','||'].includes(node.operator))return 'bool';{const l=this.infer(node.left),r=this.infer(node.right);if(node.operator==='+'&&(l==='string'||r==='string'))return 'string';return l==='double'||r==='double'?'double':l;}
      default:return 'error';
    }
  }
}
/** Re-exported helpers so that the expression and statement binders share one vocabulary. */
export const legacyNormalize=normalize;
