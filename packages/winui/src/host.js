import {XAML,CONTROLS,propertiesFor,eventsFor,frameworkType} from '@sharpforge/framework';
import {RenderSurface,cssColor,parseColor,drawingPrimitives} from './surface.js';
import {HostGeometryUpdates} from './host-geometry-updates.js';
import {shapeUsesDomPaint,resetHostBrushColors} from './host-gradients.js';
const suffix=t=>t.slice(t.lastIndexOf('.')+1);
const number=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
const margin=v=>v?`${number(v.Top)}px ${number(v.Right)}px ${number(v.Bottom)}px ${number(v.Left)}px`:'0px';
const radius=v=>v?`${number(v.TopLeft)}px ${number(v.TopRight)}px ${number(v.BottomRight)}px ${number(v.BottomLeft)}px`:'0px';
const gridLength=v=>!v?'1fr':v.GridUnitType===0?'auto':v.GridUnitType===2?`${number(v.Value,1)}fr`:`${number(v.Value)}px`;
function safeUrl(value,{image=false}={}){if(typeof value!=='string')return '';try{const u=new URL(value,'https://invalid.local/');if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.hostname!=='invalid.local')return value;if(image&&/^(blob:|data:image\/(png|jpeg|webp|gif);base64,)/i.test(value)&&value.length<=8*1024*1024)return value;return '';}catch{return '';}}
/** Keyed retained HTML controls, accepting a structured scene/command stream from a VM worker. */
export class WinUIHost {
  constructor(root,{backend='auto',onEvent=()=>{},onLayout=()=>{},onMetrics=()=>{},onError=()=>{},gpu=globalThis.navigator?.gpu}={}){
    if(!root?.ownerDocument)throw new TypeError('WinUIHost requires a DOM root');
    this.root=root;this.document=root.ownerDocument;this.options={backend,onEvent,onLayout,onMetrics,onError,gpu};
    this.nodes=new Map();this.elements=new Map();this.windows=[];this.surfaces=new Map();this.listeners=[];this.layouts=new Map();this.backend=backend;this.disposed=false;this.frame=0;this.pendingFlyouts=[];this.openFlyouts=new Map();
    root.classList.add('sf-winui');root.setAttribute('data-theme','dark');root.tabIndex=-1;
    this.geometryUpdates=new HostGeometryUpdates(this);
    this.resizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(entries=>this.geometryUpdates.resized(entries)):null;this.resizeObserver?.observe(root);
    for(const type of ['click','input','change','contextmenu','toggle','keydown']){const handler=e=>this.handleEvent(type,e);root.addEventListener(type,handler,type==='toggle');this.listeners.push([type,handler]);}
    this.onKey=e=>{if(e.key==='Escape')this.hideFlyouts();};root.addEventListener('keydown',this.onKey);
  }
  setBackend(backend){if(!['auto','webgpu','canvas2d','dom'].includes(backend))throw new TypeError('Unknown renderer');if(this.backend===backend)return;this.backend=backend;for(const s of this.surfaces.values())s.dispose();this.surfaces.clear();this.schedule();}
  apply(commands){if(!Array.isArray(commands))commands=[commands];if(commands.length>20000)throw new RangeError('UI command batch limit');this.geometryUpdates.invalidate();for(const command of commands){if(!command||typeof command.op!=='string')throw new TypeError('Invalid UI command');
    const c=command,n=this.nodes.get(c.id);
    if(c.op==='reset'){this.load(c.snapshot);continue;}
    if(c.op==='create'){if(typeof c.id!=='string'||!frameworkType(c.type))throw new TypeError('Unknown UI object');this.nodes.set(c.id,{id:c.id,type:c.type,properties:{...c.properties},events:[],collections:{}});}
    else if(c.op==='set'&&n)n.properties[c.property]=c.value;
    else if(c.op==='event'&&n){const set=new Set(n.events);if(c.enabled)set.add(c.event);else set.delete(c.event);n.events=[...set];}
    else if(c.op==='collection'&&n)n.collections[c.property]=[...c.items];
    else if(c.op==='draw'&&n)n.drawing=c.commands;
    else if(c.op==='activate'){if(c.snapshot)this.merge(c.snapshot);if(!this.windows.includes(c.id))this.windows.push(c.id);}
    else if(c.op==='close'){this.windows=this.windows.filter(id=>id!==c.id);}
    else if(c.op==='focus')queueMicrotask(()=>{const e=this.elements.get(c.id);(e?.querySelector('input,textarea,select,button')??e)?.focus();});
    else if(c.op==='flyout')this.pendingFlyouts.push(c);
    if(this.nodes.size>20000)throw new RangeError('WinUI object limit');
  }this.schedule();}
  merge(scene){if(scene?.version!==1||!Array.isArray(scene.nodes)||!Array.isArray(scene.windows)||scene.nodes.length>10000)throw new TypeError('Invalid WinUI scene');this.geometryUpdates.invalidate();for(const n of scene.nodes){if(typeof n.id!=='string'||!frameworkType(n.type))throw new TypeError('Unknown scene node');this.nodes.set(n.id,{...n,properties:{...n.properties},collections:{...n.collections},events:[...(n.events??[])]});}}
  load(scene){this.geometryUpdates.invalidate();this.openFlyouts.clear();this.nodes.clear();this.windows=[];if(scene){this.merge(scene);this.windows=[...scene.windows];}this.schedule();}
  schedule(options) { this.geometryUpdates.schedule(options); }
  get sceneRevision() { return this.geometryUpdates.revision; }
  /** Apply geometry property records to independent Canvas leaves; false means no mutation and requires a full scene update. */
  tryPatchProperties(changes) { return this.geometryUpdates.tryPatch(changes); }
  create(n){const type=suffix(n.type),d=this.document;let e;
    if(n.templateRoot&&!(type==='Button'||type==='ToggleButton')){e=d.createElement('div');e.dataset.template='true';}
    else if(['Button','ToggleButton','AppBarButton','HyperlinkButton','MenuFlyoutItem'].includes(type)){e=d.createElement(type==='HyperlinkButton'?'a':'button');if(e.tagName==='BUTTON')e.type='button';}
    else if(type==='TextBox'||type==='PasswordBox'||type==='AutoSuggestBox'){e=d.createElement(n.properties.AcceptsReturn?'textarea':'input');if(e.tagName==='INPUT')e.type=type==='PasswordBox'?'password':'text';}
    else if(['NumberBox','CalendarDatePicker','TimePicker'].includes(type)){e=d.createElement('input');e.type=type==='NumberBox'?'number':type==='TimePicker'?'time':'date';}
    else if(type==='Slider'){e=d.createElement('input');e.type='range';}
    else if(type==='ComboBox'){e=d.createElement('select');}
    else if(type==='ProgressBar'){e=d.createElement('progress');}
    else if(type==='Image'){e=d.createElement('img');}
    else if(type==='CheckBox'||type==='ToggleSwitch'||type==='RadioButton'){e=d.createElement('label');const input=d.createElement('input');input.type=type==='RadioButton'?'radio':'checkbox';input.dataset.part='check';if(type==='ToggleSwitch')input.setAttribute('role','switch');e.append(input,d.createElement('span'));}
    else if(type==='Expander'){e=d.createElement('details');e.append(d.createElement('summary'),d.createElement('div'));}
    else {e=d.createElement('div');if(type==='ListView')e.setAttribute('role','listbox');if(type==='MenuFlyout')e.setAttribute('role','menu');if(type==='NavigationView')e.setAttribute('role','navigation');if(type==='ProgressRing')e.setAttribute('role','progressbar');}
    e.dataset.sfId=n.id;e.dataset.winuiType=type;e.className='sf-winui-'+type;
    e.dataset.renderKind=n.type+':'+!!n.templateRoot;this.elements.set(n.id,e);this.resizeObserver?.observe(e);return e;
  }
  ensure(id){const n=this.nodes.get(id);if(!n)return null;const old=this.elements.get(id);if(old&&old.dataset.renderKind!==n.type+':'+!!n.templateRoot){this.resizeObserver?.unobserve(old);old.remove();this.elements.delete(id);}return this.elements.get(id)??this.create(n);}
  ordered(parent,children){let at=parent.firstChild;for(const child of children){if(child===at)at=at.nextSibling;else parent.insertBefore(child,at);}const keep=new Set(children);for(const child of [...parent.childNodes])if(!keep.has(child))child.remove();}
  children(n,property){return (n.collections?.[property]??[]).map(v=>v?.$ref?this.ensure(v.$ref):null).filter(Boolean);}
  content(parent,value){if(value?.$ref){const e=this.ensure(value.$ref);this.ordered(parent,e?[e]:[]);}else {const text=value==null?'':typeof value==='object'?'':String(value);if(parent.textContent!==text||parent.children.length)parent.textContent=text;}}
  layout(n,e){const p=n.properties,s=e.style;
    s.display=p.Visibility===1?'none':'';s.opacity=String(number(p.Opacity,1));s.pointerEvents=p.IsHitTestVisible===false||p.IsHitTestVisible===0?'none':'';
    for(const key of ['Width','Height','MinWidth','MinHeight','MaxWidth','MaxHeight'])s[key[0].toLowerCase()+key.slice(1)]=Number.isFinite(p[key])?Math.max(0,p[key])+'px':'';
    this.renderTransform(n,e);s.margin=margin(p.Margin);s.padding=p.Padding?margin(p.Padding):'';s.borderWidth=p.BorderThickness?margin(p.BorderThickness):'';s.borderStyle=p.BorderThickness?'solid':'';s.borderRadius=p.CornerRadius?radius(p.CornerRadius):'';
    resetHostBrushColors(p,s);
    s.fontSize=p.FontSize!==undefined?number(p.FontSize,14)+'px':'';if(p.FontFamily)s.fontFamily=String(p.FontFamily).replace(/[;{}]/g,'')+', system-ui, sans-serif';
    s.alignSelf=['flex-start','center','flex-end','stretch'][p.VerticalAlignment]??'';s.justifySelf=['start','center','end','stretch'][p.HorizontalAlignment]??'';
    if(p.HorizontalAlignment!==undefined&&p.HorizontalAlignment!==3)s.width=Number.isFinite(p.Width)?p.Width+'px':'fit-content';
    s.gridRowStart=p.Row===undefined?'':String(p.Row+1);s.gridColumnStart=p.Column===undefined?'':String(p.Column+1);s.gridRowEnd=p.RowSpan===undefined?'':`span ${p.RowSpan}`;s.gridColumnEnd=p.ColumnSpan===undefined?'':`span ${p.ColumnSpan}`;
    if(p.Left!==undefined||p.Top!==undefined){s.position='absolute';s.left=number(p.Left)+'px';s.top=number(p.Top)+'px';}else if(s.position==='absolute')s.position='';s.zIndex=p.ZIndex===undefined?'':String(p.ZIndex);
    if(p.Name){e.id='sf-app-'+n.id.replace(':','-');e.dataset.name=p.Name;}
    if(p.RequestedTheme)e.dataset.theme=p.RequestedTheme===1?'light':'dark';else delete e.dataset.theme;
    const input=e.matches('input,textarea,select,button')?e:e.querySelector(':scope > input[data-part]');
    if(input){input.disabled=p.IsEnabled===false||p.IsEnabled===0;input.tabIndex=p.IsTabStop===false?-1:p.TabIndex??0;const label=p.Header??((['Button','HyperlinkButton','MenuFlyoutItem','CheckBox'].includes(suffix(n.type))&&p.Content!=null)?null:p.Name);if(label)input.setAttribute('aria-label',String(label));else input.removeAttribute('aria-label');}
    if(p.IsEnabled===false)e.setAttribute('aria-disabled','true');else e.removeAttribute('aria-disabled');
  }
  renderTransform(n,e){const ref=n.properties.RenderTransform?.$ref,t=ref?this.nodes.get(ref):null,p=t?.properties??{},kind=t?suffix(t.type):'';let transform='';const translate=(x,y)=>`translate(${number(x)}px, ${number(y)}px)`,scale=(x,y)=>`scale(${number(x,1)}, ${number(y,1)})`,rotate=a=>`rotate(${number(a)}deg)`,skew=(x,y)=>`skew(${number(x)}deg, ${number(y)}deg)`;
    if(kind==='TranslateTransform')transform=translate(p.X,p.Y);
    else if(kind==='ScaleTransform')transform=scale(p.ScaleX,p.ScaleY);
    else if(kind==='RotateTransform')transform=rotate(p.Angle);
    else if(kind==='SkewTransform')transform=skew(p.AngleX,p.AngleY);
    else if(kind==='CompositeTransform')transform=[translate(p.TranslateX,p.TranslateY),rotate(p.Rotation),skew(p.SkewX,p.SkewY),scale(p.ScaleX,p.ScaleY)].join(' ');
    e.style.transform=transform;e.style.transformOrigin=t?`${number(p.CenterX)}px ${number(p.CenterY)}px`:'';
  }
  renderWrapPanel(n,e){const p=n.properties,s=e.style,children=this.children(n,'Children'),horizontal=p.Orientation===1,first=children[0],cellWidth=Number.isFinite(p.ItemWidth)?Math.max(1,p.ItemWidth):Math.max(1,first?.offsetWidth||100),cellHeight=Number.isFinite(p.ItemHeight)?Math.max(1,p.ItemHeight):Math.max(1,first?.offsetHeight||32);s.display=p.Visibility===1?'none':'grid';s.alignContent='start';s.justifyContent='start';s.gridAutoFlow=horizontal?'row':'column';
    const available=horizontal?(Number.isFinite(p.Width)?p.Width:e.clientWidth||this.root.clientWidth):(Number.isFinite(p.Height)?p.Height:e.clientHeight||this.root.clientHeight),automatic=Math.max(1,Math.floor(available/(horizontal?cellWidth:cellHeight))),limit=p.MaximumRowsOrColumns>0?Math.min(p.MaximumRowsOrColumns,automatic):automatic,count=Math.min(10000,Math.max(1,limit));
    s.gridTemplateColumns=horizontal?`repeat(${count}, ${cellWidth}px)`:'';s.gridTemplateRows=horizontal?'':`repeat(${count}, ${cellHeight}px)`;s.gridAutoColumns=cellWidth+'px';s.gridAutoRows=cellHeight+'px';this.ordered(e,children);
    for(const child of children){const data=this.nodes.get(child.dataset.sfId)?.properties??{},row=n.type.endsWith('VariableSizedWrapGrid')?Math.max(1,data.WrapRowSpan||1):1,col=n.type.endsWith('VariableSizedWrapGrid')?Math.max(1,data.WrapColumnSpan||1):1;child.style.gridRow=`span ${horizontal?row:Math.min(row,count)}`;child.style.gridColumn=`span ${horizontal?Math.min(col,count):col}`;}
  }
  renderNode(n,e){const p=n.properties,actual=suffix(n.type),t=actual==='AutoSuggestBox'?'TextBox':actual==='AppBarButton'?'Button':actual==='RadioButton'?'CheckBox':actual;this.layout(n,e);
    if(n.templateRoot){this.ordered(e,[this.ensure(n.templateRoot)].filter(Boolean));return;}
    if(this.renderExtended(n,e))return;
    if(t==='Window'){e.setAttribute('aria-label',p.Title??'Application window');e.setAttribute('role','group');this.content(e,p.Content);return;}
    if(t==='StackPanel'){e.style.display=p.Visibility===1?'none':'flex';e.style.flexDirection=p.Orientation===1?'row':'column';e.style.gap=number(p.Spacing)+'px';this.ordered(e,this.children(n,'Children'));}
    else if(['WrapGrid','VariableSizedWrapGrid','ItemsWrapGrid'].includes(t)){this.renderWrapPanel(n,e);}
    else if(t==='Grid'){e.style.display=p.Visibility===1?'none':'grid';const tracks=property=>(n.collections[property]??[]).map(v=>gridLength(this.nodes.get(v.$ref)?.properties[property==='RowDefinitions'?'Height':'Width']));e.style.gridTemplateRows=tracks('RowDefinitions').join(' ')||'1fr';e.style.gridTemplateColumns=tracks('ColumnDefinitions').join(' ')||'1fr';e.style.rowGap=number(p.RowSpacing)+'px';e.style.columnGap=number(p.ColumnSpacing)+'px';this.ordered(e,this.children(n,'Children'));}
    else if(t==='Canvas'||t==='Panel'){e.style.position='relative';const children=this.children(n,'Children');const layer=this.surfaces.get(n.id)?.canvas??this.surfaces.get(n.id)?.domLayer;this.ordered(e,[...(layer?[layer]:[]),...children]);}
    else if(t==='Border'){this.content(e,p.Child);}
    else if(t==='TextBlock'){this.content(e,p.Text);e.style.whiteSpace=p.TextWrapping===0?'pre':'pre-wrap';e.style.overflowWrap=p.TextWrapping===0?'normal':'anywhere';e.style.textAlign=['left','center','right','justify','start'][p.TextAlignment??0];e.style.userSelect=p.IsTextSelectionEnabled===false?'none':'text';}
    else if(t==='TextBox'||t==='PasswordBox'){const value=String(p[t==='PasswordBox'?'Password':'Text']??'');if(e.value!==value)e.value=value;e.placeholder=p.PlaceholderText??'';e.readOnly=!!p.IsReadOnly;if(p.MaxLength>0)e.maxLength=p.MaxLength;else e.removeAttribute('maxlength');}
    else if(t==='Button'||t==='ContentControl'||t==='Page'||t==='UserControl'||t==='ComboBoxItem'||t==='ListViewItem'||t==='NavigationViewItem'){this.content(e,p.Content);}
    else if(t==='HyperlinkButton'){this.content(e,p.Content);const url=safeUrl(p.NavigateUri);if(url){e.href=url;e.target='_blank';e.rel='noopener noreferrer';}else e.removeAttribute('href');}
    else if(t==='CheckBox'||t==='ToggleSwitch'){const input=e.firstChild;input.checked=!!p[t==='CheckBox'?'IsChecked':'IsOn'];this.content(e.lastChild,t==='CheckBox'?p.Content:p.Header??(input.checked?p.OnContent:p.OffContent));}
    else if(t==='Slider'){e.min=number(p.Minimum);e.max=number(p.Maximum,100);e.step=p.StepFrequency>0?p.StepFrequency:'any';if(Number(e.value)!==p.Value)e.value=number(p.Value);e.style.writingMode=p.Orientation===0?'vertical-lr':'';e.setAttribute('aria-valuenow',e.value);}
    else if(t==='ProgressBar'){e.max=number(p.Maximum,100);if(p.IsIndeterminate)e.removeAttribute('value');else e.value=number(p.Value);}
    else if(t==='ProgressRing'){e.hidden=p.IsActive===false;e.classList.toggle('indeterminate',p.IsIndeterminate!==false);e.setAttribute('aria-valuenow',String(number(p.Value)));}
    else if(t==='ComboBox'){const items=n.collections.Items??[];const options=[...e.options];items.forEach((v,i)=>{const op=options[i]??this.document.createElement('option');if(!options[i])e.append(op);const data=v?.$ref?this.nodes.get(v.$ref)?.properties.Content:v;op.textContent=data==null?'':String(data);op.value=String(i);});for(let i=items.length;i<options.length;i++)options[i].remove();e.selectedIndex=Number.isInteger(p.SelectedIndex)?p.SelectedIndex:-1;}
    else if(t==='ListView'||t==='NavigationView'){const property=t==='ListView'?'Items':'MenuItems',items=n.collections[property]??[],children=[];for(let i=0;i<items.length;i++){const item=items[i],child=item?.$ref?this.ensure(item.$ref):(e.children[i]??this.document.createElement('div'));if(!item?.$ref)this.content(child,item);child.dataset.selectionOwner=n.id;child.dataset.selectionIndex=i;child.setAttribute('role','option');child.tabIndex=0;child.setAttribute('aria-selected',String(p.SelectedIndex===i));children.push(child);}if(t==='NavigationView'&&p.Content?.$ref){const content=this.ensure(p.Content.$ref);if(content)children.push(content);}this.ordered(e,children);}
    else if(t==='ScrollViewer'){this.content(e,p.Content);e.style.overflowX=['hidden','auto','hidden','scroll'][p.HorizontalScrollBarVisibility??1];e.style.overflowY=['hidden','auto','hidden','scroll'][p.VerticalScrollBarVisibility??1];}
    else if(t==='Image'){const src=safeUrl(p.Source,{image:true});if(src)e.src=src;else e.removeAttribute('src');e.alt=p.AlternativeText??p.Name??'';}
    else if(t==='Expander'){e.open=!!p.IsExpanded;this.content(e.firstChild,p.Header);this.content(e.lastChild,p.Content);}
    else if(t==='MenuFlyout'){this.ordered(e,this.children(n,'Items'));e.classList.add('sf-winui-flyout');}
    else if(t==='MenuFlyoutItem'){this.content(e,p.Text);e.setAttribute('role','menuitem');}
    else if(['Rectangle','Ellipse','Line'].includes(t)){e.style.position='absolute';e.style.left=number(p.Left)+'px';e.style.top=number(p.Top)+'px';e.style.background=cssColor(p.Fill);e.style.borderColor=cssColor(p.Stroke);e.style.borderWidth=number(p.StrokeThickness,1)+'px';e.style.borderStyle=p.Stroke?'solid':'none';e.style.borderRadius=t==='Ellipse'?'50%':`${number(p.RadiusX)}px / ${number(p.RadiusY)}px`;if(t==='Line'){const x1=number(p.X1),x2=number(p.X2),y1=number(p.Y1),y2=number(p.Y2);e.style.left=number(p.Left)+(x1+x2)/2-Math.hypot(x2-x1,y2-y1)/2+'px';e.style.top=number(p.Top)+(y1+y2)/2-number(p.StrokeThickness,1)/2+'px';e.style.width=Math.hypot(x2-x1,y2-y1)+'px';e.style.height=number(p.StrokeThickness,1)+'px';e.style.border='none';e.style.background=cssColor(p.Stroke);e.style.transform=`rotate(${Math.atan2(y2-y1,x2-x1)}rad)`;}}
  }
  renderExtended(n,e){const p=n.properties,t=suffix(n.type),d=this.document;
    if(t==='ToggleButton'){this.content(e,p.Content);e.setAttribute('aria-pressed',String(!!p.IsChecked));e.classList.toggle('selected',!!p.IsChecked);return true;}
    if(t==='RadioButton'){e.firstChild.name=p.GroupName||'sf-radio';return false;}
    if(t==='AppBarButton'){this.content(e,p.Content??p.Label);return true;}
    if(t==='ContentPresenter'||t==='Viewbox'||t==='ToolTip'){this.content(e,p.Content);if(t==='ToolTip'){e.hidden=p.IsOpen===false;e.setAttribute('role','tooltip');}if(t==='Viewbox'){e.style.overflow='hidden';const child=e.firstElementChild;if(child){const w=child.offsetWidth,h=child.offsetHeight,aw=e.clientWidth,ah=e.clientHeight;if(w&&h&&aw&&ah){let sx=aw/w,sy=ah/h;if(p.Stretch===0)sx=sy=1;else if(p.Stretch!==1)sx=sy=(p.Stretch===3?Math.max:Math.min)(sx,sy);child.style.transformOrigin='0 0';child.style.transform=`scale(${sx}, ${sy})`;}}}return true;}
    if(t==='NumberBox'){e.min=number(p.Minimum,-1e9);e.max=number(p.Maximum,1e9);e.step=number(p.SmallChange,1);if(Number(e.value)!==p.Value||e.value==='')e.value=number(p.Value);e.readOnly=!!p.IsReadOnly;e.placeholder=p.PlaceholderText??'';return true;}
    if(t==='CalendarDatePicker'||t==='TimePicker'){const value=p[t==='TimePicker'?'Time':'Date']??'';if(e.value!==value)e.value=value;e.setAttribute('aria-label',String(p.Header??p.Name??t));return true;}
    if(t==='Separator'){e.setAttribute('role','separator');e.style.height=Number.isFinite(p.Height)?p.Height+'px':'1px';e.style.background=p.Background?cssColor(p.Background):'var(--winui-border,#666)';return true;}
    if(t==='CommandBar'){e.style.display=p.Visibility===1?'none':'flex';e.style.gap='6px';this.ordered(e,this.children(n,'Children'));e.setAttribute('role','toolbar');return true;}
    if(t==='InfoBar'){e.hidden=!p.IsOpen;e.setAttribute('role',p.Severity>=2?'alert':'status');e.dataset.severity=String(p.Severity??0);if(!e.querySelector('[data-info-title]')){e.replaceChildren();const title=d.createElement('b'),message=d.createElement('span'),close=d.createElement('button'),content=d.createElement('div');title.dataset.infoTitle='';message.dataset.infoMessage='';close.dataset.uiAction='info-close';close.type='button';close.textContent='×';close.setAttribute('aria-label','Close notification');content.dataset.infoContent='';e.append(title,message,close,content);}e.querySelector('[data-info-title]').textContent=p.Title??'';e.querySelector('[data-info-message]').textContent=p.Message??'';e.querySelector('button').hidden=!p.IsClosable;this.content(e.querySelector('[data-info-content]'),p.Content);return true;}
    if(t==='TabView'){if(!e.querySelector(':scope > [data-tab-headers]')){const header=d.createElement('div'),body=d.createElement('div');header.dataset.tabHeaders='';header.setAttribute('role','tablist');body.dataset.tabBody='';e.replaceChildren(header,body);}const header=e.firstChild,body=e.lastChild,items=n.collections.TabItems??[],heads=[],tabs=[];items.forEach((v,i)=>{const item=this.nodes.get(v.$ref),tab=this.ensure(v.$ref);if(!tab)return;let h=[...header.children].find(x=>x.dataset.tabId===v.$ref);if(!h){h=d.createElement('button');h.type='button';h.dataset.tabId=v.$ref;}h.dataset.selectionOwner=n.id;h.dataset.selectionIndex=i;h.setAttribute('role','tab');h.setAttribute('aria-selected',String(p.SelectedIndex===i));h.textContent=String(item?.properties.Header??'Tab '+(i+1));tab.hidden=p.SelectedIndex!==i;tab.setAttribute('role','tabpanel');heads.push(h);if(item?.properties.IsClosable!==false){let close=[...header.children].find(x=>x.dataset.closeTab===v.$ref);if(!close){close=d.createElement('button');close.type='button';close.dataset.closeTab=v.$ref;close.textContent='×';}close.setAttribute('aria-label','Close '+String(item?.properties.Header??'tab'));heads.push(close);}tabs.push(tab);});this.ordered(header,heads);this.ordered(body,tabs);return true;}
    if(t==='TabViewItem'){this.content(e,p.Content);return true;}
    if(t==='ContentDialog'){e.hidden=!p.IsOpen;e.setAttribute('role','dialog');e.setAttribute('aria-modal','true');if(!e.querySelector('[data-dialog-content]')){const title=d.createElement('h2'),content=d.createElement('div'),buttons=d.createElement('div');title.dataset.dialogTitle='';content.dataset.dialogContent='';buttons.dataset.dialogButtons='';e.replaceChildren(title,content,buttons);for(const action of ['Primary','Secondary','Close']){const b=d.createElement('button');b.type='button';b.dataset.uiAction='dialog-'+action;buttons.append(b);}}e.querySelector('h2').textContent=String(p.Title??'');this.content(e.querySelector('[data-dialog-content]'),p.Content);for(const b of e.querySelectorAll('[data-ui-action]')){const text=p[b.dataset.uiAction.slice(7)+'ButtonText'];b.textContent=text??'';b.hidden=!text;}return true;}
    return false;
  }
  reachable(){const result=new Set(),queue=[...this.windows,...this.openFlyouts.keys()];while(queue.length){const id=queue.shift();if(result.has(id))continue;const n=this.nodes.get(id);if(!n)continue;result.add(id);if(n.templateRoot)queue.push(n.templateRoot);for(const [key,v]of Object.entries(n.properties))if(!['Style','Template','VisualTree'].includes(key)&&v?.$ref)queue.push(v.$ref);for(const values of Object.values(n.collections))for(const v of values)if(v?.$ref)queue.push(v.$ref);}return result;}
  render(){this.geometryUpdates.render();}
  drawNode(n){const t=suffix(n.type);if(t!=='Canvas'&&t!=='DrawingSurface')return;const container=this.elements.get(n.id);let primitives=[];
    if(t==='DrawingSurface')primitives=drawingPrimitives(n.drawing??[]);
    else for(const value of n.collections.Children??[]){const node=this.nodes.get(value.$ref);if(!node||node.properties.Visibility===1||!['Rectangle','Ellipse','Line'].includes(suffix(node.type)))continue;const p=node.properties,kind=suffix(node.type),element=this.elements.get(node.id),w=number(p.Width,element?.clientWidth??0),h=number(p.Height,element?.clientHeight??0),x=number(p.Left),y=number(p.Top),stroke=number(p.StrokeThickness,1);
      if(shapeUsesDomPaint(node,element))continue;
      element.style.background='transparent';element.style.borderColor='transparent';
      if(kind==='Line'){primitives.push(...drawingPrimitives([{op:'DrawLine',args:[x+number(p.X1),y+number(p.Y1),x+number(p.X2),y+number(p.Y2),stroke,p.Stroke]}]));continue;}
      const shape=kind==='Ellipse'?1:0;if(p.Stroke&&stroke>0)primitives.push({x,y,w,h,color:parseColor(p.Stroke),kind:shape,angle:0});if(p.Fill){const inset=p.Stroke?stroke:0;primitives.push({x:x+inset,y:y+inset,w:Math.max(0,w-inset*2),h:Math.max(0,h-inset*2),color:parseColor(p.Fill),kind:shape,angle:0});}
    }
    let surface=this.surfaces.get(n.id);if(!surface){surface=new RenderSurface(container,{backend:this.backend,gpu:this.options.gpu,onMetrics:m=>this.options.onMetrics({id:n.id,...m})});this.surfaces.set(n.id,surface);}surface.update(primitives,container.clientWidth||number(n.properties.Width,400),container.clientHeight||number(n.properties.Height,240),this.document.defaultView.devicePixelRatio??1);
  }
  emit(n,event,payload={}){if(!n.events.includes(event)&&!['TextChanged','PasswordChanged','ValueChanged','SelectionChanged','Checked','Unchecked','Toggled','Expanding','Collapsed','DateChanged','TimeChanged','Closed','PrimaryButtonClick','SecondaryButtonClick','CloseButtonClick'].includes(event))return;try{this.options.onEvent(n.id,event,payload);}catch(e){this.options.onError(e);}}
  handleEvent(type,event){if(this.root.classList.contains('debug-paused'))return;const close=event.target.closest?.('[data-close-tab]');if(type==='click'&&close){const tab=this.nodes.get(close.dataset.closeTab);if(tab)this.emit(tab,'CloseRequested');return;}if(type==='keydown'&&['Enter',' '].includes(event.key)&&event.target.matches('[role=option]')){event.preventDefault();event.target.click();return;}const selection=event.target.closest?.('[data-selection-owner]');if(type==='click'&&selection){const n=this.nodes.get(selection.dataset.selectionOwner);if(n){n.properties.SelectedIndex=+selection.dataset.selectionIndex;this.emit(n,'SelectionChanged',{value:n.properties.SelectedIndex});this.schedule();}}
    let element=event.target.closest?.('[data-sf-id]');if(type==='click'&&element){const button=element.closest('button[data-sf-id]');if(button&&this.root.contains(button))element=button;}if(!element||!this.root.contains(element))return;let n=this.nodes.get(element.dataset.sfId);if(!n)return;if(n.templateOwner){const owner=this.nodes.get(n.templateOwner);if(owner&&(type==='click'||n.templateBindings?.Text==='Text'||n.templateBindings?.Value==='Value'))n=owner;}const actual=suffix(n.type),t=actual==='AutoSuggestBox'?'TextBox':actual==='AppBarButton'?'Button':actual==='RadioButton'?'CheckBox':actual,p=n.properties;if(p.IsEnabled===false||p.IsEnabled===0||p.IsHitTestVisible===false||p.IsHitTestVisible===0)return;
    const action=event.target.closest?.('[data-ui-action]')?.dataset.uiAction;
    if(type==='click'&&action==='info-close'){p.IsOpen=false;this.emit(n,'Closed');this.schedule();return;}
    if(type==='click'&&action?.startsWith('dialog-')){p.IsOpen=false;this.emit(n,action.slice(7)+'ButtonClick');this.schedule();return;}
    if(type==='click'&&t==='ToggleButton'){p.IsChecked=!p.IsChecked;this.emit(n,'Click');this.emit(n,p.IsChecked?'Checked':'Unchecked',{value:p.IsChecked});this.schedule();return;}
    if(type==='input'&&t==='NumberBox'){const v=Number(event.target.value);if(Number.isFinite(v)){p.Value=Math.max(number(p.Minimum,-1e9),Math.min(number(p.Maximum,1e9),v));this.emit(n,'ValueChanged',{value:p.Value});}return;}
    if(type==='change'&&(t==='CalendarDatePicker'||t==='TimePicker')){const prop=t==='TimePicker'?'Time':'Date';p[prop]=event.target.value;this.emit(n,prop+'Changed',{value:event.target.value});return;}
    if(type==='keydown'&&actual==='AutoSuggestBox'&&event.key==='Enter'){this.emit(n,'QuerySubmitted');return;}
    if(type==='click'){if(t==='Button'||t==='HyperlinkButton'||t==='MenuFlyoutItem'||t==='CheckBox')this.emit(n,'Click');if(p.Flyout?.$ref)this.flyout({id:p.Flyout.$ref,anchor:n.id,show:true});if(t==='MenuFlyoutItem')this.hideFlyouts();}
    if(type==='toggle'&&t==='Expander'&&!!p.IsExpanded!==!!event.target.open){p.IsExpanded=event.target.open;this.emit(n,event.target.open?'Expanding':'Collapsed',{value:event.target.open});}
    if(type==='contextmenu'&&p.ContextFlyout?.$ref){event.preventDefault();this.flyout({id:p.ContextFlyout.$ref,anchor:n.id,show:true});}
    if(type==='input'&&(t==='TextBox'||t==='PasswordBox')){const key=t==='TextBox'?'Text':'Password';p[key]=event.target.value;this.emit(n,t==='TextBox'?'TextChanged':'PasswordChanged',{value:event.target.value});}
    if(type==='input'&&t==='Slider'){p.Value=Number(event.target.value);this.emit(n,'ValueChanged',{value:p.Value});}
    if(type==='change'&&(t==='CheckBox'||t==='ToggleSwitch')){const value=event.target.checked;if(actual==='RadioButton'&&value){for(const other of this.nodes.values())if(other.id!==n.id&&suffix(other.type)==='RadioButton'&&(other.properties.GroupName??'')===(p.GroupName??'')&&other.properties.IsChecked){other.properties.IsChecked=false;this.emit(other,'Unchecked',{value:false});}}p[t==='CheckBox'?'IsChecked':'IsOn']=value;this.emit(n,t==='ToggleSwitch'?'Toggled':value?'Checked':'Unchecked',{value});}
    if(type==='change'&&t==='ComboBox'){p.SelectedIndex=event.target.selectedIndex;this.emit(n,'SelectionChanged',{value:p.SelectedIndex});}
  }
  flyout({id,anchor,show}){const e=this.ensure(id);if(!e)return;if(!show){e.hidden=true;this.openFlyouts.delete(id);return;}this.openFlyouts.set(id,anchor);const n=this.nodes.get(id);this.renderNode(n,e);const target=this.elements.get(anchor);if(!target)return;const rect=target.getBoundingClientRect(),root=this.root.getBoundingClientRect();this.root.append(e);Object.assign(e.style,{position:'absolute',left:Math.max(0,rect.left-root.left)+'px',top:Math.max(0,rect.bottom-root.top)+'px',zIndex:'100'});e.hidden=false;e.querySelector('button')?.focus();}
  hideFlyouts(){this.openFlyouts.clear();for(const e of this.elements.values())if(e.classList.contains('sf-winui-flyout'))e.hidden=true;}
  flush(){if(this.frame){(this.document.defaultView.cancelAnimationFrame??clearTimeout)(this.frame);this.frame=0;}this.render();}
  async settled(){this.flush();await Promise.all([...this.surfaces.values()].map(s=>s.ready));this.flush();}
  dispose(){this.disposed=true;if(this.frame)(this.document.defaultView.cancelAnimationFrame??clearTimeout)(this.frame);this.resizeObserver?.disconnect();this.geometryUpdates.dispose();for(const [type,listener]of this.listeners)this.root.removeEventListener(type,listener,type==='toggle');this.root.removeEventListener('keydown',this.onKey);for(const s of this.surfaces.values())s.dispose();this.surfaces.clear();this.nodes.clear();this.elements.clear();this.root.replaceChildren();}
}
