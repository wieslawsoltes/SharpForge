import {DiagnosticId} from '../diagnostics/codes.js';
import {SymbolKind} from '../symbols/types.js';
import {AliasSymbol} from '../symbols/namespaces.js';
/**
 * Using directives: collection from a parsed file and binding to namespaces, static types and aliases.
 *
 * `collectUsingDirectives` reads the UsingDirective nodes of the lossless syntax tree (`file.syntax`); a file parsed
 * without one falls back to the token stream. `bindUsings` resolves them against the
 * merged global namespace and reports CS0246/CS0234 (unknown namespace), CS0138 (using a type as a namespace),
 * CS7007 (using static on a namespace), CS0105 (duplicate using, a warning) and CS1537 (duplicate alias).
 */
const isWord=t=>t&&(t.kind==='identifier'||/^[a-z]+$/.test(t.kind)&&t.kind===t.text);
/** Reads `Name(.Name)*` starting at tokens[i]; returns {name,next} or null. */
function dottedName(tokens,i){
  if(tokens[i]?.kind!=='identifier')return null;let name=tokens[i].value??tokens[i].text,next=i+1;
  while(tokens[next]?.kind==='.'&&tokens[next+1]?.kind==='identifier'){name+='.'+(tokens[next+1].value??tokens[next+1].text);next+=2;}
  return {name,next};
}
/** Reads a type name with optional type arguments (for alias targets such as `List<int>`). */
function typeName(tokens,i){
  const head=dottedName(tokens,i)??(isWord(tokens[i])?{name:tokens[i].text,next:i+1}:null);if(!head)return null;let {name,next}=head;
  if(tokens[next]?.kind==='<'){let depth=0,text='';do{const t=tokens[next++];if(!t||t.kind==='eof'||t.kind===';')return null;depth+=t.kind==='<'?1:t.kind==='>'?-1:t.kind==='>>'?-2:0;text+=t.kind===','?', ':t.text;}while(depth>0);name+=text;}
  while(tokens[next]?.kind==='['&&tokens[next+1]?.kind===']'){name+='[]';next+=2;}
  return {name,next};
}
/**
 * The using directives of a parsed file, in source order:
 * `{kind:'namespace'|'static'|'alias', name, alias, isGlobal, namespace (enclosing namespace name), uri, start, end}`.
 */
