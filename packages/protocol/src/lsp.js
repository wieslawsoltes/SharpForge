import {renameWorkspaceEdit,prepareRename,workspaceSymbols} from './lsp-source.js';
import { RefactoringEngine, formatDocument, foldingRanges, selectionRanges } from '@sharpforge/refactoring';
import { Workspace } from '@sharpforge/workspace';
import { LanguageService } from '@sharpforge/language';
import { tokenTypes, symbolKinds, isRequestObject, invalidRequest } from './lsp-wire.js';
/** Transport-independent LSP 3.17 subset. Feed JSON-RPC messages; send emitted notifications on your transport. */
export class LanguageServer {
  constructor({workspace=new Workspace(),send=()=>{}}={}){this.workspace=workspace;this.language=new LanguageService(workspace);this.refactoring=new RefactoringEngine(workspace,this.language);this.send=send;this.shutdown=false;}
  source(uri){const s=(this.workspace.documents.get(uri)??this.workspace.generatedDocuments?.get(uri))?.source;if(!s)throw new Error('Document is not open');return s;}
  offset(params){return this.source(params.textDocument.uri).offsetAt(params.position);}
  location(r){const s=this.source(r.uri);return {uri:r.uri,range:{start:s.positionAt(r.start),end:s.positionAt(r.end)}};}
  callItem(item){return {name:item.name,kind:6,detail:item.owner??'',uri:item.uri,range:this.location(item).range,selectionRange:this.location({...item,start:item.selectionStart,end:item.selectionEnd}).range,data:item};}
  publish(){const r=this.workspace.compile();for(const [uri,d]of this.workspace.documents)this.send({jsonrpc:'2.0',method:'textDocument/publishDiagnostics',params:{uri,version:d.source.version,diagnostics:r.diagnostics.filter(x=>x.uri===uri).map(x=>({range:x.range,severity:({error:1,warning:2,info:3,hint:4}[x.severity]??2),code:x.code,source:'SharpForge',message:x.message}))}});}
  async handle(message){
    if (!isRequestObject(message)) return invalidRequest();
    const {id,method,params:p={}}=message;let result=null;
    try{
      if(this.shutdown&&method!=='exit')return id===undefined?null:{jsonrpc:'2.0',id,error:{code:-32600,message:'The language server has shut down'}};
      switch(method){
        case 'initialize':this.documentChanges=!!p.capabilities?.workspace?.workspaceEdit?.documentChanges;result={serverInfo:{name:'SharpForge Language Server',version:'0.6.0'},capabilities:{positionEncoding:'utf-16',textDocumentSync:2,completionProvider:{triggerCharacters:['.']},hoverProvider:true,definitionProvider:true,referencesProvider:true,renameProvider:{prepareProvider:true},documentHighlightProvider:true,workspaceSymbolProvider:true,foldingRangeProvider:true,selectionRangeProvider:true,documentFormattingProvider:true,codeActionProvider:{codeActionKinds:['refactor.rewrite','refactor.extract','refactor.inline']},inlayHintProvider:true,documentSymbolProvider:true,callHierarchyProvider:true,codeLensProvider:{resolveProvider:false},signatureHelpProvider:{triggerCharacters:['(',',']},semanticTokensProvider:{legend:{tokenTypes,tokenModifiers:[]},full:true}}};break;
        case 'initialized':break;
        case 'shutdown':this.shutdown=true;break;case 'exit':break;
        case 'textDocument/didOpen':this.workspace.update(p.textDocument.uri,p.textDocument.text,p.textDocument.version);this.publish();break;
        case 'textDocument/didChange':this.workspace.change(p.textDocument.uri,p.contentChanges,p.textDocument.version);this.publish();break;
        case 'textDocument/didClose':this.workspace.remove(p.textDocument.uri);this.send({jsonrpc:'2.0',method:'textDocument/publishDiagnostics',params:{uri:p.textDocument.uri,diagnostics:[]}});if(this.workspace.documents.size)this.publish();break;
        case 'textDocument/completion':result={isIncomplete:false,items:this.language.completions(p.textDocument.uri,this.offset(p)).map(i=>({...i,kind:{method:2,field:5,property:10,class:7,local:6,keyword:14}[i.kind]??6}))};break;
        case 'textDocument/hover':{const h=this.language.hover(p.textDocument.uri,this.offset(p));result=h?{contents:{kind:'markdown',value:'```csharp\n'+h.contents+'\n```'}}:null;break;}
        case 'textDocument/definition':{const d=this.language.definition(p.textDocument.uri,this.offset(p));result=d?this.location(d):null;break;}
        case 'textDocument/references':result=this.language.references(p.textDocument.uri,this.offset(p),p.context?.includeDeclaration!==false).map(r=>this.location(r));break;
        case 'textDocument/rename':result=renameWorkspaceEdit(this,p);break;
        case 'textDocument/prepareRename':result=prepareRename(this,p);break;
        case 'textDocument/documentHighlight':result=this.language.references(p.textDocument.uri,this.offset(p)).filter(r=>r.uri===p.textDocument.uri).map(r=>({range:this.location(r).range,kind:r.write?3:r.read?2:1}));break;
        case 'workspace/symbol':result=workspaceSymbols(this,p.query).map(s=>({name:s.name,kind:symbolKinds[s.kind]??13,location:this.location(s),containerName:s.ownerFullName??s.namespace??''}));break;
        case 'textDocument/foldingRange':result=foldingRanges(this.workspace,p.textDocument.uri);break;
        case 'textDocument/selectionRange':result=selectionRanges(this.workspace,p.textDocument.uri,p.positions.map(position=>this.source(p.textDocument.uri).offsetAt(position)));break;
        case 'textDocument/formatting':result=formatDocument(this.workspace,p.textDocument.uri,p.options).map(e=>({range:this.location(e).range,newText:e.newText}));break;
        case 'textDocument/codeAction':{const uri=p.textDocument.uri,source=this.source(uri);result=this.refactoring.actions(uri,source.offsetAt(p.range.start),source.offsetAt(p.range.end)).filter(a=>!p.context?.only||p.context.only.some(k=>a.kind===k||a.kind.startsWith(k+'.'))).map(action=>({title:action.title,kind:action.kind,edit:{documentChanges:[{textDocument:{uri,version:source.version},edits:action.edits.map(e=>({range:this.location(e).range,newText:e.newText}))}]}}));break;}
        case 'textDocument/inlayHint':{const uri=p.textDocument.uri,source=this.source(uri);result=this.language.inlayHints(uri,{start:source.offsetAt(p.range.start),end:source.offsetAt(p.range.end)});break;}
        case 'textDocument/prepareCallHierarchy':result=this.language.callHierarchy(p.textDocument.uri,this.offset(p)).map(item=>this.callItem(item));break;
        case 'callHierarchy/incomingCalls':result=this.language.calls(p.item.data,'incoming').map(c=>({from:this.callItem(c.item),fromRanges:c.ranges.map(r=>this.location(r).range)}));break;
        case 'callHierarchy/outgoingCalls':result=this.language.calls(p.item.data,'outgoing').map(c=>({to:this.callItem(c.item),fromRanges:c.ranges.map(r=>this.location(r).range)}));break;
        case 'textDocument/codeLens':result=this.language.referenceLenses(p.textDocument.uri).map(l=>({range:this.location(l).range,command:{title:`${l.count} reference${l.count===1?'':'s'}`,command:'sharpforge.showReferences',arguments:[l.uri,this.source(l.uri).positionAt(l.start),this.language.references(l.uri,l.start,false).map(r=>this.location(r))]}}));break;
        case 'textDocument/documentSymbol':result=this.language.documentSymbols(p.textDocument.uri).map(s=>({name:s.name,detail:s.detail,kind:symbolKinds[s.kind]??13,range:this.location(s).range,selectionRange:this.location(s).range}));break;
        case 'textDocument/signatureHelp':result=this.language.signatureHelp(p.textDocument.uri,this.offset(p));break;
        case 'textDocument/semanticTokens/full':{
          const source=this.source(p.textDocument.uri),tokens=this.language.semanticTokens(p.textDocument.uri),data=[];let previousLine=0,previousStart=0;
          for(const t of tokens){let at=t.start;while(at<t.end){const pos=source.positionAt(at),end=Math.min(t.end,(source.lineStarts[pos.line+1]??source.length));let length=end-at;while(length>0&&/[\r\n]/.test(source.text[at+length-1]))length--;if(length>0){const lineDelta=pos.line-previousLine;data.push(lineDelta,lineDelta===0?pos.character-previousStart:pos.character,length,Math.max(0,tokenTypes.indexOf(t.kind==='local'?'variable':t.kind)),0);previousLine=pos.line;previousStart=pos.character;}at=end;}}
          result={data};break;}
        case '$/cancelRequest':break; // Cooperative cancellation is enforced by the host before synchronous dispatch.
        default:if(id!==undefined)return {jsonrpc:'2.0',id,error:{code:-32601,message:`Method '${method}' is not implemented`}};
      }
      return id===undefined?null:{jsonrpc:'2.0',id,result};
    }catch(error){return id===undefined?null:{jsonrpc:'2.0',id,error:{code:-32602,message:error.message}};}
  }
}
