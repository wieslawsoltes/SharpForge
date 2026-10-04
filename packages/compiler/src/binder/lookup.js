import {DiagnosticId} from '../diagnostics/codes.js';
import {SymbolKind,ArrayTypeSymbol,ErrorTypeSymbol} from '../symbols/types.js';
import {LookupOptions,LookupResultKind} from './binder.js';
import {specialTypeFromKeyword} from '../symbols/special-types.js';
/**
 * Name lookup for namespace and type names: simple (`List`), qualified (`System.Text.StringBuilder`),
 * generic (`Dictionary<string, int>`), array (`int[]`) and alias-qualified (`global::System.Int32`, `X::Y`).
 *
 * Diagnostics follow Roslyn: CS0246 (name not found), CS0234 (missing in a namespace), CS0426 (missing nested type),
 * CS0104 (ambiguous between two symbols), CS0118 (a namespace used as a type), CS0305/CS0308 (wrong generic arity),
 * CS0432/CS0431 (bad alias qualifier). Failures yield an ErrorTypeSymbol that remembers the diagnostic as `reason`.
 */
/** Splits the top-level items of a comma list, respecting nested <...>. */
function splitArguments(text){const parts=[];let depth=0,start=0;for(let i=0;i<text.length;i++){const c=text[i];if(c==='<'||c==='['||c==='(')depth++;else if(c==='>'||c===']'||c===')')depth--;else if(c===','&&depth===0){parts.push(text.slice(start,i).trim());start=i+1;}}parts.push(text.slice(start).trim());return parts;}
/**
 * Parses type-name text into `{alias, segments:[{name,typeArguments:[parsed]}], ranks:[n], nullable}`.
 * Returns null for text that is not a type name.
 */
