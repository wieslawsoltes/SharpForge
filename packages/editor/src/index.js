import {ClassicKeymapAdapter,EDITOR_KEYMAPS,handleVisualStudioKey} from './keymaps.js';
export {EDITOR_KEYMAPS} from './keymaps.js';
import {SyntaxHighlightIndex} from './highlight.js';
export {SyntaxHighlightIndex} from './highlight.js';
export {NavigationHistory} from './navigation.js';
import {bracketPairs,lexicalContext,replaceLiteral,duplicateLineBlock} from './operations.js';
export {bracketPairs,lexicalContext,replaceLiteral,duplicateLineBlock} from './operations.js';
import { SourceText, findTextMatches } from '@sharpforge/text';
import { lex, keywords } from '@sharpforge/syntax';
export const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
/** Dependency-free embeddable code editor. Browser text input + source-faithful highlighting overlay. */
export class CodeEditor {
  constructor(element,{onChange=()=>{},onCursor=()=>{},onBreakpoint=()=>{},onBreakpointEdit=()=>{},request=async()=>null,keymap='visual-studio',onKeymapState=()=>{}}={}){
    this.keymap='visual-studio';this.onKeymapState=onKeymapState;this.element=element;this.onChange=onChange;this.onCursor=onCursor;this.onBreakpoint=onBreakpoint;this.onBreakpointEdit=onBreakpointEdit;this.request=request;this.uri='';this.models=new Map();this.diagnostics=[];this.breakpoints=[];this.executionLine=null;this.executionPoint=null;this.selectedFrameLine=null;this.lineHeight=22;this.padding=14;this.history=[];this.future=[];this.lastEdit=0;this.previous='';this.completionId=0;this.hoverId=0;this.disposed=false;this.composing=false;
    element.classList.add('sf-editor');element.innerHTML=`<div class="sf-current-line"></div><div class="sf-execution-line" hidden></div><div class="sf-selected-frame-line" hidden></div><div class="sf-gutter" aria-label="Breakpoint gutter"></div><div class="sf-viewport"><pre class="sf-highlight" aria-hidden="true"></pre><textarea class="sf-input" aria-label="C# source editor" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" data-testid="code-editor"></textarea></div><div class="sf-completions hidden" role="listbox"></div><div class="sf-tooltip hidden" role="tooltip"></div><div class="sf-find hidden" role="search"><div class="sf-find-row"><input aria-label="Find in current file" placeholder="Find in current file"><label><input type="checkbox" data-match-case> Aa</label><label><input type="checkbox" data-whole-word> Word</label><button data-find="previous" title="Previous match (Shift+F3)">↑</button><button data-find="next" title="Next match (F3)">↓</button><button data-find="close" title="Close find">×</button></div><div class="sf-replace-row hidden"><input aria-label="Replace in current file" placeholder="Replace with"><button data-replace="one">Replace</button><button data-replace="all">Replace all</button></div><span class="sf-find-count" role="status" aria-live="polite"></span></div><div class="sf-goto hidden"><label>Go to line <input aria-label="Go to line" placeholder="line:column" inputmode="numeric"></label><span role="status"></span></div>`;
    this.input=element.querySelector('.sf-input');this.highlight=element.querySelector('.sf-highlight');this.gutter=element.querySelector('.sf-gutter');this.completion=element.querySelector('.sf-completions');this.tooltip=element.querySelector('.sf-tooltip');this.findBox=element.querySelector('.sf-find');
    this.input.addEventListener('compositionstart',()=>{this.composing=true;this.closeCompletion();});this.input.addEventListener('compositionend',()=>{this.composing=false;});this.input.addEventListener('input',()=>this.changed());this.input.addEventListener('scroll',()=>this.sync());this.input.addEventListener('keydown',e=>this.keydown(e));this.input.addEventListener('click',()=>{this.lastEdit=-Infinity;this.cursor();this.closeCompletion();});this.input.addEventListener('keyup',()=>this.cursor());this.input.addEventListener('select',()=>this.cursor());
    this.input.addEventListener('mousemove',e=>this.hover(e));this.input.addEventListener('mouseleave',()=>{this.hoverId++;clearTimeout(this.hoverTimer);this.tooltip.classList.add('hidden');});
    this.gutter.addEventListener('click',e=>{const row=e.target.closest('[data-line]');if(row)this.onBreakpoint(Number(row.dataset.line));});this.gutter.addEventListener('contextmenu',e=>{e.preventDefault();const row=e.target.closest('[data-line]');if(row)this.onBreakpointEdit(Number(row.dataset.line),e);});
    this.findBox.querySelector('[data-find="next"]').onclick=()=>this.findNext();this.findBox.querySelector('[data-find="previous"]').onclick=()=>this.findNext(false,-1);this.findBox.querySelector('[data-find="close"]').onclick=()=>{this.findBox.classList.add('hidden');this.input.focus();};
    this.findBox.querySelector('[aria-label="Find in current file"]').addEventListener('input',()=>this.findNext(true));for(const checkbox of this.findBox.querySelectorAll('[type=checkbox]'))checkbox.onchange=()=>this.findNext(true);
    this.findBox.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(e.target.getAttribute('aria-label')==='Replace in current file')this.replaceCurrent(e.ctrlKey||e.metaKey);else this.findNext(false,e.shiftKey?-1:1);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.findBox.classList.add('hidden');this.input.focus();}};
    this.findBox.querySelector('[data-replace="one"]').onclick=()=>this.replaceCurrent(false);this.findBox.querySelector('[data-replace="all"]').onclick=()=>this.replaceCurrent(true);
    this.gotoBox=element.querySelector('.sf-goto');this.gotoBox.onkeydown=e=>{if(e.key==='Escape'){this.gotoBox.classList.add('hidden');this.input.focus();}if(e.key==='Enter'){e.preventDefault();const m=/^(\d+)(?::(\d+))?$/.exec(e.target.value.trim());if(!m||+m[1]<1||+m[1]>this.sourceSnapshot().lineStarts.length||m[2]&&+m[2]<1){this.gotoBox.querySelector('span').textContent='Enter a valid line and optional column';return;}this.gotoBox.classList.add('hidden');this.gotoLine(+m[1],+(m[2]??1));}};
    this.resizeObserver=new ResizeObserver(()=>this.sync());this.resizeObserver.observe(element);this.setKeymap(keymap);
  }
  setKeymap(mode){if(!EDITOR_KEYMAPS.some(k=>k.id===mode))throw new Error('Unknown editor keymap');if(this.keymapAdapter){this.keymapAdapter.dispose();this.keymapAdapter=null;}this.keymap=mode;this.pendingChord=null;this.element.dataset.keymap=mode;if(['vim','emacs','sublime'].includes(mode))this.keymapAdapter=new ClassicKeymapAdapter(this,mode);this.onKeymapState({keymap:mode,mode:mode==='vim'?'normal':'editing'});}
  focus(){if(this.keymapAdapter)this.keymapAdapter.focus();else this.input.focus();}
  sourceSnapshot(){if(this.cachedSource?.text!==this.value||this.cachedSource?.uri!==this.uri)this.cachedSource=new SourceText(this.value,this.uri);return this.cachedSource;}
  get value(){return this.input.value;}
  get offset(){return this.input.selectionStart;}
  setModel(uri,text){
    if(this.uri)this.models.set(this.uri,{text:this.value,start:this.input.selectionStart,end:this.input.selectionEnd,scrollTop:this.input.scrollTop,scrollLeft:this.input.scrollLeft,history:this.history,future:this.future});
    this.hoverId++;clearTimeout(this.hoverTimer);this.tooltip.classList.add('hidden');this.uri=uri;const saved=this.models.get(uri);this.input.value=text;this.previous=text;this.history=saved?.text===text?saved.history:[];this.future=saved?.text===text?saved.future:[];
    this.input.setSelectionRange(saved?.text===text?saved.start:0,saved?.text===text?saved.end:0);this.input.scrollTop=saved?.scrollTop??0;this.input.scrollLeft=saved?.scrollLeft??0;this.diagnostics=[];this.closeCompletion();this.keymapAdapter?.setModel();this.paint();this.cursor();
  }
  setValue(text){this.record();this.input.value=text;this.changed(false);}
  setReadOnly(value){this.input.readOnly=value;this.keymapAdapter?.setReadOnly(value);for(const b of this.findBox.querySelectorAll('[data-replace]'))b.disabled=value;this.input.setAttribute('aria-readonly',String(value));}
  record(){this.history.push({text:this.previous,start:this.input.selectionStart,end:this.input.selectionEnd});if(this.history.length>200)this.history.shift();while(this.history.reduce((n,s)=>n+s.text.length,0)>4_000_000&&this.history.length>1)this.history.shift();this.future=[];}
  changed(record=true){
    // Chromium can deliver multiple insertText input events for one multiline
    // replacement, each already exposing the same final value. Publish a source
    // revision only once; otherwise a paste triggers O(lines) identical renders.
    const text=this.value;if(text===this.previous)return;
    const now=performance.now();if(record&&(now-this.lastEdit>450||!this.history.length))this.record();this.lastEdit=now;this.previous=this.value;this.keymapAdapter?.syncFromBridge();this.onChange(this.value);this.paint();this.cursor();if(!this.completion.classList.contains('hidden'))this.complete();}
  undo(redo=false){if(this.input.readOnly)return;if(this.keymapAdapter){this.keymapAdapter.undo(redo);return;}const from=redo?this.future:this.history,to=redo?this.history:this.future,item=from.pop();if(!item)return;to.push({text:this.value,start:this.input.selectionStart,end:this.input.selectionEnd});this.input.value=item.text;this.input.setSelectionRange(item.start,item.end);this.previous=this.value;this.lastEdit=0;this.onChange(this.value);this.paint();this.cursor();}
  insert(text,start=this.input.selectionStart,end=this.input.selectionEnd,caret=null){if(this.input.readOnly)return;this.record();this.input.setRangeText(text,start,end,'end');if(caret!==null)this.input.setSelectionRange(caret,caret);this.changed(false);}
  keydown(e){
    if(e.isComposing||this.composing||e.keyCode===229)return;
    if(handleVisualStudioKey(this,e))return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))this.lastEdit=-Infinity;
    if((e.ctrlKey||e.metaKey)&&e.key==='/'){e.preventDefault();this.toggleLineComment();return;}
    if(e.altKey&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();this.moveLines(e.key==='ArrowDown'?1:-1);return;}
    if(e.altKey&&e.shiftKey&&e.key.toLowerCase()==='h'){e.preventDefault();this.request('callHierarchy',{uri:this.uri,offset:this.offset});return;}
    if((e.ctrlKey||e.metaKey)&&e.key==='.') { e.preventDefault();if(!this.input.readOnly)this.request('codeActions',{uri:this.uri,offset:this.offset,end:this.input.selectionEnd});return; }
    if(e.shiftKey&&e.altKey&&e.key.toLowerCase()==='f') { e.preventDefault();if(!this.input.readOnly)this.request('format',{uri:this.uri});return; }

    const mod=e.ctrlKey||e.metaKey;
    if(mod&&e.altKey&&!e.shiftKey&&['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();if(e.key==='ArrowRight')this.expandSelection().catch(()=>{});else this.shrinkSelection();return;}
    if(!this.completion.classList.contains('hidden')){
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();this.completionIndex=(this.completionIndex+(e.key==='ArrowDown'?1:-1)+this.items.length)%this.items.length;this.paintCompletion();return;}
      if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();this.acceptCompletion();return;}if(e.key==='Escape'){e.preventDefault();this.closeCompletion();return;}
    }
    if(mod&&e.code==='Space'){e.preventDefault();this.complete();return;}
    if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();this.undo(e.shiftKey);return;}if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();this.undo(true);return;}
    if(mod&&!e.shiftKey&&['f','h'].includes(e.key.toLowerCase())){e.preventDefault();this.openFind(e.key.toLowerCase()==='h');return;}
    if(e.key==='F3'){e.preventDefault();this.findNext(false,e.shiftKey?-1:1);return;}
    if(mod&&e.key.toLowerCase()==='g'){e.preventDefault();this.gotoBox.classList.remove('hidden');this.gotoBox.querySelector('input').focus();return;}
    if(mod&&e.shiftKey&&e.code==='Backslash'){e.preventDefault();const at=this.pairs?.has(this.offset)?this.offset:this.offset-1,target=this.pairs?.get(at);if(target!==undefined)this.goto(target);return;}
    if(e.altKey&&e.shiftKey&&!mod&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(!this.input.readOnly){const result=duplicateLineBlock(this.value,this.offset,this.input.selectionEnd,e.key==='ArrowDown'?1:-1);this.setValue(result.text);this.input.setSelectionRange(result.start,result.end);this.cursor();}return;}

    if(e.key==='F12'){e.preventDefault();this.request(e.shiftKey?'references':'definition',{uri:this.uri,offset:this.offset});return;}
    if(e.key==='F2'){e.preventDefault();this.request('rename',{uri:this.uri,offset:this.offset});return;}
    if(this.input.readOnly)return;
    if(e.key==='Tab'){e.preventDefault();const start=this.input.selectionStart,end=this.input.selectionEnd;if(start===end&&!e.shiftKey)this.insert('    ');else{const lineStart=this.value.lastIndexOf('\n',start-1)+1,selection=this.value.slice(lineStart,end),replacement=selection.split('\n').map(s=>e.shiftKey?s.replace(/^ {1,4}/,''):'    '+s).join('\n');this.insert(replacement,lineStart,end);this.input.setSelectionRange(lineStart,lineStart+replacement.length);}return;}
    if(e.key==='Enter'){e.preventDefault();const start=this.offset,before=this.value.slice(0,start),line=before.slice(before.lastIndexOf('\n')+1),indent=line.match(/^\s*/)?.[0]??'',extra=line.trimEnd().endsWith('{')?'    ':'';if(extra&&this.value[start]==='}')this.insert('\n'+indent+extra+'\n'+indent,start,this.input.selectionEnd,start+1+indent.length+extra.length);else this.insert('\n'+indent+extra);return;}
    if(!mod&&['(','[','{'].includes(e.key)&&this.lexed&&lexicalContext(this.value,this.offset,this.lexed.tokens)==='code'){e.preventDefault();const closer={'(':')','[':']','{':'}'}[e.key],start=this.offset,selected=this.value.slice(start,this.input.selectionEnd);this.insert(e.key+selected+closer,start,this.input.selectionEnd,start+1+selected.length);return;}
    if(!mod&&[')',']','}'].includes(e.key)&&this.lexed&&lexicalContext(this.value,this.offset,this.lexed.tokens)==='code'&&this.value[this.offset]===e.key&&this.input.selectionStart===this.input.selectionEnd){e.preventDefault();this.input.setSelectionRange(this.offset+1,this.offset+1);return;}
    if(e.key==='Backspace'&&!mod&&this.offset===this.input.selectionEnd&&this.pairs?.get(this.offset-1)===this.offset){e.preventDefault();this.insert('',this.offset-1,this.offset+1);return;}
    if(e.key==='Escape'){this.gotoBox.classList.add('hidden');this.tooltip.classList.add('hidden');this.findBox.classList.add('hidden');}
    if(e.key==='.')setTimeout(()=>this.complete(),0);
  }
  segment(text,start,kind=''){if(!text)return '';const diagnostics=this.diagnostics.filter(d=>d.length>0&&d.start<start+text.length&&d.start+d.length>start),point=this.executionPoint,active=Number.isInteger(point?.start)&&point.start<start+text.length&&point.end>start;
    if(!diagnostics.length&&!active)return kind?`<span class="tok-${kind}">${escapeHtml(text)}</span>`:escapeHtml(text);
    const cuts=new Set([0,text.length]);for(const d of diagnostics){cuts.add(Math.max(0,d.start-start));cuts.add(Math.min(text.length,d.start+d.length-start));}if(active){cuts.add(Math.max(0,point.start-start));cuts.add(Math.min(text.length,point.end-start));}const points=[...cuts].sort((a,b)=>a-b);return points.slice(0,-1).map((a,i)=>{const b=points[i+1],d=diagnostics.find(d=>d.start<start+b&&d.start+d.length>start+a),current=active&&point.start<start+b&&point.end>start+a;return `<span class="${kind?'tok-'+kind:''} ${d?'sf-squiggle':''} ${current?'sf-current-statement':''}">${escapeHtml(text.slice(a,b))}</span>`;}).join('');}

  trivia(text,start){let result='',offset=0;for(const m of text.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)){result+=this.segment(text.slice(offset,m.index),start+offset);result+=this.segment(m[0],start+m.index,'comment');offset=m.index+m[0].length;}return result+this.segment(text.slice(offset),start+offset);}
  paint(){
    const source=this.sourceSnapshot();
    if(this.highlightIndex?.source!==source){this.highlightIndex=new SyntaxHighlightIndex(source);this.selectionHistory=[];}
    this.lexed=this.highlightIndex.lexed;this.lexedSource=source;this.pairs=this.highlightIndex.pairs;
    this.lineCount=source.lineStarts.length;this.highlightWindowKey=null;this.sync();
  }
  paintViewport(){
    if(!this.highlightIndex)return;
    const window=this.highlightIndex.window({scrollTop:this.input.scrollTop,height:this.element.clientHeight,lineHeight:this.lineHeight,padding:this.padding});
    const key=window.start+':'+window.end;
    if(this.highlightWindowKey!==key){
      const text=this.value;this.highlight.innerHTML=window.runs.map(run=>{
        const html=this.segment(text.slice(run.start,run.end),run.start,run.kind);
        return run.bracket?`<span data-bracket="${run.start}">${html}</span>`:html;
      }).join('')+(window.end===text.length?'\n':'');
      this.highlightWindowKey=key;this.bracketElements=new Map([...this.highlight.querySelectorAll('[data-bracket]')].map(el=>[Number(el.dataset.bracket),el]));this.lastBracketElements=[];
    }
    this.highlight.style.transform=`translate(${-this.input.scrollLeft}px,${window.firstLine*this.lineHeight-this.input.scrollTop}px)`;
    this.highlightMetrics={firstLine:window.firstLine,lastLine:window.lastLine,paintedCharacters:window.characters,paintedRuns:window.runs.length,totalTokens:this.lexed?.tokens.length??0,syntax:window.syntax};
    this.markBrackets();
  }
  markBrackets(){
    for(const el of this.lastBracketElements??[])el.classList.remove('sf-bracket-match');
    const at=this.pairs?.has(this.offset)?this.offset:this.offset-1;
    this.lastBracketElements=[this.bracketElements?.get(at),this.bracketElements?.get(this.pairs?.get(at))].filter(Boolean);
    for(const el of this.lastBracketElements)el.classList.add('sf-bracket-match');
  }
  setDiagnostics(diagnostics){this.diagnostics=diagnostics;this.paint();}
  setBreakpoints(breakpoints){this.breakpoints=breakpoints;this.sync();}
  setExecutionLine(line){this.setExecutionLocation(line?{line}:null);}
  setExecutionLocation(point,details={}){const signature=JSON.stringify([point?.line,point?.start,point?.end,details.phase]);if(signature!==this.executionSignature){this.executionSignature=signature;this.highlightWindowKey=null;}this.executionPoint=point;this.executionLine=point?.line??null;this.executionDetails=details;this.sync();}
  setSelectedFrameLine(line){this.selectedFrameLine=line;this.sync();}
  sync(){
    if(this.disposed)return; // ResizeObserver may already have queued a notification.
    if(this.keymapAdapter){this.keymapAdapter.decorate();if(this.keymapAdapter.doc!==this.element.ownerDocument){const mode=this.keymap;this.setKeymap(mode);}return;}
    const top=this.input.scrollTop,left=this.input.scrollLeft;this.paintViewport();const current=this.sourceSnapshot().positionAt(this.offset).line+1;
    const first=Math.max(1,Math.floor((top-this.padding)/this.lineHeight)),last=Math.min(this.lineCount??1,first+Math.ceil(this.element.clientHeight/this.lineHeight)+3);let rows='';
    for(let line=first;line<=last;line++){const bp=this.breakpoints.find(b=>b.line===line),hasError=this.diagnostics.some(d=>d.range?.start.line===line-1);rows+=`<button type="button" class="sf-line ${line===current?'current':''} ${bp?'breakpoint':''} ${bp?.verified===false?'pending':''} ${bp?.enabled===false||bp?.muted?'disabled-breakpoint':''} ${line===this.executionLine?'execution':''} ${line===this.selectedFrameLine?'selected-frame':''} ${hasError?'error':''}" data-line="${line}" style="top:${this.padding+(line-1)*this.lineHeight-top}px" title="${escapeHtml((line===this.executionLine?(this.executionDetails?.description??'Execution position')+' · ':line===this.selectedFrameLine?'Selected caller (not executing) · ':'')+(bp?.message??(bp?(bp.enabled===false?'Disabled breakpoint':'Remove breakpoint'):'Set breakpoint')))} at line ${line}" aria-label="${bp?'Remove':'Set'} breakpoint at line ${line}"><i></i><span>${line}</span></button>`;}
    if(this.gutterMarkup!==rows){this.gutter.innerHTML=rows;this.gutterMarkup=rows;}
    const currentEl=this.element.querySelector('.sf-current-line');currentEl.style.top=this.padding+(current-1)*this.lineHeight-top+'px';
    const selected=this.element.querySelector('.sf-selected-frame-line');selected.hidden=!this.selectedFrameLine;if(this.selectedFrameLine)selected.style.top=this.padding+(this.selectedFrameLine-1)*this.lineHeight-top+'px';
    const ex=this.element.querySelector('.sf-execution-line');ex.hidden=!this.executionLine;if(this.executionLine)ex.style.top=this.padding+(this.executionLine-1)*this.lineHeight-top+'px';
  }
  cursor(){const source=this.sourceSnapshot();this.onCursor({...source.positionAt(this.offset),offset:this.offset,selected:this.input.selectionEnd-this.offset});this.sync();}
  async expandSelection(){
    const source=this.sourceSnapshot(),start=this.offset,end=this.input.selectionEnd;
    const result=await this.request('selectionRanges',{uri:this.uri,offsets:[start]});
    if(this.disposed||this.sourceSnapshot()!==source||this.offset!==start||this.input.selectionEnd!==end)return;
    let range=result?.[0];
    while(range){const nextStart=source.offsetAt(range.range.start),nextEnd=source.offsetAt(range.range.end);
      if(nextStart<=start&&nextEnd>=end&&(nextStart<start||nextEnd>end)){
        this.selectionHistory??=[];this.selectionHistory.push({start,end,nextStart,nextEnd});if(this.selectionHistory.length>64)this.selectionHistory.shift();
        this.input.setSelectionRange(nextStart,nextEnd);this.cursor();return;
      }range=range.parent;
    }
  }
  shrinkSelection(){
    const item=this.selectionHistory?.pop();if(!item)return;
    if(this.offset!==item.nextStart||this.input.selectionEnd!==item.nextEnd){this.selectionHistory=[];return;}
    this.input.setSelectionRange(item.start,item.end);this.cursor();
  }
  goto(offset,end=offset){this.input.focus();this.input.setSelectionRange(offset,end);this.keymapAdapter?.goto(offset,end);const line=this.sourceSnapshot().positionAt(offset).line;this.input.scrollTop=Math.max(0,line*this.lineHeight-this.element.clientHeight*.35);this.cursor();}
  gotoLine(line,column=1){const source=this.sourceSnapshot();this.goto(source.offsetAt({line:line-1,character:column-1}));}
  async complete(){const id=++this.completionId,uri=this.uri,offset=this.offset;const items=await this.request('completion',{uri,offset});if(this.disposed||id!==this.completionId||uri!==this.uri||offset!==this.offset)return;if(!items?.length){this.closeCompletion();return;}this.items=items.slice(0,30);this.completionIndex=0;this.completionStart=offset-(this.value.slice(0,offset).match(/[\p{L}\p{N}_]+$/u)?.[0].length??0);this.paintCompletion();}
  paintCompletion(){if(!this.items?.length)return;const source=new SourceText(this.value,this.uri),pos=source.positionAt(this.offset),x=66+14+pos.character*8.4-this.input.scrollLeft,y=this.padding+(pos.line+1)*this.lineHeight-this.input.scrollTop;this.completion.classList.remove('hidden');this.completion.style.left=Math.max(66,Math.min(this.element.clientWidth-340,x))+'px';this.completion.style.top=Math.max(0,Math.min(this.element.clientHeight-230,y))+'px';this.completion.innerHTML=this.items.map((item,i)=>`<button class="${i===this.completionIndex?'selected':''}" data-index="${i}" role="option" aria-selected="${i===this.completionIndex}"><span class="completion-kind">${{method:'m',class:'C',field:'f',keyword:'k',property:'p'}[item.kind]??'v'}</span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.kind)}</small></button>`).join('')+`<footer>${escapeHtml(this.items[this.completionIndex]?.detail??'')}</footer>`;this.completion.querySelectorAll('[data-index]').forEach(b=>b.onmousedown=e=>{e.preventDefault();this.completionIndex=Number(b.dataset.index);this.acceptCompletion();});this.completion.querySelector('.selected')?.scrollIntoView({block:'nearest'});}
  acceptCompletion(){const item=this.items?.[this.completionIndex];if(item){const start=this.completionStart,end=this.offset;this.closeCompletion();this.insert(item.insertText??item.label,start,end);this.input.focus();}}
  closeCompletion(){this.completionId++;this.completion.classList.add('hidden');this.items=[];}
  hover(e){clearTimeout(this.hoverTimer);this.tooltip.classList.add('hidden');const id=++this.hoverId,uri=this.uri,text=this.value,rect=this.input.getBoundingClientRect(),line=Math.floor((e.clientY-rect.top+this.input.scrollTop-this.padding)/this.lineHeight),character=Math.max(0,Math.round((e.clientX-rect.left+this.input.scrollLeft-14)/8.4)),source=this.sourceSnapshot(),offset=source.offsetAt({line,character});this.hoverTimer=setTimeout(async()=>{const result=await this.request('hover',{uri,offset});if(!result||this.disposed||id!==this.hoverId||uri!==this.uri||text!==this.value)return;this.tooltip.textContent=result.contents;this.tooltip.style.left=Math.max(66,Math.min(this.element.clientWidth-330,e.clientX-this.element.getBoundingClientRect().left))+'px';this.tooltip.style.top=Math.min(this.element.clientHeight-70,e.clientY-this.element.getBoundingClientRect().top+20)+'px';this.tooltip.classList.remove('hidden');},450);}
  openFind(replace=false){this.findBox.classList.remove('hidden');this.findBox.querySelector('.sf-replace-row').classList.toggle('hidden',!replace);const selected=this.value.slice(this.offset,this.input.selectionEnd);if(selected&&selected.length<=1024&&!selected.includes('\n'))this.findBox.querySelector('[aria-label="Find in current file"]').value=selected;this.findBox.querySelector('input').focus();this.findBox.querySelector('input').select();}
  findOptions(){return {matchCase:this.findBox.querySelector('[data-match-case]').checked,wholeWord:this.findBox.querySelector('[data-whole-word]').checked,maxMatches:10000};}
  findNext(reset=false,direction=1){try{const query=this.findBox.querySelector('[aria-label="Find in current file"]').value;if(!query){this.findBox.querySelector('.sf-find-count').textContent='';return;}const options=this.findOptions(),key=JSON.stringify([query,options]),source=this.sourceSnapshot();if(this.findCache?.source!==source||this.findCache.key!==key)this.findCache={source,key,result:findTextMatches([source],query,options)};const result=this.findCache.result,matches=result.matches,match=reset?matches[0]:direction<0?matches.findLast(m=>m.end<=this.input.selectionStart)??matches.at(-1):matches.find(m=>m.start>=this.input.selectionEnd)??matches[0];this.findBox.querySelector('.sf-find-count').textContent=matches.length?`${match?matches.indexOf(match)+1:0} of ${matches.length}${result.truncated?'+':''}`:'No results';if(match){this.input.setSelectionRange(match.start,match.end);this.input.scrollTop=Math.max(0,match.line*this.lineHeight-100);this.cursor();}}catch(error){this.findBox.querySelector('.sf-find-count').textContent=error.message;}}
  replaceCurrent(all=false){if(this.input.readOnly)return;try{const query=this.findBox.querySelector('[aria-label="Find in current file"]').value,replacement=this.findBox.querySelector('[aria-label="Replace in current file"]').value,result=replaceLiteral(this.value,query,replacement,this.findOptions());if(all){if(result.count)this.setValue(result.text);this.findBox.querySelector('.sf-find-count').textContent=`Replaced ${result.count} occurrences`;return;}const match=result.matches.find(m=>m.start===this.offset&&m.end===this.input.selectionEnd);if(match)this.insert(replacement,match.start,match.end);this.findNext();}catch(error){this.findBox.querySelector('.sf-find-count').textContent=error.message;}}
  toggleLineComment(forceUncomment=null){if(this.input.readOnly)return;const start=this.offset,end=this.input.selectionEnd,lineStart=this.value.lastIndexOf('\n',start-1)+1,last=end>start&&this.value[end-1]==='\n'?end-1:end,lineEndAt=this.value.indexOf('\n',last),lineEnd=lineEndAt<0?this.value.length:lineEndAt,lines=this.value.slice(lineStart,lineEnd).split('\n'),nonEmpty=lines.filter(l=>l.trim()),uncomment=forceUncomment??(nonEmpty.length>0&&nonEmpty.every(l=>/^\s*\/\//.test(l)));const changed=lines.map(line=>!line.trim()?line:uncomment?line.replace(/^(\s*)\/\/ ?/,'$1'):line.replace(/^(\s*)/,'$1// ')).join('\n');this.insert(changed,lineStart,lineEnd);this.input.setSelectionRange(lineStart,lineStart+changed.length);this.cursor();}
  moveLines(direction){if(this.input.readOnly||![1,-1].includes(direction))return;const lines=this.value.split('\n'),source=new SourceText(this.value,this.uri),start=source.positionAt(this.offset),end=source.positionAt(this.input.selectionEnd),last=end.character===0&&end.line>start.line?end.line-1:end.line;if(direction<0&&start.line===0||direction>0&&last===lines.length-1)return;const block=lines.splice(start.line,last-start.line+1);lines.splice(start.line+direction,0,...block);const text=lines.join('\n');this.setValue(text);const next=new SourceText(text,this.uri);this.input.setSelectionRange(next.offsetAt({line:start.line+direction,character:start.character}),next.offsetAt({line:end.line+direction,character:end.character}));this.cursor();}
  dispose(){this.disposed=true;this.keymapAdapter?.dispose();this.hoverId++;this.closeCompletion();this.resizeObserver.disconnect();clearTimeout(this.hoverTimer);this.element.innerHTML='';}
}
