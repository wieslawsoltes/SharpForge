import {createClassicEngine} from './vendor/classic-engine.js';
export const EDITOR_KEYMAPS=[{id:'visual-studio',label:'Visual Studio (default)'},{id:'vscode',label:'Visual Studio Code'},{id:'vim',label:'Vim'},{id:'emacs',label:'Emacs'},{id:'sublime',label:'Sublime Text'}];
const engines=new WeakMap();
function engineFor(doc){let engine=engines.get(doc);if(!engine){engine=createClassicEngine(doc,doc.defaultView,doc.defaultView.navigator);engines.set(doc,engine);
 engine.commands.save=cm=>host(cm,'save');engine.commands.saveAll=engine.commands.save;
 const host=(cm,method,params={})=>{const e=cm.state.sharpforgeEditor;Promise.resolve(e?.request(method,{uri:e.uri,...params})).catch(error=>cm.openNotification?.(error.message,{duration:4000}));};
 engine.commands.open=cm=>host(cm,'openDocumentPrompt');engine.commands.close=cm=>host(cm,'closeDocument');
 engine.Vim.defineEx('write','w',(cm,p)=>{if(p.argString?.trim()||p.line!==undefined||p.lineEnd!==undefined){cm.openNotification('Write supports the current workspace document only; file/range arguments are not supported.',{duration:5000});return;}host(cm,'save');});
 engine.Vim.defineEx('quit','q',cm=>host(cm,'closeDocument'));
 engine.Vim.defineEx('wq','wq',cm=>{const e=cm.state.sharpforgeEditor;Promise.resolve(e.request('save',{uri:e.uri})).then(ok=>{if(ok!==false)return e.request('closeDocument',{uri:e.uri});}).catch(error=>cm.openNotification?.(error.message,{duration:4000}));});
 engine.Vim.defineEx('edit','e',(cm,p)=>{const path=p.argString?.trim();if(!path){cm.openNotification('Use :edit followed by an existing workspace path. Reload/discard is not supported here.',{duration:5000});return;}host(cm,'openDocument',{path});});
 engine.Vim.defineEx('bnext','bn',cm=>host(cm,'nextDocument'));
 engine.Vim.defineEx('bprevious','bp',cm=>host(cm,'previousDocument'));
 }return engine;}
