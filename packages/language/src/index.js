import {sourceHover} from './hover.js';
import {boundInlayHints} from './inlay-hints.js';
import {boundSignatureHelp} from './signature-help.js';
import {withCSharpCommitCharacters} from './completion-rules.js';
import {renameSource, renameSourceText, prepareSourceRename, prepareWorkspaceTypeRename} from './rename.js';
import {sourceReferences, sourceReferenceLenses, sourceCalls, findSourceText, sourceSymbolDetail as symbolDetail} from './source-queries.js';
import {types as frameworkTypes,frameworkType,canonicalType,propertiesFor,eventsFor,findContracts,contracts} from '@sharpforge/framework';
import { keywords } from '@sharpforge/syntax';
import { Builtins } from '@sharpforge/bytecode';
const intrinsicDocs={Console:'Writes program output to the managed console.',Math:'Numeric functions in the supported runtime profile.',GC:'Controls the precise, non-generational managed collector.',Array:'Array helpers.',Convert:'Primitive conversion helpers.',Debug:'Runtime assertions.'};
export class LanguageService {
  constructor(workspace){this.workspace=workspace;}
  reference(uri,offset){return this.workspace.sourceModel()?.referenceAt(uri,offset);}
  symbolAt(uri,offset){return this.workspace.sourceModel()?.symbolAt(uri,offset);}
  completions(uri,offset){
    const source=this.workspace.documents.get(uri)?.source;if(!source)return [];const result=this.workspace.compile(),before=source.text.slice(0,offset),member=before.match(/([\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*)\.([\p{L}\p{N}_]*)$/u);let items=[];
    if(member){const receiver=member[1].replace(/^System\./,''),prefix=member[2],symbols=result.symbols.filter(s=>s.uri===uri&&s.name===receiver&&s.start<=offset&&(s.scopeEnd??Infinity)>=offset),local=symbols.at(-1),type=local?.type??receiver;
      items=result.symbols.filter(s=>s.owner===type&&(s.kind==='method'||s.kind==='field'||s.kind==='property')&&(!local?s.isStatic:!s.isStatic)).map(s=>({label:s.name,kind:s.kind,detail:symbolDetail(s),insertText:s.name}));
      const external=frameworkType(type);if(external){for(const [label,p]of Object.entries(propertiesFor(external.name)))if(!!p.isStatic===!local)items.push({label,kind:'property',detail:`${p.type} ${label}${p.readOnly?' { get; }':' { get; set; }'}`,insertText:label});if(local)for(const [label,delegate]of Object.entries(eventsFor(external.name)))items.push({label,kind:'event',detail:`event ${delegate} ${label}`,insertText:label});const seen=new Set();let owner=external;while(owner&&!seen.has(owner.name)){seen.add(owner.name);for(const c of contracts.filter(c=>c.owner===owner.name&&c.kind==='method'&&c.isStatic===!local))items.push({label:c.name,kind:'method',detail:`${c.result} ${c.name}(${c.parameters.join(', ')})`,insertText:c.name});owner=frameworkType(owner.base);}}
      for(const builtin of Builtins.filter(b=>b.name.startsWith(type+'.')))items.push({label:builtin.name.slice(type.length+1),kind:'method',detail:`${builtin.result} ${builtin.name}(…)`,insertText:builtin.name.slice(type.length+1)});
      if(type==='string'||type.endsWith('[]'))items.push({label:'Length',kind:'property',detail:'int Length',insertText:'Length'});
      if(local)items.push({label:'ToString',kind:'method',detail:'string ToString()',insertText:'ToString'});
      return this.unique(items).filter(i=>i.label.toLowerCase().startsWith(prefix.toLowerCase()));
    }
    const prefix=before.match(/[\p{L}_][\p{L}\p{N}_]*$/u)?.[0]??'';
    items=result.symbols.filter(s=>!s.name?.startsWith('<')&&(s.kind!=='local'||s.uri===uri&&s.start<=offset&&(s.scopeEnd??Infinity)>=offset)).map(s=>({label:s.name,kind:s.kind,detail:symbolDetail(s),insertText:s.name}));
    for(const t of frameworkTypes.values())if(!t.name.startsWith('SharpForge.Runtime.')&&!t.name.includes('`')){const label=t.name.split('.').at(-1);items.push({label,kind:t.kind==='enum'?'enum':'class',detail:t.name+' · supported web framework API',insertText:label});}
    for(const [label,detail]of Object.entries(intrinsicDocs))items.push({label,kind:'class',detail,insertText:label});for(const word of keywords)items.push({label:word,kind:'keyword',detail:'C# keyword (some syntax is outside the executable profile)',insertText:word});
    return this.unique(items).filter(i=>i.label.toLowerCase().startsWith(prefix.toLowerCase())).sort((a,b)=>a.kind==='keyword'?1:b.kind==='keyword'?-1:a.label.localeCompare(b.label)).slice(0,100);
  }
  unique(items){return [...new Map(items.map(i=>[i.label,i])).values()].map(withCSharpCommitCharacters);}
  hover(uri,offset){return sourceHover(this,uri,offset,symbolDetail,intrinsicDocs);}
  definition(uri,offset){const symbol=this.symbolAt(uri,offset);return symbol?{uri:symbol.uri,start:symbol.start,end:symbol.end}:null;}
  references(uri,offset,includeDeclaration=true){return sourceReferences(this.workspace,uri,offset,includeDeclaration);}
  rename(uri,offset,newName,options={}){return renameSourceText(this.workspace,uri,offset,newName,options);}
  renamePlan(uri,offset,newName,options={}){return renameSource(this.workspace,uri,offset,newName,options);}
  prepareRename(uri,offset){return prepareSourceRename(this.workspace,uri,offset);}
  prepareTypeRename(uri,offset,newName,options={}){return prepareWorkspaceTypeRename(this.workspace,uri,offset,newName,options);}
  findInFiles(query,options={}){return findSourceText(this.workspace,query,options);}
  callHierarchy(uri,offset){const symbol=this.symbolAt(uri,offset);return symbol?.kind==='method'?[this.callItem(symbol)]:[];}
  callItem(symbol){return {...symbol,start:symbol.bodyStart??symbol.start,end:symbol.bodyEnd??symbol.end,selectionStart:symbol.start,selectionEnd:symbol.end,revision:this.workspace.revision};}
  calls(item,direction='incoming'){return sourceCalls(this,item,direction);}
  referenceLenses(uri){return sourceReferenceLenses(this.workspace,uri);}
  documentSymbols(uri){return (this.workspace.sourceModel()?.documentSymbols(uri)??[]).map(s=>({...s,detail:symbolDetail(s)}));}
  signatureHelp(uri,offset,options){return boundSignatureHelp(this.workspace,uri,offset,options);}
  inlayHints(uri,range){return boundInlayHints(this.workspace,uri,range);}
  diagnostics(uri){return this.workspace.compile().diagnostics.filter(d=>d.uri===uri);}
  semanticTokens(uri){const syntax=this.workspace.syntax(uri),result=this.workspace.compile(),refMap=new Map(result.references.filter(r=>r.uri===uri).map(r=>[r.start,r])),symbolMap=new Map(result.symbols.map(s=>[s.id,s]));return syntax.tokens.filter(t=>t.kind!=='eof').map(t=>{const symbol=symbolMap.get(refMap.get(t.start)?.symbolId);const kind=symbol?symbol.kind:['string','char'].includes(t.kind)?'string':['integer','double'].includes(t.kind)?'number':keywords.has(t.kind)?'keyword':t.kind==='identifier'?'variable':'operator';return {start:t.start,end:t.end,kind};});}
}
