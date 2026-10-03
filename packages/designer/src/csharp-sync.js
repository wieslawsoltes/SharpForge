import {parse,lex} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {frameworkType,canonicalType,enumValue,colorValues,XAML,CONTROLS,MEDIA} from '@sharpforge/framework';
import {validateDesign,propertySchema,childSlot,normalizeProperty} from './model.js';
import {generateDesignCode,csharpValue} from './codegen.js';

const clone=x=>structuredClone(x),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const path=n=>n?.kind==='Name'?n.name:n?.kind==='Member'&&path(n.target)?path(n.target)+'.'+n.name:null;
const reference=(name)=>({ref:name});
const symbol=id=>'v_'+id.replace(/[^A-Za-z0-9_]/g,'_');
export class DesignSyncError extends Error{constructor(message,code='SFSYNC',span=null){super(message);this.name='DesignSyncError';this.code=code;this.span=span;}}
const fail=(m,n,code)=>{throw new DesignSyncError(m,code,n?{start:n.start,end:n.end}:null);};
const brush=color=>({valueType:MEDIA+'SolidColorBrush',Color:color});
function decodeColor(hex){let h=hex.slice(1);if(h.length===6)h='ff'+h;return {valueType:'Windows.UI.Color',A:parseInt(h.slice(0,2),16),R:parseInt(h.slice(2,4),16),G:parseInt(h.slice(4,6),16),B:parseInt(h.slice(6,8),16)};}
function allMethods(root){return root.members.flatMap(c=>c.kind==='Class'?c.members.filter(m=>m.kind==='Method').map(method=>({method,owner:c})):c.kind==='Method'?[{method:c,owner:null}]:[]);}
function isUI(type){return ['control','shape','window'].includes(frameworkType(type)?.kind);}
function comments(text){return lex(new SourceText(text)).tokens.flatMap(t=>(t.green.leading.match(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g)??[]));}
function idFor(name){return name.startsWith('v_')?name.slice(2):name.replace(/[^A-Za-z0-9_]/g,'_');}
function applyTextEdits(text,edits){const ordered=[...edits].sort((a,b)=>b.start-a.start||b.end-a.end);let right=text.length+1;for(const e of ordered){if(e.start<0||e.end<e.start||e.end>text.length||e.end>right)fail('Overlapping or invalid C# source edits');text=text.slice(0,e.start)+e.text+text.slice(e.end);right=e.start;}return text;}
/** Read a declarative construction method without executing it. Unmanaged expressions are retained and locked. */
export function readDesignSource(text,{uri='DesignedView.g.cs',methodName=null,previous=null,maxBytes=2_000_000}={}){
  if(typeof text!=='string'||text.length>maxBytes)fail('C# design source size limit exceeded');
  const parsed=parse(new SourceText(text,uri));if(parsed.diagnostics.some(d=>d.severity==='error'))fail(parsed.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('\n'),null,'SFSYNC_PARSE');
  const methods=allMethods(parsed.root),candidates=methods.filter(x=>!methodName||x.method.name===methodName),chosen=candidates.find(x=>x.method.name==='Create')??candidates.find(x=>x.method.name==='InitializeComponent')??candidates.find(x=>x.method.name==='Main')??candidates.find(x=>x.method.body?.statements?.some(s=>s.kind==='Local'&&s.declarations.some(d=>isUI(d.initializer?.type))));
  if(!chosen)fail('Select a C# file with a declarative Create, InitializeComponent or Main method');
  const {method,owner}=chosen;if(method.body.kind!=='Block')fail('A block-bodied construction method is required',method);
  const env=new Map(),nodes=[],bindings={},styles={},templates={},unmanaged=[],warnings=[],resources=new Map(),templateMethods=new Map(),explicitResourceTypes=new Set();let rootName=null;
  const fields=new Set((owner?.members??[]).filter(f=>f.kind==='Field').map(f=>f.name));
  const previousNodes=new Map((previous?.nodes??[]).map(n=>[n.id,n]));
  function lookup(n){const key=path(n);if(env.has(key))return env.get(key);if(key&&owner&&key.startsWith(owner.name+'.')&&env.has(key.slice(owner.name.length+1)))return env.get(key.slice(owner.name.length+1));if(key?.startsWith('this.')&&env.has(key.slice(5)))return env.get(key.slice(5));return undefined;}
  function constant(n){
    if(!n)fail('Missing expression',n);if(n.kind==='Literal')return n.value;
    if(n.kind==='Unary'&&['-','+','!','~'].includes(n.operator)){const v=constant(n.operand);return n.operator==='-'?-v:n.operator==='+'?+v:n.operator==='!'?!v:~v;}
    if(n.kind==='Checked'||n.kind==='Unchecked'||n.kind==='Cast')return constant(n.expression);
    if(n.kind==='Binary'){const a=constant(n.left),b=constant(n.right);switch(n.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;default:fail('Unsupported constant operator '+n.operator,n);}}
    const existing=lookup(n);if(existing!==undefined)return existing;
    const en=enumValue(path(n));if(en)return en.value;
    if(n.kind==='Member'&&['Colors','Microsoft.UI.Colors'].includes(path(n.target))&&colorValues[n.name])return decodeColor(colorValues[n.name]);
    if(n.kind==='Member'&&frameworkType(path(n.target))?.name===XAML+'GridLength'&&n.name==='Auto')return {valueType:XAML+'GridLength',Value:0,GridUnitType:0};
    if(n.kind==='Member'&&n.name.endsWith('Property')&&frameworkType(path(n.target)))return {dependencyProperty:n.name.slice(0,-8),owner:canonicalType(path(n.target))};
    if(n.kind==='New'){
      const t=canonicalType(n.type),a=n.args.map(constant);let value;
      if(t===XAML+'Thickness'||t===XAML+'CornerRadius'){const keys=t.endsWith('Thickness')?['Left','Top','Right','Bottom']:['TopLeft','TopRight','BottomRight','BottomLeft'];if(a.length!==1&&a.length!==4)fail('Unsupported value constructor',n);value={valueType:t,...Object.fromEntries(keys.map((k,i)=>[k,a.length===1?a[0]:a[i]]))};}
      else if(t===XAML+'GridLength')value={valueType:t,Value:a[0],GridUnitType:a[1]??1};
      else if(t===MEDIA+'SolidColorBrush')value=brush(a[0]??decodeColor('#00000000'));
      else if(t===XAML+'Setter'){if(!a[0]?.dependencyProperty)fail('A static dependency-property identifier is required',n);value={setter:a[0].dependencyProperty,value:a[1],targetType:a[0].owner};}
      else if([CONTROLS+'RowDefinition',CONTROLS+'ColumnDefinition'].includes(t))value={definition:t};
      else fail('Expression is not a supported constant value',n);
      for(const p of n.initializers??[])value[p.name]=constant(p.expression);return value;
    }
    if(n.kind==='Call'&&['Color.FromArgb','Windows.UI.Color.FromArgb'].includes(path(n.target))){const a=n.args.map(constant);return {valueType:'Windows.UI.Color',A:a[0],R:a[1],G:a[2],B:a[3]};}
    fail('Dynamic expression is preserved in C# and is not evaluated by the designer',n,'SFSYNC_DYNAMIC');
  }
  function bindProperty(binding,key,expression,statement,initializer=null){const n=nodes.find(n=>n.id===binding.id);try{const value=constant(expression);if(value?.ref){const child=env.get(value.ref);if(child?.node&&childSlot(n.type)?.property===key){n.children=[child.node];binding.edges.push({statement,expression,key});return;}if(resources.has(value.ref)){const r=resources.get(value.ref);if(key==='Style')n.style=r.key;else if(key==='Template')n.template=r.key;else fail('Unsupported resource assignment',expression);binding.properties[key]={expression,statement,initializer};return;}fail('Object reference is not a scalar design value',expression);}if(childSlot(n.type)?.property===key&&value===null)n.children=[];n.properties[key]=normalizeProperty(n.type,key,value);binding.properties[key]={expression,statement,initializer};}catch(e){if(!(e instanceof DesignSyncError||e instanceof TypeError))throw e;binding.properties[key]={expression,statement,initializer,dynamic:true};const previous=previousNodes.get(n.id);if(previous&&Object.hasOwn(previous.properties,key))n.properties[key]=clone(previous.properties[key]);warnings.push({code:'SFSYNC_DYNAMIC',node:n.id,property:key,message:e.message,start:expression.start,end:expression.end});}}
  function declaration(name,expression,statement){
    if(expression?.kind==='New'&&isUI(expression.type)){const type=canonicalType(expression.type),id=idFor(name);if(bindings[id])fail('Ambiguous duplicate control variable '+name,expression);const binding={id,name,statement,creation:expression,properties:{},events:{},edges:[],field:fields.has(name)};
      const n={id,type,properties:{},children:[],events:{}};nodes.push(n);bindings[id]=binding;env.set(name,{node:id,ref:name});
      if(expression.args.length)unmanaged.push({statement,message:'Control constructors with arguments are not regenerated'});
      for(const p of expression.initializers??[])bindProperty(binding,p.name,p.expression,statement,p);return true;
    }
    const t=canonicalType(expression?.type);
    if(expression?.kind==='New'&&t===XAML+'Style'){const key=name.replace(/^style_/,'');let targetType=CONTROLS+'Button';if(expression.args.length){if(expression.args.length!==1)fail('Unsupported Style constructor',expression);targetType=canonicalType(constant(expression.args[0]));if(!frameworkType(targetType))fail('Style target type must be a supported constant',expression);explicitResourceTypes.add(key);}styles[key]={targetType,setters:{}};resources.set(name,{kind:'style',key});env.set(name,reference(name));for(const p of expression.initializers??[]){if(p.name==='BasedOn'){const r=constant(p.expression);styles[key].basedOn=resources.get(r.ref)?.key;}else unmanaged.push({statement,message:'Unsupported Style initializer '+p.name});}return true;}
    if(expression?.kind==='Call'&&methods.some(m=>m.method.name===path(expression.target))){const nameMethod=path(expression.target),tm=methods.find(m=>m.method.name===nameMethod);try{const t=parseTemplate(tm.method);const key=name.replace(/^template_/,'');templates[key]=t;resources.set(name,{kind:'template',key});env.set(name,reference(name));templateMethods.set(key,tm.method);return true;}catch(e){unmanaged.push({statement,message:e.message});return false;}}
    try{env.set(name,constant(expression));return true;}catch(e){unmanaged.push({statement,message:e.message});return false;}
  }
  function parseTemplate(tm){const parts=new Map(),vars=new Map();let templateVar=null,root=null,targetType=CONTROLS+'Button';
    const get=x=>vars.get(path(x));const attach=(parent,key,value)=>{if(childSlot(parent.type)?.property===key){if(value?.part)parent.children.push(parts.get(value.part));else fail('Template child is not a part',tm);}else parent.properties[key]=constant(value);};
    for(const s of tm.body.statements){if(s.kind==='Return')continue;if(s.kind==='Local'){for(const d of s.declarations){if(d.initializer?.kind==='New'&&canonicalType(d.initializer.type)===CONTROLS+'ControlTemplate'){templateVar=d.name;continue;}if(d.initializer?.kind!=='New'||!isUI(d.initializer.type))fail('Custom template code is preserved but cannot be regenerated',s);const part={id:idFor(d.name),type:canonicalType(d.initializer.type),properties:{},bindings:{},children:[]};for(const p of d.initializer.initializers??[])part.properties[p.name]=constant(p.expression);parts.set(d.name,part);vars.set(d.name,{part:d.name});}continue;}
      const e=s.expression;if(e?.kind==='Assignment'&&e.operator==='='){const v=get(e.left.target);if(v){const part=parts.get(v.part),child=get(e.right);if(child)attach(part,e.left.name,child);else part.properties[e.left.name]=constant(e.right);continue;}if(path(e.left.target)===templateVar&&e.left.name==='VisualTree'){root=parts.get(get(e.right)?.part);continue;}}
      if(e?.kind==='Call'){const target=path(e.target);if(target===templateVar+'.Bind'){const part=parts.get(get(e.args[0])?.part),dp=constant(e.args[2]);if(!part||!dp.dependencyProperty)fail('Invalid template binding',e);part.bindings[constant(e.args[1])]=dp.dependencyProperty;targetType=dp.owner;continue;}if(e.target.kind==='Member'&&e.target.name==='Add'&&e.target.target.kind==='Member'){const parent=parts.get(get(e.target.target.target)?.part),child=parts.get(get(e.args[0])?.part);if(parent&&child){parent.children.push(child);continue;}}}
      fail('Custom template code is preserved but cannot be regenerated',s);
    }if(!root)fail('Template VisualTree is missing',tm);return {targetType,root};
  }
  for(const statement of method.body.statements){
    if(statement.kind==='Local'){for(const d of statement.declarations)declaration(d.name,d.initializer,statement);continue;}
    if(statement.kind==='Return'){const v=lookup(statement.expression);if(v?.node)rootName=v.node;else if(statement.expression)unmanaged.push({statement,message:'Return value is not a design object'});continue;}
    if(statement.kind==='Empty')continue;
    const e=statement.expression;
    if(e?.kind==='Assignment'){
      if(e.operator==='='&&e.right.kind==='New'&&(e.left.kind==='Name'||e.left.kind==='Member'&&(path(e.left.target)==='this'||path(e.left.target)===owner?.name))){declaration(e.left.name,e.right,statement);continue;}
      if(e.operator==='='&&e.left.kind==='Name'&&e.right.kind==='Call'&&declaration(e.left.name,e.right,statement))continue;
      const target=e.left.kind==='Member'?lookup(e.left.target):null;
      if(target?.node){const b=bindings[target.node],n=nodes.find(n=>n.id===target.node);if(e.operator==='='&&childSlot(n.type)?.property===e.left.name&&lookup(e.right)?.node){n.children=[lookup(e.right).node];b.edges.push({statement,expression:e.right,key:e.left.name});continue;}
        if(e.operator==='='){bindProperty(b,e.left.name,e.right,statement);continue;}
        if(e.operator==='+='&&path(e.right)){if(n.events[e.left.name]){unmanaged.push({statement,message:'Multiple event handlers must be edited in C#'});b.events[e.left.name]={dynamic:true};}else{n.events[e.left.name]=path(e.right);b.events[e.left.name]={expression:e.right,statement};}continue;}}
      const r=resources.get(path(e.left.target));if(r?.kind==='style'&&e.operator==='='&&e.left.name==='BasedOn'){styles[r.key].basedOn=resources.get(lookup(e.right)?.ref)?.key;continue;}
    }
    if(e?.kind==='Call'){
      const target=e.target,receiver=target.kind==='Member'?lookup(target.target):null;
      if(target.name==='Activate'&&receiver?.node){rootName=receiver.node;continue;}
      if(target.name==='Add'&&target.target?.kind==='Member'){
        const parent=lookup(target.target.target),key=target.target.name;
        if(parent?.node){const n=nodes.find(n=>n.id===parent.node),b=bindings[n.id],child=lookup(e.args[0]);if(key===childSlot(n.type)?.property&&child?.node){n.children.push(child.node);b.edges.push({statement,expression:e.args[0],key});continue;}
          if(['RowDefinitions','ColumnDefinitions'].includes(key)){try{const value=constant(e.args[0]),axis=key==='RowDefinitions'?'rows':'columns',member=axis==='rows'?'Height':'Width';(n[axis]??=[]).push(value[member]??{valueType:XAML+'GridLength',Value:1,GridUnitType:2});continue;}catch{}}
        }
        const resource=resources.get(path(target.target.target));if(resource?.kind==='style'&&key==='Setters'){try{const s=constant(e.args[0]);styles[resource.key].setters[s.setter]=s.value;if(!explicitResourceTypes.has(resource.key))styles[resource.key].targetType=s.targetType;continue;}catch{}}
      }
      if(/^Set(?:Left|Top|ZIndex|Row|Column|RowSpan|ColumnSpan)$/.test(target.name)&&['Canvas','Grid','VariableSizedWrapGrid',CONTROLS+'Canvas',CONTROLS+'Grid',CONTROLS+'VariableSizedWrapGrid'].includes(path(target.target))){const ref=lookup(e.args[0]);if(ref?.node){bindProperty(bindings[ref.node],(path(target.target).endsWith('VariableSizedWrapGrid')?'Wrap':'')+target.name.slice(3),e.args[1],statement);continue;}}
    }
    unmanaged.push({statement,message:'Custom statement is preserved; structural regeneration is disabled'});
  }
  // Constructor initializers can refer to controls declared earlier.
  if(!rootName)rootName=nodes.find(n=>n.type===XAML+'Window')?.id;
  if(!rootName)rootName=nodes.find(n=>!nodes.some(p=>p.children.includes(n.id)))?.id;
  if(!rootName)fail('No supported controls were found in the construction method');
  const reachable=new Set();function visit(id){if(reachable.has(id))return;reachable.add(id);nodes.find(n=>n.id===id)?.children.forEach(visit);}visit(rootName);
  const detached=nodes.filter(n=>!reachable.has(n.id));for(const n of detached)warnings.push({code:'SFSYNC_DETACHED',node:n.id,message:'Control is constructed but not attached to the chosen root'});
  const resultNodes=nodes.filter(n=>reachable.has(n.id));for(const n of resultNodes){if(n.children.length&&['Content','Child'].includes(childSlot(n.type)?.property))delete n.properties[childSlot(n.type).property];if(n.style&&styles[n.style]&&!explicitResourceTypes.has(n.style))styles[n.style].targetType=n.type;if(n.template&&templates[n.template])templates[n.template].targetType=n.type;}
  const window=resultNodes.find(n=>n.id===rootName),content=window.type===XAML+'Window'?resultNodes.find(n=>n.id===window.children[0]):null,width=window.properties.Width??content?.properties.Width??previous?.width??960,height=window.properties.Height??content?.properties.Height??previous?.height??640;
  const document=validateDesign({version:1,name:previous?.name??owner?.name??'CSharpView',width:Number.isFinite(width)?Math.max(100,width):960,height:Number.isFinite(height)?Math.max(100,height):640,root:rootName,nodes:resultNodes,styles,templates});
  return {text,uri,document,bindings,method,owner,methods,templateMethods,unmanaged,warnings,detached,fields,parsed,structuralEditable:unmanaged.length===0&&warnings.every(w=>w.code!=='SFSYNC_DYNAMIC')&&detached.length===0};
}