export function parseTypeName(text){
  let rest=String(text).trim();const ranks=[];let nullable=false;
  for(;;){const m=/\[(,*)\]$/.exec(rest);if(m){ranks.unshift(m[1].length+1);rest=rest.slice(0,m.index).trim();continue;}if(rest.endsWith('?')&&!nullable&&!ranks.length){nullable=true;rest=rest.slice(0,-1).trim();continue;}break;}
  let alias=null;const colon=rest.indexOf('::');if(colon>0&&!rest.slice(0,colon).includes('<')){alias=rest.slice(0,colon).trim();rest=rest.slice(colon+2);}
  const segments=[];let depth=0,start=0;const push=end=>{const part=rest.slice(start,end).trim(),open=part.indexOf('<');if(!part)return false;
    if(open<0){if(!/^@?[\p{L}_][\p{L}\p{N}_]*$/u.test(part))return false;segments.push({name:part.replace(/^@/,''),typeArguments:[]});return true;}
    if(!part.endsWith('>'))return false;const name=part.slice(0,open).replace(/`\d+$/,'').trim(),args=splitArguments(part.slice(open+1,-1)).map(parseTypeName);if(!name||args.some(a=>!a))return false;segments.push({name,typeArguments:args});return true;};
  for(let i=0;i<rest.length;i++){const c=rest[i];if(c==='<')depth++;else if(c==='>')depth--;else if(c==='.'&&depth===0){if(!push(i))return null;start=i+1;}}
  if(!push(rest.length))return null;return {alias,segments,ranks,nullable};
}
const describe=symbol=>symbol.kind===SymbolKind.Alias?describe(symbol.target):symbol.toDisplayString();
const kindWord=symbol=>symbol.kind===SymbolKind.Namespace?'namespace':symbol.kind===SymbolKind.NamedType||symbol.kind===SymbolKind.TypeParameter?'type':symbol.kind===SymbolKind.Method?'method':symbol.kind===SymbolKind.Field?'field':symbol.kind===SymbolKind.Property?'property':'variable';
/**
 * Looks up the leftmost name of a type or namespace reference through the binder chain.
 * Returns {symbol} or {error:{code,args}, candidates}.
 */
export function lookupSimpleName(binder,name,arity=0,options=LookupOptions.NamespacesAndTypesOnly){
  const result=binder.lookup(name,arity,options);
  if(result.isViable){let symbol=result.symbols[0];if(symbol.kind===SymbolKind.Alias)symbol=symbol.target;return {symbol,result};}
  if(result.isAmbiguous)return {error:{code:DiagnosticId.CS0104,args:[name,describe(result.symbols[0]),describe(result.symbols[1])]},candidates:result.symbols,result};
  const [why,near]=result.nonViable;
  if(why===LookupResultKind.WrongArity){const type=near.find(s=>s.kind===SymbolKind.NamedType);if(type)return {error:type.arity?{code:DiagnosticId.CS0305,args:[type.toDisplayString(),'type',type.arity]}:{code:DiagnosticId.CS0308,args:[type.toDisplayString(),'type']},candidates:near,result};}
  if(why===LookupResultKind.NotATypeOrNamespace)return {error:{code:DiagnosticId.CS0118,args:[name,kindWord(near[0]),'type']},candidates:near,result};
  return {error:{code:DiagnosticId.CS0246,args:[name]},candidates:[],result};
}
/** Finds `name` (with arity) directly inside a namespace or type. */
export function lookupMemberOfContainer(container,name,arity=0){
  if(container.kind===SymbolKind.Namespace){
    const types=container.getTypeMembers(name,arity);if(types.length===1)return {symbol:types[0]};// A declaration in the compilation hides a same-named type from a reference; two references conflict (CS0433).
    if(types.length>1){const own=types.filter(t=>t.containingNamespace?.extent==='source');if(own.length===1)return {symbol:own[0]};return {error:{code:DiagnosticId.CS0433,args:[types[0].containingNamespace?.module?.name??'',types[0].toDisplayString(),types[1].containingNamespace?.module?.name??'']},candidates:types,symbol:types[0]};}
    const namespace=arity===0?container.getNamespace(name):null;if(namespace)return {symbol:namespace};
    const other=container.getTypeMembers(name);if(other.length)return {error:other[0].arity?{code:DiagnosticId.CS0305,args:[other[0].toDisplayString(),'type',other[0].arity]}:{code:DiagnosticId.CS0308,args:[other[0].toDisplayString(),'type']},candidates:other};
    return {error:container.isGlobalNamespace?{code:DiagnosticId.CS0400,args:[name]}:{code:DiagnosticId.CS0234,args:[name,container.toDisplayString()]},candidates:[]};
  }
  for(let t=container;t;t=t.baseType){const nested=t.getTypeMembers?.(name,arity)??[];if(nested.length)return {symbol:nested[0]};}
  return {error:{code:DiagnosticId.CS0426,args:[name,container.toDisplayString()]},candidates:[]};
}
/**
 * Binds parsed (or textual) type-name syntax to a namespace or type symbol.
 * @param binder the scope to look names up in.
 * @param {object} context `types`: a TypeProvider for keyword types; `globalNamespace`: the root for `global::`;
 *   `report(node,code,args)`; `node`: where to report.
 * @returns {{symbol,error?}} the namespace or type; on failure `symbol` is an ErrorTypeSymbol and `error` the diagnostic.
 */
export function bindNamespaceOrType(binder,syntax,context={}){
  const parsed=typeof syntax==='string'?parseTypeName(syntax):syntax,fail=(error,name,candidates=[])=>{context.report?.(context.node??null,error.code,error.args);return {symbol:new ErrorTypeSymbol(name,0,{candidates,reason:error}),error};};
  if(!parsed)return fail({code:DiagnosticId.CS1031,args:[]},String(syntax));
  const text=parsed.segments.map(s=>s.name).join('.'),first=parsed.segments[0];let current;
  const typeArguments=segment=>segment.typeArguments.map(a=>bindType(binder,a,context));
  if(parsed.alias==='global')current={symbol:context.globalNamespace??binder.compilation?.globalNamespace};
  else if(parsed.alias){const alias=binder.lookup(parsed.alias,0,LookupOptions.NamespacesAndTypesOnly).symbols.find(s=>s.kind===SymbolKind.Alias);if(!alias)return fail({code:DiagnosticId.CS0432,args:[parsed.alias]},text);if(alias.target.kind!==SymbolKind.Namespace)return fail({code:DiagnosticId.CS0431,args:[parsed.alias]},text);current={symbol:alias.target};}
  let index=0;
  if(!current){
    const keyword=parsed.segments.length===1&&!first.typeArguments.length?specialTypeFromKeyword(first.name):null;
    if(keyword&&context.types)return {symbol:context.types.getCoreType(keyword,context.node??null)};
    current=lookupSimpleName(binder,first.name,first.typeArguments.length);if(current.error)return fail(current.error,text,current.candidates);
    if(first.typeArguments.length)current={symbol:current.symbol.construct(typeArguments(first))};index=1;
  }
  for(;index<parsed.segments.length;index++){
    const segment=parsed.segments[index],next=lookupMemberOfContainer(current.symbol,segment.name,segment.typeArguments.length);if(next.error&&!next.symbol)return fail(next.error,text,next.candidates);if(next.error)context.report?.(context.node??null,next.error.code,next.error.args);
    current={symbol:segment.typeArguments.length?next.symbol.construct(typeArguments(segment)):next.symbol};
  }
  return current;
}
/** Binds type-name syntax to a TypeSymbol; a namespace in a type position reports CS0118. Never returns null. */
export function bindType(binder,syntax,context={}){
  const parsed=typeof syntax==='string'?parseTypeName(syntax):syntax,bound=bindNamespaceOrType(binder,parsed??syntax,context);let type=bound.symbol;
  if(type.kind===SymbolKind.Namespace){const error={code:DiagnosticId.CS0118,args:[type.toDisplayString(),'namespace','type']};context.report?.(context.node??null,error.code,error.args);type=new ErrorTypeSymbol(type.name,0,{reason:error});}
  if(parsed?.nullable&&type.isValueType&&context.types){const nullable=context.types.getCoreTypeQuiet('System_Nullable_T');if(!nullable.isErrorType())type=nullable.construct(type);}
  // Rank specifiers are written outermost first: int[][,] is an array of int[,].
  for(const rank of [...(parsed?.ranks??[])].reverse())type=new ArrayTypeSymbol(type,rank);
  return type;
}
