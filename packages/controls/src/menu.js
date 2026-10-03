let menuId=0;
/** Owner-document-aware accessible context menu. Content is text, not HTML. */
export class ContextMenu {
 constructor({onError=()=>{},root=null}={}){this.onError=onError;this.preferredRoot=root;this.levels=[];this.id='sf-menu-'+(++menuId);this.listeners=[];}
 normalize(items){return items.filter(x=>x!==undefined).map(item=>item===null||item?.separator?{separator:true}:Array.isArray(item)?{label:item[0],action:item[1],shortcut:item[2],enabled:item[3]??true}:item);}
 enabled(item){const result=typeof item.enabled==='function'?item.enabled():item.enabled;return result===undefined||result===true;}
 show({items,x=0,y=0,anchor=null,document:doc=anchor?.ownerDocument??globalThis.document,label='Context menu',onClose=()=>{}}){
  this.close(false);this.document=doc;this.returnFocus=anchor??doc.activeElement;this.onClose=onClose;this.lastItems=items;const root=this.preferredRoot?.ownerDocument===doc?this.preferredRoot:null;
  this.addLevel(this.normalize(items),x,y,null,root,label);
  const listen=(target,type,handler,capture=false)=>{target.addEventListener(type,handler,capture);this.listeners.push(()=>target.removeEventListener(type,handler,capture));};
  listen(doc,'pointerdown',e=>{if(!this.levels.some(l=>l.element.contains(e.target)))this.close(false);},true);
  listen(doc,'keydown',e=>this.keydown(e),true);listen(doc.defaultView,'resize',()=>this.close(false));listen(doc.defaultView,'blur',()=>this.close(false));
  return this;
 }
 addLevel(items,x,y,parent,root=null,label='Submenu'){
  const doc=this.document,el=root??doc.createElement('div');el.className='menu-popup sf-menu';el.classList.remove('hidden');el.setAttribute('role','menu');el.setAttribute('aria-label',label);if(!el.id)el.id=this.id+'-'+this.levels.length;el.replaceChildren();el.style.position='fixed';
  const level={element:el,items,buttons:[],parent,owned:!root,index:-1};this.levels.push(level);
  items.forEach((item,index)=>{
   if(item.separator){const hr=doc.createElement('hr');hr.setAttribute('role','separator');el.append(hr);return;}
   const button=doc.createElement('button');button.type='button';button.tabIndex=-1;button.dataset.menuIndex=index;button.dataset.menuAction=index;button.setAttribute('role',item.checked!==undefined?(item.radio?'menuitemradio':'menuitemcheckbox'):'menuitem');
   if(item.checked!==undefined)button.setAttribute('aria-checked',String(typeof item.checked==='function'?!!item.checked():!!item.checked));
   const enabled=this.enabled(item);button.setAttribute('aria-disabled',String(!enabled));if(!enabled){button.classList.add('disabled');button.title=item.disabledReason??(typeof item.enabled==='function'?String(item.enabled()):'Unavailable in this context');}
   if(item.children){button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');}
   const check=doc.createElement('span');check.className='sf-menu-check';check.textContent=button.getAttribute('aria-checked')==='true'?(item.radio?'●':'✓'):item.icon??'';
   const text=doc.createElement('span');text.className='sf-menu-label';text.textContent=item.label??'';
   const key=doc.createElement('span');key.className='sf-menu-key';key.textContent=item.children?'›':item.shortcut??'';button.append(check,text,key);el.append(button);level.buttons.push({button,index,item});
   button.onmouseenter=()=>{clearTimeout(this.hoverTimer);this.setFocus(level,index,false);if(item.children&&enabled)this.hoverTimer=setTimeout(()=>this.submenu(level,index,false),150);else this.trim(this.levels.indexOf(level)+1);};
   button.onfocus=()=>{level.index=index;};button.onclick=e=>{e.stopPropagation();this.activate(level,index);};
  });
  if(!root)doc.body.append(el);this.position(el,x,y);const first=level.buttons[0];if(first)this.setFocus(level,first.index,true);else{el.tabIndex=-1;el.focus();}return level;
 }
 position(el,x,y){const view=this.document.defaultView,width=view.innerWidth,height=view.innerHeight;el.style.maxHeight=Math.max(60,height-12)+'px';el.style.left=Math.max(4,Math.min(Number.isFinite(x)?x:0,width-el.offsetWidth-4))+'px';el.style.top=Math.max(4,Math.min(Number.isFinite(y)?y:0,height-el.offsetHeight-4))+'px';}
 setFocus(level,index,focus=true){level.index=index;for(const b of level.buttons){b.button.classList.toggle('selected',b.index===index);if(b.index===index&&focus){b.button.focus({preventScroll:true});b.button.scrollIntoView({block:'nearest'});}}}
 trim(count){while(this.levels.length>count){const level=this.levels.pop();if(level.parent)level.parent.setAttribute('aria-expanded','false');if(level.owned)level.element.remove();else level.element.classList.add('hidden');}}
 submenu(level,index,focus=true){const entry=level.buttons.find(b=>b.index===index);if(!entry?.item.children||!this.enabled(entry.item))return;const at=this.levels.indexOf(level);if(this.levels[at+1]?.parent===entry.button){if(focus)this.levels[at+1].buttons[0]?.button.focus();return;}this.trim(at+1);entry.button.setAttribute('aria-expanded','true');const rect=entry.button.getBoundingClientRect();const children=typeof entry.item.children==='function'?entry.item.children():entry.item.children;const next=this.addLevel(this.normalize(children),rect.right-2,rect.top,entry.button,null,entry.item.label);if(rect.right+next.element.offsetWidth>this.document.defaultView.innerWidth)this.position(next.element,rect.left-next.element.offsetWidth+2,rect.top);if(!focus)entry.button.focus({preventScroll:true});}
 activate(level,index){const item=level.items[index];if(!item||item.separator||!this.enabled(item))return;if(item.children){this.submenu(level,index);return;}const action=item.action??item.execute;this.close(true);Promise.resolve().then(()=>{if(this.enabled(item))return action?.();}).catch(this.onError);}
 keydown(e){if(!this.levels.length)return;const level=this.levels.find(l=>l.element.contains(this.document.activeElement))??this.levels.at(-1),at=level.buttons.findIndex(b=>b.index===level.index);let handled=true;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){const next=(at+(e.key==='ArrowDown'?1:-1)+level.buttons.length)%level.buttons.length;if(level.buttons[next])this.setFocus(level,level.buttons[next].index);}
  else if(e.key==='Home'||e.key==='End'){const b=e.key==='Home'?level.buttons[0]:level.buttons.at(-1);if(b)this.setFocus(level,b.index);}
  else if(e.key==='ArrowRight')this.submenu(level,level.index);
  else if(e.key==='ArrowLeft'){if(level.parent){const parent=level.parent;this.trim(this.levels.indexOf(level));parent.focus();}}
  else if(e.key==='Enter'||e.key===' ')this.activate(level,level.index);
  else if(e.key==='Escape'){if(level.parent){const parent=level.parent;this.trim(this.levels.indexOf(level));parent.focus();}else this.close(true);}
  else if(e.key==='Tab'){this.close(true);}
  else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.length===1){const now=Date.now();this.typeText=now-(this.typeTime??0)>700?e.key:(this.typeText??'')+e.key;this.typeTime=now;const text=this.typeText.toLocaleLowerCase();for(let i=1;i<=level.buttons.length;i++){const b=level.buttons[(at+i)%level.buttons.length];if(b.item.label.toLocaleLowerCase().startsWith(text)){this.setFocus(level,b.index);break;}}}
  else handled=false;
  if(handled){e.preventDefault();e.stopPropagation();}
 }
 close(restore=true){clearTimeout(this.hoverTimer);const had=this.levels.length>0;for(const dispose of this.listeners)dispose();this.listeners=[];this.trim(0);if(had){if(restore&&this.returnFocus?.isConnected)this.returnFocus.focus?.({preventScroll:true});this.onClose?.();}this.typeText='';}
 dispose(){this.close(false);}
}