export function collectUsingDirectives(file){
  const uri=file.source?.uri??file.root?.uri;
  if(Array.isArray(file.root?.usings))return file.root.usings.map(u=>({kind:u.alias?'alias':u.isStatic?'static':'namespace',name:u.name,alias:u.alias??null,isGlobal:!!u.isGlobal,namespace:u.namespace??'',uri:u.uri??uri,start:u.start,end:u.end}));
  if(file.syntax?.kind==='CompilationUnit')return usingDirectivesFromSyntax(file.syntax,uri);
  const tokens=file.tokens??[],result=[],scopes=[];let fileScoped='',pendingNamespace=null;
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(t.kind==='namespace'){const n=dottedName(tokens,i+1);if(n){if(tokens[n.next]?.kind===';')fileScoped=n.name;else pendingNamespace=n.name;i=n.next-1;}continue;}
    if(t.kind==='{'){scopes.push(pendingNamespace);pendingNamespace=null;continue;}
    if(t.kind==='}'){scopes.pop();continue;}
    if(t.kind!=='using'||scopes.some(s=>s===null))continue;
    // Directives only appear at compilation-unit or namespace level; `using (`, `using var x` and `using T x = ...` are statements.
    const isGlobal=tokens[i-1]?.kind==='identifier'&&tokens[i-1].text==='global',enclosing=[fileScoped,...scopes].filter(Boolean).join('.');let at=i+1,kind='namespace',alias=null;
    if(tokens[at]?.kind==='static'){kind='static';at++;}
    else if(tokens[at]?.kind==='identifier'&&tokens[at+1]?.kind==='='){kind='alias';alias=tokens[at].value??tokens[at].text;at+=2;}
    const target=kind==='namespace'?dottedName(tokens,at):typeName(tokens,at);if(!target||tokens[target.next]?.kind!==';')continue;
    result.push({kind,name:target.name,alias,isGlobal,namespace:enclosing,uri,start:(isGlobal?tokens[i-1]:t).start,end:tokens[target.next].end,nameStart:tokens[at].start,nameEnd:tokens[target.next-1].end});i=target.next;
  }
  return result;
}
const nameText=node=>node.toString().replace(/\s+/g,'').replace(/,/g,', ');
/** The using directives of a lossless syntax tree: compilation-unit level first, then each namespace declaration in source order. */
export function usingDirectivesFromSyntax(root,uri){
  const result=[];
  const visit=(container,namespace)=>{
    for(const u of container.usings??[]){
      const target=u.namespaceOrType,semicolon=u.semicolonToken;if(!target||target.containsDiagnostics||!semicolon||semicolon.isMissing)continue;
      const alias=u.alias?.name?.identifier?.valueText??null,kind=alias?'alias':u.staticKeyword?'static':'namespace',first=u.globalKeyword??u.usingKeyword;
      result.push({kind,name:nameText(target),alias,isGlobal:!!u.globalKeyword,namespace,uri,start:first.spanStart,end:semicolon.span.end,nameStart:target.spanStart,nameEnd:target.span.end,syntax:u});
    }
    for(const member of container.members??[])if(member.kind==='NamespaceDeclaration'||member.kind==='FileScopedNamespaceDeclaration')visit(member,(namespace?namespace+'.':'')+nameText(member.name));
  };
  visit(root,'');return result.sort((a,b)=>a.start-b.start);
}
/** Resolves a dotted name from the global namespace; returns {symbol} or {error:{code,args}}. */
export function resolveQualifiedName(globalNamespace,name){
  const parts=String(name).split('.');let current=globalNamespace;
  for(let i=0;i<parts.length;i++){
    const simple=parts[i];let next=null;
    if(current.kind===SymbolKind.Namespace)next=current.getNamespace(simple)??current.getTypeMembers(simple)[0]??null;else next=current.getTypeMembers(simple)[0]??null;
    if(!next)return {error:i===0?{code:DiagnosticId.CS0246,args:[simple]}:current.kind===SymbolKind.Namespace?{code:DiagnosticId.CS0234,args:[simple,current.toDisplayString()]}:{code:DiagnosticId.CS0426,args:[simple,current.toDisplayString()]}};
    current=next;
  }
  return {symbol:current};
}
/**
 * Binds directives to `{aliases:Map<name,AliasSymbol>, namespaces:[NamespaceSymbol], staticTypes:[NamedTypeSymbol], directives}`.
 * @param {object} context `globalNamespace`; `report(node,code,args)`; `bindType(text,directive)` resolves alias/static targets
 *   that are not plain dotted names (keywords, generics); `reportMissing` (default true) controls CS0246/CS0234 for
 *   namespaces that do not exist - the closed framework profile passes false because its registry is not exhaustive.
 */
export function bindUsings(directives,{globalNamespace,report=()=>{},bindType=null,reportMissing=true}){
  const usings={aliases:new Map(),namespaces:[],staticTypes:[],directives:[]},seen=new Set();
  for(const d of directives){
    const node={uri:d.uri,start:d.nameStart??d.start,end:d.nameEnd??d.end},whole={uri:d.uri,start:d.start,end:d.end},plain=!/[<\[?]/.test(d.name),resolved=plain?resolveQualifiedName(globalNamespace,d.name):{};let target=resolved.symbol??null;
    if(!target&&d.kind!=='namespace'&&bindType)target=bindType(d.name,d);
    if(d.kind==='alias'){
      if(usings.aliases.has(d.alias)){report(node,DiagnosticId.CS1537,[d.alias]);continue;}
      if(!target||target.typeKind==='error'){if(reportMissing&&resolved.error)report(node,resolved.error.code,resolved.error.args);continue;}
      usings.aliases.set(d.alias,new AliasSymbol(d.alias,target,{isGlobal:d.isGlobal,syntax:whole,locations:[whole]}));usings.directives.push({...d,target});continue;
    }
    if(!target||target.typeKind==='error'){if(reportMissing&&resolved.error)report(node,resolved.error.code,resolved.error.args);continue;}
    const key=d.kind+':'+d.name;if(seen.has(key)){report(node,DiagnosticId.CS0105,[d.name]);continue;}seen.add(key);
    if(d.kind==='static'){if(target.kind===SymbolKind.Namespace){report(node,DiagnosticId.CS7007,[target.toDisplayString()]);continue;}usings.staticTypes.push(target);}
    else{if(target.kind!==SymbolKind.Namespace){report(node,DiagnosticId.CS0138,[target.toDisplayString()]);continue;}usings.namespaces.push(target);}
    usings.directives.push({...d,target});
  }
  return usings;
}
/** An empty using set. */
export const noUsings=()=>({aliases:new Map(),namespaces:[],staticTypes:[],directives:[]});
