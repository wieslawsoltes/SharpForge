import {frameworkType} from '@sharpforge/framework';
import {ManagedFault} from './heap.js';
import {serializeJson} from './json-serialization.js';
import {invokeJsonNumber} from './json-numeric-accessors.js';
import {JSON_TEXT_LIMIT as MAX,JSON_NODE_LIMIT as MAX_NODES,JSON_DEPTH_LIMIT} from './json-limits.js';
const J='System.Text.Json.';
const fail=(type,message)=>{throw new ManagedFault(type,message);};
/** Strict, bounded JSON tokenizer retaining raw source spans and duplicate property order. */
export function parseJsonTree(text){
 if(typeof text!=='string'||text.length>MAX)fail('JsonException','JSON text limit exceeded');const nodes=[];let pos=0;
 const ws=()=>{while(pos<text.length&&/[\x20\t\r\n]/.test(text[pos]))pos++;};
 const str=()=>{const start=pos++;while(pos<text.length){const c=text[pos++];if(c==='"'){try{return JSON.parse(text.slice(start,pos));}catch{break;}}if(c==='\\')pos++;}fail('JsonException','Invalid JSON string at '+start);};
 const value=depth=>{
  ws();if(depth>JSON_DEPTH_LIMIT||nodes.length>=MAX_NODES)fail('JsonException','JSON depth or node limit exceeded');const start=pos,id=nodes.length,node={start,end:0,kind:0,value:null,children:null,keys:null};nodes.push(node);const ch=text[pos];
  if(ch==='{'||ch==='['){const object=ch==='{',close=object?'}':']';node.kind=object?1:2;node.children=[];node.keys=object?[]:null;pos++;ws();if(text[pos]===close){pos++;node.end=pos;return id;}
   for(;;){ws();if(object){if(text[pos]!=='"')fail('JsonException','Expected property name at '+pos);node.keys.push(str());ws();if(text[pos++]!==':')fail('JsonException','Expected colon');}node.children.push(value(depth+1));ws();const c=text[pos++];if(c===close)break;if(c!==',')fail('JsonException','Expected comma or closing bracket at '+(pos-1));}
  }else if(ch==='"'){node.kind=3;node.value=str();}
  else if(text.startsWith('true',pos)){node.kind=5;node.value=true;pos+=4;}
  else if(text.startsWith('false',pos)){node.kind=6;node.value=false;pos+=5;}
  else if(text.startsWith('null',pos)){node.kind=7;pos+=4;}
  else{const match=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(pos));if(!match||match.index!==0)fail('JsonException','Invalid JSON value at '+pos);node.kind=4;node.value=Number(match[0]);pos+=match[0].length;}
  node.end=pos;return id;
 };
 value(0);ws();if(pos!==text.length)fail('JsonException','Trailing JSON input at '+pos);return {text,nodes};
}
function tree(p,doc){if(p.get(doc,'$disposed',false))fail('ObjectDisposedException','JsonDocument is disposed');const record=p.record(doc);p.jsonCaches??=new WeakMap();let parsed=p.jsonCaches.get(record);if(!parsed){parsed=parseJsonTree(p.native(p.get(doc,'$json')));p.jsonCaches.set(record,parsed);}return parsed;}
function element(p,doc,index){return p.make(J+'JsonElement',{'$doc':doc,'$index':index});}
export function invokeJson(p,d,args){
 const t=frameworkType(d.owner);if(!t?.family?.startsWith('json'))return {handled:false};const ok=value=>({handled:true,value}),ref=d.isStatic?null:args[0],values=d.isStatic?args:args.slice(1),n=values.map(v=>p.native(v));
 if(t.family==='jsonSerializer')return ok(p.managed(serializeJson(p,args[0]),'string'));
 if(t.family==='jsonDocument'){
  if(d.name==='Parse'){const parsed=parseJsonTree(n[0]),doc=p.make(d.owner,{'$json':values[0]});p.jsonCaches??=new WeakMap();p.jsonCaches.set(p.record(doc),parsed);return ok(doc);}
  if(d.name==='Dispose'){p.set(ref,'$disposed',true);return ok(null);}tree(p,ref);return ok(element(p,ref,0));
 }
 const doc=p.get(ref,'$doc'),data=tree(p,doc),index=p.get(ref,'$index'),node=data.nodes[index];if(!node)fail('InvalidOperationException','Invalid JSON element');
 if(t.family==='jsonProperty'){if(d.property==='Name')return ok(p.get(ref,'Name'));return ok(element(p,doc,index));}
 if(t.family==='jsonEnumerator'){
  if(d.name==='GetEnumerator')return ok(ref);if(d.name==='Dispose'){p.set(ref,'$done',true);return ok(null);}if(d.name==='MoveNext'){if(p.get(ref,'$done',false))return ok(p.managed(false,'bool'));const current=p.get(ref,'$cursor',-1)+1;p.set(ref,'$cursor',current);return ok(p.managed(current<node.children.length,'bool'));}
  const cursor=p.get(ref,'$cursor',-1);if(cursor<0||cursor>=node.children.length||p.get(ref,'$done',false))fail('InvalidOperationException','Enumerator has no current value');
  return ok(t.object?p.make(J+'JsonProperty',{'$doc':doc,'$index':node.children[cursor],Name:p.managed(node.keys[cursor],'string')}):element(p,doc,node.children[cursor]));
 }
 const require=k=>{if(node.kind!==k)fail('InvalidOperationException','Unexpected JSON value kind');};
 if(d.property==='ValueKind')return ok(node.kind);
 if(d.name==='GetProperty'){require(1);const at=node.keys.lastIndexOf(n[0]);if(at<0)fail('KeyNotFoundException','JSON property was not found: '+n[0]);return ok(element(p,doc,node.children[at]));}
 if(d.name==='GetArrayLength'){require(2);return ok(node.children.length);}
 if(d.name==='get_Item'){require(2);if(!Number.isInteger(n[0])||n[0]<0||n[0]>=node.children.length)fail('IndexOutOfRangeException','JSON array index');return ok(element(p,doc,node.children[n[0]]));}
 if(d.name==='EnumerateArray'||d.name==='EnumerateObject'){require(d.name==='EnumerateArray'?2:1);return ok(p.make(d.result,{'$doc':doc,'$index':index,'$cursor':-1}));}
 if(d.name==='GetString'){if(node.kind===7)return ok(null);require(3);return ok(p.managed(node.value,'string'));}
 if(d.name==='GetBoolean'){if(![5,6].includes(node.kind))fail('InvalidOperationException','Boolean required');return ok(p.managed(node.value,'bool'));}
 const numeric=invokeJsonNumber(p,d,data,node);if(numeric)return numeric;
 if(d.name==='GetRawText')return ok(p.managed(data.text.slice(node.start,node.end),'string'));
 if(d.name==='ToString')return ok(p.managed(node.kind===3?node.value:node.kind===7?'':node.kind===5?'True':node.kind===6?'False':data.text.slice(node.start,node.end),'string'));
 fail('MissingMethodException',d.name);
}