/** Mature modal/alternative keymaps share the same project buffer and debugger decorations. */
export class ClassicKeymapAdapter {
 constructor(editor,mode){this.editor=editor;this.mode=mode;this.doc=editor.element.ownerDocument;this.syncing=false;this.host=this.doc.createElement('div');this.host.className='sf-keymap-host';editor.element.append(this.host);editor.element.classList.add('sf-classic-active');
  const engine=this.engine=engineFor(this.doc),e=editor;
  this.cm=engine(this.host,{value:e.value,mode:'text/x-csharp',keyMap:mode,theme:'sharpforge',lineNumbers:true,gutters:['sf-breakpoint-gutter','CodeMirror-linenumbers'],indentUnit:4,tabSize:4,indentWithTabs:false,lineWrapping:false,readOnly:e.input.readOnly,matchBrackets:true,undoDepth:200,viewportMargin:10,inputStyle:'textarea',extraKeys:{
   'F12':()=>e.request('definition',{uri:e.uri,offset:e.offset}),'Shift-F12':()=>e.request('references',{uri:e.uri,offset:e.offset}),'Ctrl-.':()=>!e.input.readOnly&&e.request('codeActions',{uri:e.uri,offset:e.offset,end:e.input.selectionEnd}),'Ctrl-Space':()=>e.complete(),'Ctrl-Shift-F':()=>e.request('findFiles',{uri:e.uri}),'Ctrl-S':()=>e.request('save',{uri:e.uri})
  }});
  const cm=this.cm;cm.state.sharpforgeEditor=e;if(mode==='emacs'){const extra={...cm.getOption('extraKeys')};delete extra['Ctrl-S'];delete extra['Ctrl-Space'];extra['Ctrl-Alt-Space']=()=>e.complete();cm.setOption('extraKeys',extra);}
  cm.on('changes',()=>{if(this.syncing)return;this.syncing=true;try{e.input.value=cm.getValue();this.selectionToBridge();e.changed();}finally{this.syncing=false;}});
  cm.on('cursorActivity',()=>{if(this.syncing)return;this.selectionToBridge();e.cursor();});
  cm.on('beforeChange',(_,change)=>{if(e.input.readOnly&&!this.syncing)change.cancel();});
  cm.on('focus',()=>e.input.dispatchEvent(new Event('focus')));
  cm.on('gutterClick',(_,line,gutter,event)=>{if(event.button===0)e.onBreakpoint(line+1);});
  cm.on('gutterContextMenu',(_,line,gutter,event)=>{event.preventDefault();event.stopPropagation();e.onBreakpointEdit(line+1,event);});
  cm.on('vim-mode-change',status=>{e.modalMode=status.mode+(status.subMode?' '+status.subMode:'');e.onKeymapState?.({keymap:mode,mode:e.modalMode});});
  cm.on('vim-command-done',()=>e.onKeymapState?.({keymap:mode,mode:e.modalMode??'normal'}));
  cm.getInputField().setAttribute('aria-label',e.uri+' — '+EDITOR_KEYMAPS.find(k=>k.id===mode)?.label+' editor');
  if(e.classicHistory?.mode===mode&&e.classicHistory.text===e.value)cm.setHistory(e.classicHistory.history);
  this.goto(e.offset,e.input.selectionEnd,false);cm.refresh();this.decorate();e.modalMode=mode==='vim'?'normal':'editing';e.onKeymapState?.({keymap:mode,mode:e.modalMode});
 }
 selectionToBridge(){const s=this.cm.listSelections()[0],a=this.cm.indexFromPos(s.anchor),b=this.cm.indexFromPos(s.head);this.editor.input.setSelectionRange(Math.min(a,b),Math.max(a,b),a>b?'backward':'forward');}
 syncFromBridge(){if(this.syncing)return;this.syncing=true;try{const e=this.editor,cm=this.cm,start=e.input.selectionStart,end=e.input.selectionEnd;if(cm.getValue()!==e.value){const previous=cm.getValue();let a=0,b=previous.length,c=e.value.length;while(a<b&&a<c&&previous[a]===e.value[a])a++;while(b>a&&c>a&&previous[b-1]===e.value[c-1]){b--;c--;}cm.replaceRange(e.value.slice(a,c),cm.posFromIndex(a),cm.posFromIndex(b),'sharpforge');}cm.setSelection(cm.posFromIndex(start),cm.posFromIndex(end));}finally{this.syncing=false;}}
 setModel(){this.syncing=true;try{this.cm.setValue(this.editor.value);this.cm.clearHistory();this.goto(this.editor.offset,this.editor.input.selectionEnd,false);}finally{this.syncing=false;}}
 goto(start,end=start,focus=true){const cm=this.cm;this.syncing=true;try{cm.setSelection(cm.posFromIndex(start),cm.posFromIndex(end));cm.scrollIntoView({from:cm.posFromIndex(start),to:cm.posFromIndex(end)},80);if(focus)cm.focus();}finally{this.syncing=false;}}
 focus(){this.cm.focus();}
 undo(redo=false){if(!this.editor.input.readOnly)this.cm.execCommand(redo?'redo':'undo');}
 setReadOnly(value){this.cm.setOption('readOnly',!!value);}
 decorate(){const e=this.editor,cm=this.cm,key=JSON.stringify([e.breakpoints,e.executionLine,e.selectedFrameLine,e.executionPoint,e.diagnostics.map(d=>[d.start,d.length])]);if(this.decorationKey===key)return;this.decorationKey=key;
  cm.operation(()=>{cm.clearGutter('sf-breakpoint-gutter');for(const b of e.breakpoints){if(b.line<1||b.line>cm.lineCount())continue;const marker=this.doc.createElement('span');marker.className='sf-cm-breakpoint'+(b.verified===false?' pending':'')+(b.enabled===false||b.muted?' disabled':'');marker.textContent=b.logMessage?'◆':'●';marker.title=b.message??(b.enabled===false?'Disabled breakpoint':'Breakpoint');marker.setAttribute('aria-label',marker.title);cm.setGutterMarker(b.line-1,'sf-breakpoint-gutter',marker);}
   if(this.executionHandle){cm.removeLineClass(this.executionHandle,'background','sf-cm-execution');this.executionHandle=null;}if(e.executionLine&&e.executionLine<=cm.lineCount())this.executionHandle=cm.addLineClass(e.executionLine-1,'background','sf-cm-execution');
   if(this.selectedHandle){cm.removeLineClass(this.selectedHandle,'background','sf-cm-selected-frame');this.selectedHandle=null;}if(e.selectedFrameLine&&e.selectedFrameLine<=cm.lineCount())this.selectedHandle=cm.addLineClass(e.selectedFrameLine-1,'background','sf-cm-selected-frame');
   for(const [line,glyph,cls]of [[e.executionLine,'➜','execution'],[e.selectedFrameLine,'⇢','selected']]){if(!line||line>cm.lineCount())continue;const existing=cm.lineInfo(line-1)?.gutterMarkers?.['sf-breakpoint-gutter'],marker=existing??this.doc.createElement('span');if(!existing)marker.className='sf-cm-marker';const arrow=this.doc.createElement('b');arrow.className='sf-cm-arrow '+cls;arrow.textContent=glyph;arrow.title=cls==='execution'?(e.executionDetails?.description??'Execution position'):'Selected caller (not the executing frame)';marker.append(arrow);cm.setGutterMarker(line-1,'sf-breakpoint-gutter',marker);}
   this.statementMark?.clear();this.statementMark=null;if(Number.isInteger(e.executionPoint?.start))this.statementMark=cm.markText(cm.posFromIndex(e.executionPoint.start),cm.posFromIndex(e.executionPoint.end),{className:'sf-current-statement'});
   for(const mark of this.diagnosticMarks??[])mark.clear();this.diagnosticMarks=e.diagnostics.slice(0,500).map(d=>cm.markText(cm.posFromIndex(d.start),cm.posFromIndex(d.start+Math.max(1,d.length)),{className:'sf-squiggle',title:d.message}));
  });
 }
 coordinates(event){return this.cm.indexFromPos(this.cm.coordsChar({left:event.clientX,top:event.clientY},'window'));}
 dispose(){this.editor.classicHistory={mode:this.mode,text:this.cm.getValue(),history:this.cm.getHistory()};this.cm.state.sharpforgeEditor=null;this.cm.getInputField().blur();this.host.remove();this.editor.element.classList.remove('sf-classic-active');}
}
/** Chord-aware VS bindings; unrecognized keys retain the ordinary editor's behavior. */
export function handleVisualStudioKey(editor,event){
 if(editor.keymap!=='visual-studio')return false;const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase(),now=Date.now();
 if(editor.pendingChord&&now-editor.pendingChord.time>2000)editor.pendingChord=null;
 if(['control','meta','alt','shift'].includes(key))return false;
 if(editor.pendingChord){const prefix=editor.pendingChord.key;editor.pendingChord=null;if(prefix==='k'&&mod){event.preventDefault();event.stopPropagation();if(key==='c')editor.toggleLineComment(false);else if(key==='u')editor.toggleLineComment(true);else if(key==='d'||key==='f')editor.request('format',{uri:editor.uri});else if(key==='s')editor.request('codeActions',{uri:editor.uri,offset:editor.offset,end:editor.input.selectionEnd});return true;}if(prefix==='r'&&mod&&key==='r'){event.preventDefault();event.stopPropagation();editor.request('rename',{uri:editor.uri,offset:editor.offset});return true;}}
 if(mod&&!event.shiftKey&&!event.altKey&&['k','r'].includes(key)){event.preventDefault();event.stopPropagation();editor.pendingChord={key,time:now};editor.onKeymapState?.({keymap:editor.keymap,mode:'Ctrl+'+key.toUpperCase()+' …'});return true;}
 if(mod&&!event.shiftKey&&key===']'){event.preventDefault();const at=editor.pairs?.has(editor.offset)?editor.offset:editor.offset-1,target=editor.pairs?.get(at);if(target!==undefined)editor.goto(target);return true;}
 if(mod&&event.shiftKey&&key==='l'){event.preventDefault();if(!editor.input.readOnly){const start=editor.value.lastIndexOf('\n',editor.offset-1)+1,end=editor.value.indexOf('\n',editor.input.selectionEnd);editor.insert('',start,end<0?editor.value.length:end+1);}return true;}
 if(mod&&!event.shiftKey&&key==='d'){event.preventDefault();const start=editor.value.lastIndexOf('\n',editor.offset-1)+1,end=editor.value.indexOf('\n',editor.offset),text=editor.value.slice(start,end<0?editor.value.length:end);editor.insert(text+'\n',start,start);return true;}
 return false;
}
