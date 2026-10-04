import {frameworkType} from '@sharpforge/framework';
import { findTextMatches } from '@sharpforge/text';
import { keywords } from '@sharpforge/syntax';
import {MetadataLanguageSession} from './metadata-session.js';
import {languageCompletions} from './completions.js';
import {symbolDetail, intrinsicDocs} from './symbol-details.js';
import {renameLanguageSymbol, prepareWorkspaceTypeRename} from './rename.js';
export class LanguageService {
  constructor(workspace){this.workspace=workspace;this.metadata=new MetadataLanguageSession(workspace);}
  reference(uri,offset){const result=this.workspace.compile();return result.references.filter(r=>r.uri===uri&&offset>=r.start&&offset<=r.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];}
  symbolAt(uri,offset){const metadata=this.metadata.symbolAt(uri,offset);if(metadata)return metadata;const ref=this.reference(uri,offset);return ref?this.workspace.compile().symbols.find(s=>s.id===ref.symbolId):null;}
  completions(uri,offset){return languageCompletions(this,uri,offset);}
  unique(items){return [...new Map(items.map(i=>[i.label,i])).values()];}
  hover(uri,offset){const symbol=this.symbolAt(uri,offset);if(symbol&&!symbol.name.startsWith("<"))return {contents:symbolDetail(symbol),start:symbol.start,end:symbol.end,symbol};const token=this.workspace.syntax(uri).tokens.find(t=>offset>=t.start&&offset<=t.end);if(token){const t=frameworkType(token.text);if(t)return {contents:t.name+' · managed web framework ('+t.kind+')',start:token.start,end:token.end};const completion=this.completions(uri,token.end).find(i=>i.label===token.text);if(completion&&completion.kind!=='keyword')return {contents:completion.detail,start:token.start,end:token.end};}if(token&&intrinsicDocs[token.text])return {contents:intrinsicDocs[token.text],start:token.start,end:token.end};const d=this.workspace.compile().diagnostics.find(d=>d.uri===uri&&offset>=d.start&&offset<=d.start+d.length);return d?{contents:`${d.code}: ${d.message}`,start:d.start,end:d.start+d.length}:null;}
  definition(uri,offset){const symbol=this.symbolAt(uri,offset);return symbol&&!symbol.metadata?{uri:symbol.uri,start:symbol.start,end:symbol.end}:null;}
  references(uri,offset,includeDeclaration=true){const ref=this.reference(uri,offset);if(!ref)return [];return this.workspace.compile().references.filter(r=>r.symbolId===ref.symbolId&&(includeDeclaration||!r.declaration)).map(r=>({uri:r.uri,start:r.start,end:r.end}));}
  rename(uri,offset,newName){return renameLanguageSymbol(this,uri,offset,newName);}
  prepareTypeRename(uri,offset,newName,options={}){return prepareWorkspaceTypeRename(this.workspace,uri,offset,newName,options);}
  findInFiles(query,options={}){return findTextMatches([...this.workspace.documents.values()].map(d=>d.source),query,options);}
  callHierarchy(uri,offset){const symbol=this.symbolAt(uri,offset);return symbol?.kind==='method'?[this.callItem(symbol)]:[];}
  callItem(symbol){return {...symbol,start:symbol.bodyStart??symbol.start,end:symbol.bodyEnd??symbol.end,selectionStart:symbol.start,selectionEnd:symbol.end,revision:this.workspace.revision};}
  calls(item,direction='incoming'){
    if(item.revision!==this.workspace.revision)throw new Error('Call hierarchy is stale; prepare it again');
    const result=this.workspace.compile(),symbol=result.symbols.find(s=>s.id===item.id&&s.kind==='method');if(!symbol)return [];
    const groups=new Map();for(const reference of result.references){if(!reference.call)continue;const match=direction==='incoming'?reference.symbolId===symbol.id:reference.callerId===symbol.id;if(!match)continue;const id=direction==='incoming'?reference.callerId:reference.symbolId,target=result.symbols.find(s=>s.id===id&&s.kind==='method');if(!target)continue;if(!groups.has(id))groups.set(id,{item:this.callItem(target),ranges:[]});groups.get(id).ranges.push({uri:reference.uri,start:reference.start,end:reference.end});}return [...groups.values()];
  }
  referenceLenses(uri){const result=this.workspace.compile(),counts=new Map();for(const reference of result.references)if(!reference.declaration)counts.set(reference.symbolId,(counts.get(reference.symbolId)??0)+1);return this.documentSymbols(uri).filter(s=>s.kind==='method'||s.kind==='field'||s.kind==='property').map(s=>({uri,start:s.start,end:s.end,symbolId:s.id,count:counts.get(s.id)??0}));}
  documentSymbols(uri){return this.workspace.compile().symbols.filter(s=>s.uri===uri&&s.kind!=='local'&&!s.name.startsWith('<')).map(s=>({...s,detail:symbolDetail(s)}));}
  signatureHelp(uri,offset){const text=this.workspace.documents.get(uri)?.source.text.slice(0,offset)??'',match=text.match(/([\w.]+)\(([^()]*)$/);if(!match)return null;const name=match[1],index=match[2].split(',').length-1,result=this.workspace.compile(),methods=result.symbols.filter(s=>s.kind==='method'&&(s.name===name||s.owner+'.'+s.name===name));return {activeParameter:index,signatures:methods.map(s=>({label:symbolDetail(s),parameters:(s.parameters??[]).map(p=>({label:p.type+' '+p.name}))}))};}
  diagnostics(uri){return this.metadata.diagnostics(uri)??this.workspace.compile().diagnostics.filter(d=>d.uri===uri);}
  semanticTokens(uri){const syntax=this.workspace.syntax(uri),result=this.workspace.compile(),refMap=new Map(result.references.filter(r=>r.uri===uri).map(r=>[r.start,r])),symbolMap=new Map(result.symbols.map(s=>[s.id,s]));return syntax.tokens.filter(t=>t.kind!=='eof').map(t=>{const symbol=symbolMap.get(refMap.get(t.start)?.symbolId);const kind=symbol?symbol.kind:['string','char'].includes(t.kind)?'string':['integer','double'].includes(t.kind)?'number':keywords.has(t.kind)?'keyword':t.kind==='identifier'?'variable':'operator';return {start:t.start,end:t.end,kind};});}
}
