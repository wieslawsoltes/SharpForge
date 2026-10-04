import {sourceHover} from './hover.js';
import {boundInlayHints} from './inlay-hints.js';
import {boundSignatureHelp} from './signature-help.js';
import {withCSharpCommitCharacters} from './completion-rules.js';
import {sourceReferences, sourceReferenceLenses} from './source-queries.js';
import { findTextMatches } from '@sharpforge/text';
import { keywords } from '@sharpforge/syntax';
import {MetadataLanguageSession} from './metadata-session.js';
import {languageCompletions} from './completions.js';
import {symbolDetail, intrinsicDocs} from './symbol-details.js';
import {renameSource, renameSourceText, prepareSourceRename, prepareWorkspaceTypeRename} from './rename.js';
export class LanguageService {
  constructor(workspace){this.workspace=workspace;this.metadata=new MetadataLanguageSession(workspace);}
  reference(uri,offset){return this.workspace.sourceModel()?.referenceAt(uri,offset);}
  symbolAt(uri,offset){return this.metadata.symbolAt(uri,offset)??this.workspace.sourceModel()?.symbolAt(uri,offset);}
  completions(uri,offset){return languageCompletions(this,uri,offset);}
  unique(items){return [...new Map(items.map(i=>[i.label,i])).values()].map(withCSharpCommitCharacters);}
  hover(uri,offset){
    const metadata = this.metadata.symbolAt(uri,offset);
    if (metadata) return {contents:symbolDetail(metadata),start:metadata.start,end:metadata.end,symbol:metadata};
    return sourceHover(this,uri,offset,symbolDetail,intrinsicDocs);
  }
  definition(uri,offset){const symbol=this.symbolAt(uri,offset);return symbol&&!symbol.metadata?{uri:symbol.uri,start:symbol.start,end:symbol.end}:null;}
  references(uri,offset,includeDeclaration=true){return sourceReferences(this.workspace,uri,offset,includeDeclaration);}
  rename(uri,offset,newName,options={}){return renameSourceText(this.workspace,uri,offset,newName,options);}
  renamePlan(uri,offset,newName,options={}){return renameSource(this.workspace,uri,offset,newName,options);}
  prepareRename(uri,offset){return prepareSourceRename(this.workspace,uri,offset);}
  prepareTypeRename(uri,offset,newName,options={}){return prepareWorkspaceTypeRename(this.workspace,uri,offset,newName,options);}
  findInFiles(query,options={}){return findTextMatches([...this.workspace.documents.values()].map(d=>d.source),query,options);}
  callHierarchy(uri,offset){const symbol=this.symbolAt(uri,offset);return symbol?.kind==='method'?[this.callItem(symbol)]:[];}
  callItem(symbol){return {...symbol,start:symbol.bodyStart??symbol.start,end:symbol.bodyEnd??symbol.end,selectionStart:symbol.start,selectionEnd:symbol.end,revision:this.workspace.revision};}
  calls(item,direction='incoming'){
    if(item.revision!==this.workspace.revision)throw new Error('Call hierarchy is stale; prepare it again');
    const result=this.workspace.compile(),symbol=result.symbols.find(s=>s.id===item.id&&s.kind==='method');if(!symbol)return [];
    const groups=new Map();for(const reference of result.references){if(!reference.call)continue;const match=direction==='incoming'?reference.symbolId===symbol.id:reference.callerId===symbol.id;if(!match)continue;const id=direction==='incoming'?reference.callerId:reference.symbolId,target=result.symbols.find(s=>s.id===id&&s.kind==='method');if(!target)continue;if(!groups.has(id))groups.set(id,{item:this.callItem(target),ranges:[]});groups.get(id).ranges.push({uri:reference.uri,start:reference.start,end:reference.end});}return [...groups.values()];
  }
  referenceLenses(uri){return sourceReferenceLenses(this.workspace,uri);}
  documentSymbols(uri){return (this.workspace.sourceModel()?.documentSymbols(uri)??[]).map(s=>({...s,detail:symbolDetail(s)}));}
  signatureHelp(uri,offset,options){return boundSignatureHelp(this.workspace,uri,offset,options);}
  inlayHints(uri,range){return boundInlayHints(this.workspace,uri,range);}
  diagnostics(uri){return this.metadata.diagnostics(uri)??this.workspace.compile().diagnostics.filter(d=>d.uri===uri);}
  semanticTokens(uri){const syntax=this.workspace.syntax(uri),result=this.workspace.compile(),refMap=new Map(result.references.filter(r=>r.uri===uri).map(r=>[r.start,r])),symbolMap=new Map(result.symbols.map(s=>[s.id,s]));return syntax.tokens.filter(t=>t.kind!=='eof').map(t=>{const symbol=symbolMap.get(refMap.get(t.start)?.symbolId);const kind=symbol?symbol.kind:['string','char'].includes(t.kind)?'string':['integer','double'].includes(t.kind)?'number':keywords.has(t.kind)?'keyword':t.kind==='identifier'?'variable':'operator';return {start:t.start,end:t.end,kind};});}
}
