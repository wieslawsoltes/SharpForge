import {structuralActions} from './structural.js';
import {localTypeActions, fixAll} from './fix-all.js';
import {validateRefactoring} from './validate-plan.js';
import {outlineReorder} from './outline-reorder.js';
export {outlineReorder} from './outline-reorder.js';
export {fixAll} from './fix-all.js';
import { findTextMatches } from '@sharpforge/text';
import { keywords } from '@sharpforge/syntax';
function nodes(root){const result=[],stack=[root];while(stack.length){const n=stack.pop();if(!n||typeof n!=='object')continue;if(n.kind)result.push(n);for(const [key,v]of Object.entries(n))if(!['tokens','source','green'].includes(key)){if(Array.isArray(v))stack.push(...v.filter(x=>x&&typeof x==='object'));else if(v&&typeof v==='object')stack.push(v);}}return result;}
function prepared(workspace,edits){const grouped=new Map();for(const edit of edits){const document=workspace.documents.get(edit.uri);if(!document)throw new Error('Cannot edit a missing or generated document');if(edit.version!==document.source.version)throw new Error(`Stale edit for ${edit.uri}`);if(!Number.isInteger(edit.start)||!Number.isInteger(edit.end)||edit.start<0||edit.end<edit.start||edit.end>document.source.length||typeof edit.newText!=='string')throw new RangeError('Invalid edit span');if(!grouped.has(edit.uri))grouped.set(edit.uri,[]);grouped.get(edit.uri).push(edit);}const changes=[];for(const [uri,list]of grouped){list.sort((a,b)=>a.start-b.start||a.end-b.end);for(let i=1;i<list.length;i++)if(list[i].start<list[i-1].end||list[i].start===list[i-1].start)throw new Error('Overlapping edits are not allowed');const source=workspace.documents.get(uri).source;let at=0;const pieces=[];for(const e of list){pieces.push(source.text.slice(at,e.start),e.newText);at=e.end;}pieces.push(source.text.slice(at));let text=pieces.join('');if(text.length>workspace.maxDocumentLength)throw new RangeError('Edited document exceeds the source size limit');changes.push({uri,text,version:source.version+1,previous:source.text});}return changes;}
export function applyWorkspaceEdits(workspace,edits,{validate=true}={}){const changes=prepared(workspace,edits);if(validate&&changes.length){const candidate=new workspace.constructor({maxDocumentLength:workspace.maxDocumentLength,maxDocuments:workspace.maxDocuments,compilationOptions:workspace.compilationOptions,extensions:workspace.extensions,extensionOptions:workspace.extensionOptions,additionalFiles:workspace.additionalFiles});for(const [uri,d]of workspace.documents)candidate.update(uri,changes.find(c=>c.uri===uri)?.text??d.source.text,d.source.version+1);const before=workspace.compile(),after=candidate.compile();if(before.success&&!after.success)throw new Error('Refactoring would introduce compilation errors: '+after.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('; '));}for(const change of changes)workspace.update(change.uri,change.text,change.version);return {changes,revision:workspace.revision};}
/** Whitespace-only line indentation; token text and comment contents are never rewritten. */
export function formatDocument(workspace,uri,{tabSize=4,insertSpaces=true}={}){if(!Number.isInteger(tabSize)||tabSize<1||tabSize>16)throw new RangeError('tabSize must be between 1 and 16');const document=workspace.documents.get(uri);if(!document)throw new Error('Cannot format a generated or missing document');const source=document.source,tokens=workspace.syntax(uri).tokens,edits=[];let depth=0,lastLine=-1;const unit=insertSpaces?' '.repeat(tabSize):'\t';for(const token of tokens){if(token.kind==='eof')continue;const position=source.positionAt(token.start);if(position.line!==lastLine){const lineStart=source.lineStarts[position.line],prefix=source.text.slice(lineStart,token.start);if(/^[ \t]*$/.test(prefix)){const text=unit.repeat(Math.max(0,depth-(token.kind==='}'?1:0)));if(prefix!==text)edits.push({uri,start:lineStart,end:token.start,newText:text,version:source.version});}lastLine=position.line;}if(token.kind==='{')depth++;if(token.kind==='}')depth=Math.max(0,depth-1);}return edits;}
export class RefactoringEngine {
  constructor(workspace,language){this.workspace=workspace;this.language=language;}
  replaceAll(query,replacement,options={}){if(typeof replacement!=='string'||replacement.length>100000)throw new RangeError('Replacement must be a string of at most 100000 characters');const result=findTextMatches([...this.workspace.documents.values()].map(d=>d.source),query,{...options,maxMatches:10000});if(result.truncated)throw new RangeError('Too many replacements; narrow the search');return {title:`Replace ${result.matches.length} occurrences across source files`,kind:'refactor.rewrite',edits:result.matches.map(m=>({uri:m.uri,start:m.start,end:m.end,version:m.version,newText:replacement}))};}
  version(edits){return edits.map(e=>({...e,version:this.workspace.documents.get(e.uri)?.source.version}));}
  rename(uri,offset,newName,options={}){
    if(!this.language)throw new Error('A bound language service is required for rename');
    const plan=this.language.renamePlan(uri,offset,newName,options);
    validateRefactoring(this.workspace,plan.edits,{rename:plan});
    return {title:`Rename to ${newName}`,kind:'refactor.rename',edits:plan.edits,resources:plan.resources};
  }
  fixAll(parameters){return fixAll(this.workspace,parameters);}
  outlineReorder(parameters){return outlineReorder(this.workspace,parameters);}
  validateEdits(edits,options={}){validateRefactoring(this.workspace,edits,options);return {valid:true,revision:this.workspace.revision};}
  actions(uri,start,end=start){
    if(!this.workspace.documents.has(uri))return [];
    const compilation=this.workspace.compile(),syntax=this.workspace.syntax(uri);
    return [...localTypeActions(this.workspace,uri,start,end),...structuralActions(this.workspace,uri,start,end,compilation,syntax)];
  }
  apply(action,options){
    if(!action||!Array.isArray(action.edits))throw new TypeError('A versioned action is required');
    if(action.resources?.length)throw new Error('Resource rename requires a workspace transaction host');
    return applyWorkspaceEdits(this.workspace,action.edits,options);
  }
}
export function foldingRanges(workspace,uri){const syntax=workspace.syntax(uri),source=syntax.source,stack=[],ranges=[];for(const t of syntax.tokens){if(t.kind==='{')stack.push(t);else if(t.kind==='}'&&stack.length){const begin=source.positionAt(stack.pop().start),end=source.positionAt(t.start);if(end.line>begin.line)ranges.push({startLine:begin.line,startCharacter:begin.character,endLine:end.line,endCharacter:end.character,kind:'region'});}}return ranges.sort((a,b)=>a.startLine-b.startLine||b.endLine-a.endLine);}
export function selectionRanges(workspace,uri,offsets){const syntax=workspace.syntax(uri),source=syntax.source,all=nodes(syntax.root).filter(n=>Number.isInteger(n.start)&&Number.isInteger(n.end));return offsets.map(offset=>{const spans=all.filter(n=>n.start<=offset&&n.end>=offset).concat(syntax.tokens.filter(t=>t.start<=offset&&t.end>=offset)).sort((a,b)=>(b.end-b.start)-(a.end-a.start));let parent=null,last='';for(const span of spans){const key=`${span.start}:${span.end}`;if(key===last)continue;if(parent){const outerStart=source.offsetAt(parent.range.start),outerEnd=source.offsetAt(parent.range.end);if(span.start<outerStart||span.end>outerEnd)continue;}parent={range:{start:source.positionAt(span.start),end:source.positionAt(span.end)},...(parent?{parent}:{})};last=key;}return parent??{range:{start:source.positionAt(offset),end:source.positionAt(offset)}};});}