function removeInitializer(text,entry){
  const p=entry.initializer,tokens=lex(new SourceText(text)).tokens,after=tokens.find(t=>t.start>=p.expression.end),before=tokens.filter(t=>t.end<=p.start).at(-1);
  if(after?.kind===',')return {start:p.start,end:after.end,text:'',deletion:true};
  if(before?.kind===',')return {start:before.start,end:p.expression.end,text:'',deletion:true};
  return {start:p.start,end:p.expression.end,text:'',deletion:true};
}
function coalesceDeletions(text,edits,newline){const out=[];for(const e of edits.filter(e=>e.deletion).sort((a,b)=>a.start-b.start)){const last=out.at(-1);if(last&&e.start<=last.end)last.end=Math.max(e.end,last.end);else out.push({...e});}return [...edits.filter(e=>!e.deletion),...out.map(e=>({...e,text:comments(text.slice(e.start,e.end)).map(c=>c.startsWith('//')?c+newline:c).join(' ')}))];}

function generatedMethod(text,name){return allMethods(parse(text).root).find(x=>x.method.name===name)?.method;}
function renameTokens(text,names){const edits=lex(new SourceText(text)).tokens.filter(t=>t.kind==='identifier'&&names.has(t.value)).map(t=>({start:t.start,end:t.end,text:names.get(t.value)}));return applyTextEdits(text,edits);}
/** Minimal scalar edits; structural edits only replace proven declarative code, never arbitrary logic. */
export function planDesignSourceUpdate(base,design,currentText=base.text){
  if(currentText!==base.text)fail('C# changed after synchronization. Read C# changes before applying designer edits.',null,'SFSYNC_CONFLICT');
  const next=validateDesign(design),before=base.document,edits=[],names=new Map();
  for(const n of next.nodes)names.set(symbol(n.id),base.bindings[n.id]?.name??symbol(n.id));
  const structural=!same(before.nodes.map(n=>[n.id,n.type,n.children,n.rows,n.columns,n.style,n.template]),next.nodes.map(n=>[n.id,n.type,n.children,n.rows,n.columns,n.style,n.template]))||!same(before.styles,next.styles)||!same(before.templates,next.templates);
  const newline=base.text.includes('\r\n')?'\r\n':'\n';
  if(structural){
    if(!base.structuralEditable)fail('This method contains dynamic or custom statements. Property-only edits are safe; edit hierarchy/resources in C# or isolate them in a declarative Create method.',null,'SFSYNC_OWNERSHIP');
    const canonical=generateDesignCode(next,{className:base.owner?.name??'DesignedView',activate:base.method.body.statements.some(s=>s.expression?.kind==='Call'&&s.expression.target?.kind==='Member'&&s.expression.target.name==='Activate')}),generated=generatedMethod(canonical,'Create');let body=canonical.slice(generated.body.start,generated.body.end);
    // Non-Window roots are wrapped by the generator; keep the return shape of the selected method.
    if(base.method.returnType==='void')body=body.replace(/\s*return\s+\w+;\s*(?=\})/,'\n    ');
    body=renameTokens(body,names);
    const addedFields=[];for(const n of next.nodes){const name=names.get(symbol(n.id));if(base.fields.size&&!base.bindings[n.id]){addedFields.push(`    public ${base.method.modifiers?.includes('static')?'static ':''}${n.type} ${name};`);continue;}if(!base.fields.has(name))body=body.replace(new RegExp('(^|\\n)([ \\t]*)'+name+' = new '),(_,p,indent)=>p+indent+n.type+' '+name+' = new ');}
    if(addedFields.length)edits.push({start:base.method.start,end:base.method.start,text:addedFields.join(newline)+newline+'    '});
    const trivia=comments(base.text.slice(base.method.body.start,base.method.body.end));if(trivia.length)body=body.replace('{','{\n'+trivia.map(c=>'        '+c).join('\n'));
    edits.push({start:base.method.body.start,end:base.method.body.end,text:body.replace(/\r?\n/g,newline)});
    // Factories are independently owned: change only recognized factories, leave every user method intact.
    for(const [key,old]of base.templateMethods){const g=generatedMethod(canonical,'Template_'+key);edits.push({start:old.start,end:old.end,text:g?canonical.slice(g.start,g.end).replace(/\r?\n/g,newline):comments(base.text.slice(old.start,old.end)).join(newline)});}
    for(const key of Object.keys(next.templates))if(!base.templateMethods.has(key)){const g=generatedMethod(canonical,'Template_'+key);if(!base.owner)fail('Template factories require a containing class');edits.push({start:base.owner.end-1,end:base.owner.end-1,text:newline+'    '+canonical.slice(g.start,g.end).replace(/\n/g,newline)+newline});}
  }else{
    const insertions=[];
    for(const n of next.nodes){const old=before.nodes.find(x=>x.id===n.id),binding=base.bindings[n.id];
      for(const key of new Set([...Object.keys(old.properties),...Object.keys(n.properties)])){
        const had=Object.hasOwn(old.properties,key),has=Object.hasOwn(n.properties,key);if(had===has&&same(old.properties[key],n.properties[key]))continue;
        const origin=binding.properties[key];if(origin?.dynamic)fail(`'${binding.name}.${key}' is a dynamic C# expression. Edit it in C# rather than replacing user logic.`,origin.expression,'SFSYNC_DYNAMIC');
        if(!has){if(origin)edits.push(origin.initializer?removeInitializer(base.text,origin):{start:origin.statement.start,end:origin.statement.end,text:comments(base.text.slice(origin.statement.start,origin.statement.end)).join(newline)});continue;}
        const value=csharpValue(n.properties[key],propertySchema(n.type)[key].type);
        if(origin)edits.push({start:origin.expression.start,end:origin.expression.end,text:value});
        else {const p=propertySchema(n.type)[key];insertions.push(p.attached?`${CONTROLS}${key.startsWith('Wrap')?'VariableSizedWrapGrid':['Left','Top','ZIndex'].includes(key)?'Canvas':'Grid'}.Set${key.replace(/^Wrap/,'')}(${binding.name}, ${value});`:`${binding.name}.${key} = ${value};`);}
      }
      for(const key of new Set([...Object.keys(old.events),...Object.keys(n.events)])){if(old.events[key]===n.events[key])continue;const o=binding.events[key];if(o?.dynamic)fail('Multiple handlers must be edited in C#');if(o)edits.push(n.events[key]?{start:o.expression.start,end:o.expression.end,text:n.events[key]}:{start:o.statement.start,end:o.statement.end,text:''});else if(n.events[key])insertions.push(`${binding.name}.${key} += ${n.events[key]};`);}
    }
    if(insertions.length){const endStatement=base.method.body.statements.find(s=>s.kind==='Return'||s.expression?.kind==='Call'&&s.expression.target.name==='Activate'),at=endStatement?.start??base.method.body.end-1;edits.push({start:at,end:at,text:insertions.join(newline+'        ')+newline+'        '});}
  }
  const safeEdits=coalesceDeletions(base.text,edits,newline);const text=applyTextEdits(base.text,safeEdits),parsed=readDesignSource(text,{uri:base.uri,methodName:base.method.name,previous:next});
  return {text,edits:safeEdits,document:parsed.document,analysis:parsed,structural,warnings:parsed.warnings};
}
/** A source/design baseline used for optimistic concurrency; UI persistence is supplied by the caller. */
export class CSharpDesignSession{
  constructor(text,options={}){this.options=options;this.analysis=readDesignSource(text,options);this.version=0;}
  read(text){const next=readDesignSource(text,{...this.options,methodName:this.analysis.method.name,previous:this.analysis.document});this.analysis=next;this.version++;return clone(next.document);}
  plan(document,currentText=this.analysis.text){return {...planDesignSourceUpdate(this.analysis,document,currentText),expectedVersion:this.version};}
  commit(plan){if(plan.expectedVersion!==this.version)fail('A newer synchronization has replaced this update');this.analysis=plan.analysis;this.version++;return clone(this.analysis.document);}
  get document(){return clone(this.analysis.document);}
}
