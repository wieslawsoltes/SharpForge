import {DiagnosticId} from '../diagnostics/codes.js';
import {parseExpression} from '@sharpforge/syntax';
import {parseCompilerInput} from '../parse-input.js';
import {Compilation} from '../compilation.js';
import {MethodBodyBinder} from '../binder/method-body.js';
import {LookupOptions} from '../binder/binder.js';
import {SymbolKind} from '../symbols/types.js';
import {analyzeRegion} from '../flow/region-analysis.js';
/**
 * The semantic model over the execution binder: the query surface language services use to ask what a piece of
 * syntax means, for a program the execution profile compiles by itself (../semantic-model.js chooses the model).
 *
 *   getSymbolInfo(node)      the symbol an expression or name refers to
 *   getTypeInfo(node)        the type of an expression (and the type it converts to)
 *   getDeclaredSymbol(node)  the symbol a declaration introduces
 *   getConstantValue(node)   the compile-time constant value of an expression
 *   lookupSymbols(position)  the symbols in scope at a position, optionally by name
 *   bindSpeculativeExpression(position, text)  binds an expression that is not in the source, in the scope at a position
 *   analyzeDataFlow / analyzeControlFlow       region analysis for refactorings (flow/region-analysis.js)
 *
 * It is built over a Compilation that ran the bound pipeline: queries read the bound trees, binders and scopes the
 * pipeline kept. Nothing here re-runs or mutates the compilation; speculative binding works on a shadow that
 * collects its own diagnostics.
 */
const spanContains=(node,position)=>node.start<=position&&position<=node.end;
const sameSyntax=(a,b)=>a===b||!!a&&!!b&&a.uri===b.uri&&a.start===b.start&&a.end===b.end&&a.kind===b.kind;
export class ExecutionSemanticModel {
  /** @param compilation a Compilation that was built with the bound pipeline. */
  constructor(compilation){
    if(!compilation.boundPipeline)throw new TypeError('A SemanticModel needs a compilation built with the bound pipeline');
    this.compilation=compilation;this.symbols=compilation.semantic;this.units=compilation.boundPipeline.units;this.bound=new Map();this.targets=new Map();this.unitOf=new Map();
    for(const unit of this.units){
      for(const [syntax,node] of unit.binder.boundMap){this.bound.set(syntax,node);this.unitOf.set(syntax,unit);
        // The name part of a call (`obj.Method` in `obj.Method(1)`) has no bound node of its own: it means the method.
        if(node.kind==='Call'&&syntax.target)this.targets.set(syntax.target,node.method);else if(node.kind==='DelegateCreationExpression')this.targets.set(syntax.kind==='New'?syntax.args?.[0]??syntax:syntax,node.method);}
    }
  }
  /** Compiles `input` (source text or `{uri,text}` files) with the bound pipeline and returns `{model,result,compilation}`. */
  static create(input,options={}){
    const compilation = new Compilation(parseCompilerInput(input, options), {...options, pipeline: 'bound'});
    const result = compilation.build();
    return {model:new this(compilation),result,compilation};
  }
  /** The bound node a syntax node produced, or null. */
  getBoundNode(node){return this.bound.get(node)??null;}
  symbolOf(bound){
    switch(bound?.kind){
      case 'Local':return bound.local;case 'Parameter':return bound.parameter;case 'ThisReference':return bound.type;
      case 'FieldAccess':return bound.field;case 'PropertyAccess':return bound.property;case 'IndexerAccess':return bound.indexer;
      case 'Call':return bound.method;case 'DelegateCreationExpression':return bound.method;case 'ObjectCreationExpression':return bound.constructorMethod??bound.type;
      case 'TypeExpression':return bound.typeSymbol;case 'EventAssignmentOperator':return bound.event;case 'AwaitExpression':return bound.awaiter;
      case 'BinaryOperator':case 'CompoundAssignmentOperator':return bound.method??null;case 'ObjectInitializerMember':return bound.member;
      default:return null;
    }
  }
  /**
   * The symbol a syntax node refers to: `{symbol, candidateSymbols, candidateReason}`.
   * `candidateReason` is 'none' when a symbol was found, else 'notFound' (or 'ambiguous' with the candidates).
   */
  getSymbolInfo(node){
    const found=symbol=>({symbol,candidateSymbols:[],candidateReason:'none'}),bound=this.bound.get(node);let symbol=this.symbolOf(bound);
    if(!symbol&&this.targets.has(node))symbol=this.targets.get(node);
    if(symbol)return found(symbol);
    // A name that is not a value: a type (the receiver of a static access) or a namespace.
    if(node&&(node.kind==='Name'||node.kind==='Member')&&!bound){
      const path=node.kind==='Name'?node.name:this.pathOf(node),context=this.contextOf(node);
      if(path){const looked=this.compilation.lookupType(path,context);if(looked?.type)return found(this.symbols.type(looked.type));if(looked?.ambiguous)return {symbol:null,candidateSymbols:looked.ambiguous.map(t=>this.symbols.type(t)),candidateReason:'ambiguous'};
        const scoped=node.kind==='Name'?this.compilation.containerBinder(context).lookup(path,0,LookupOptions.NamespacesAndTypesOnly|LookupOptions.AllArities):null;if(scoped?.symbol)return found(scoped.symbol.kind===SymbolKind.Alias?scoped.symbol.target:scoped.symbol);
        // The profile resolves framework types by alias and System types without a using directive.
        const framework=this.symbols.bridge.typeFromName(path)??this.symbols.bridge.typeFromName('System.'+path)??this.symbols.globalNamespace.lookupType(path)??this.symbols.globalNamespace.lookupNamespace(path);if(framework)return found(framework);}
    }
    return {symbol:null,candidateSymbols:[],candidateReason:'notFound'};
  }
  pathOf(e){return e?.kind==='Name'?e.name:e?.kind==='Member'&&this.pathOf(e.target)?this.pathOf(e.target)+'.'+e.name:null;}
  /** The method record whose body contains a syntax node (null outside method bodies). */
  contextOf(node){return this.unitOf.get(node)?.method??this.methodAt(node.start,node.uri)?.method??null;}
  /** `{type, convertedType}` of an expression or of the variable a declaration introduces; both null when unknown. */
  getTypeInfo(node){
    const bound=this.bound.get(node);
    if(bound?.isExpression)return {type:bound.type,convertedType:bound.type};
    if(bound?.kind==='LocalDeclaration')return {type:bound.local.type,convertedType:bound.local.type};
    if(bound?.kind==='ForEachStatement')return {type:bound.iterationVariable.type,convertedType:bound.iterationVariable.type};
    const info=this.getSymbolInfo(node);if(info.symbol?.kind===SymbolKind.NamedType)return {type:info.symbol,convertedType:info.symbol};
    return {type:null,convertedType:null};
  }
  /** `{hasValue, value}`: the constant value of an expression (literals, folded operators, const locals, nameof, enum members). */
  getConstantValue(node){const bound=this.bound.get(node);return bound?.constantValue?{hasValue:true,value:bound.constantValue.value}:{hasValue:false,value:undefined};}
  /** The symbol a declaration node introduces: class, method, constructor, field, property, parameter, local variable or foreach variable. */
  getDeclaredSymbol(node){
    if(!node)return null;const c=this.compilation;
    switch(node.kind){
      case 'Class':{const record=c.types.find(t=>t.declarations.some(d=>sameSyntax(d,node)));return record?this.symbols.type(record):null;}
      case 'Method':{const record=c.methods.find(m=>!m.accessor&&m.node&&m.name===node.name&&m.node.uri===node.uri&&m.node.start===node.start);return record?this.symbols.method(record):null;}
      case 'Field':{for(const t of c.types){const record=t.fields.find(f=>sameSyntax(f.node,node)&&f.name===node.name);if(record)return this.symbols.field(record);}return null;}
      case 'Property':{for(const t of c.types){const record=t.properties.find(p=>sameSyntax(p.node,node));if(record)return this.symbols.property(record);}return null;}
      case 'Parameter':{for(const unit of this.units){const index=unit.method.parameters.findIndex(p=>p.uri===node.uri&&p.start===node.start&&p.name===node.name);if(index>=0)return unit.binder.methodSymbol.parameters[index];}return null;}
      case 'Variable':{const bound=this.bound.get(node);return bound?.kind==='LocalDeclaration'?bound.local:null;}
      case 'Foreach':{const bound=this.bound.get(node);return bound?.kind==='ForEachStatement'?bound.iterationVariable:null;}
      default:return null;
    }
  }
  /** The pipeline unit (method record, binder, bound body) whose method contains a position. Innermost wins. */
  methodAt(position,uri){
    let best=null;for(const unit of this.units){const node=unit.method.node;if(!node||unit.kind!=='body'||unit.method.synthetic&&!unit.method.accessor&&node.asyncRole!=='body')continue;if(uri!==undefined&&node.uri!==uri)continue;// Top-level statements form one method whose node spans the file: only its statements count as its body.
      const statements=unit.method.name==='<Main>'?node.body?.statements:null,range=statements?.length?{start:statements[0].start,end:statements.at(-1).end}:node;if(!spanContains(range,position))continue;if(!best||node.end-node.start<=best.method.node.end-best.method.node.start)best=unit;}
    return best;
  }
  /** The innermost binder scope at a position in a method body. */
  scopeAt(unit,position){let best=unit.binder.scopeSpans[0];for(const span of unit.binder.scopeSpans)if(span.start<=position&&position<=span.end&&span.end-span.start<=best.end-best.start)best=span;return best.binder;}
  /**
   * The symbols visible at a source position, innermost scope first; with `name`, only the symbols that name binds to.
   * Locals declared after the position are not visible yet. Outside method bodies the namespace and type scopes apply.
   */
  lookupSymbols(position,{uri,name,namespacesAndTypesOnly=false}={}){
    const unit=this.methodAt(position,uri),options=namespacesAndTypesOnly?LookupOptions.NamespacesAndTypesOnly:LookupOptions.Default;
    const binder=unit?this.scopeAt(unit,position):this.compilation.containerBinder({owner:null,node:{uri:uri??this.compilation.files[0]?.source.uri}});
    const visible=s=>s.kind!==SymbolKind.Local||!s.isCompilerGenerated&&(s.syntax?.start??0)<=position;
    if(name!==undefined){const result=binder.lookup(name,0,options|LookupOptions.AllArities);if(result.isEmpty&&unit&&name==='this'&&unit.binder.thisParameter)return [unit.binder.thisParameter];return result.symbols.filter(visible);}
    return binder.lookupSymbols(options).filter(visible).filter(s=>!s.isImplicitlyDeclared||s.kind===SymbolKind.Local);
  }
  /**
   * Binds an expression that is not part of the source as if it were written at `position`.
   * @param expression expression text, or an expression syntax node.
   * @returns `{bound, type, symbol, constantValue, diagnostics:[{code,args}]}`; nothing is added to the compilation.
   */
  bindSpeculativeExpression(position,expression,{uri}={}){
    const unit=this.methodAt(position,uri),diagnostics=[];if(!unit)return {bound:null,type:null,symbol:null,constantValue:{hasValue:false,value:undefined},diagnostics:[{code:DiagnosticId.CS0103,args:[String(expression)]}]};
    let node=expression;if(typeof expression==='string'){const parsed=parseExpression(expression);for(const d of parsed.diagnostics)diagnostics.push({code:d.code,args:[],message:d.message});node=parsed.expression;}
    // A shadow of the compilation: the binder reports, records symbols and references into it, not into the real one.
    const shadow=Object.create(this.compilation);shadow.report=(at,code,args=[])=>{diagnostics.push({code,args});};shadow.symbols=[];shadow.references=[];
    const parseDiagnostics=diagnostics.splice(0),binder=new MethodBodyBinder(shadow,unit.method),chain=[];diagnostics.length=0;for(let b=this.scopeAt(unit,position);b&&!b.method;b=b.next)if(b.locals)chain.unshift(b);
    for(const scope of chain)for(const local of scope.locals.values())if(!local.isCompilerGenerated&&(local.syntax?.start??0)<=position&&!binder.lookup(local.name))binder.localScope.declare(local);
    const bound=binder.bindExpression(node);
    return {bound,type:bound.type,symbol:this.symbolOf(bound),constantValue:bound.constantValue?{hasValue:true,value:bound.constantValue.value}:{hasValue:false,value:undefined},diagnostics:[...parseDiagnostics,...diagnostics]};
  }
  /** The type of a speculative expression (see bindSpeculativeExpression). */
  getSpeculativeTypeInfo(position,expression,options){const {type}=this.bindSpeculativeExpression(position,expression,options);return {type,convertedType:type};}
  /** Flow analysis results (control-flow graph, reachability, definite assignment) of the method at a position. */
  getFlowAnalysis(position,uri){const unit=this.methodAt(position,uri);return unit?.flow??null;}
  /** Data-flow facts for the statements of a method body between two positions (see flow/region-analysis.js). */
  analyzeDataFlow(start,end,{uri}={}){const unit=this.methodAt(start,uri);return unit?analyzeRegion(unit.body,{start,end,parameters:unit.binder.methodSymbol.parameters}).dataFlow:null;}
  /** Control-flow facts for the statements of a method body between two positions. */
  analyzeControlFlow(start,end,{uri}={}){const unit=this.methodAt(start,uri);return unit?analyzeRegion(unit.body,{start,end,parameters:unit.binder.methodSymbol.parameters}).controlFlow:null;}
}
