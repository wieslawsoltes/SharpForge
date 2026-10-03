/** Bounded data-only MSBuild condition parser. No JavaScript eval or .NET property functions. */
export function evaluateCondition(text,{properties={},exists=()=>false}={}){
 if(!text?.trim())return true;if(text.length>16384)throw new Error('Condition too long');
 const props=Object.fromEntries(Object.entries(properties).map(([key,value])=>[key.toLowerCase(),String(value)]));
 if(/\$\(\[/.test(text))throw new Error('MSBuild property functions require the native engine');
 const expanded=text.replace(/\$\(([^)]+)\)/g,(_,key)=>props[key.toLowerCase()]??'');if(expanded.length>65536)throw new Error('Expanded condition too long');
 const tokens=[];let offset=0;
 while(offset<expanded.length){const m=/^(?:\s+|('[^']*'|"[^"]*")|(==|!=|<=|>=|<|>|\(|\)|!)|(0x[\da-f]+|[+-]?\d+(?:\.\d+)*)|([A-Za-z_][A-Za-z0-9_]*))/i.exec(expanded.slice(offset));if(!m)throw new Error('Unsupported MSBuild condition: '+text);offset+=m[0].length;if(m[1])tokens.push({type:'value',value:m[1].slice(1,-1)});else if(m[2])tokens.push({type:m[2]});else if(m[3])tokens.push({type:'value',value:m[3]});else if(m[4])tokens.push({type:m[4].toLowerCase()});}
 let at=0,depth=0;const take=type=>{if(tokens[at]?.type===type){at++;return true;}return false;};
 const value=()=>{const t=tokens[at++];if(!t)throw new Error('Incomplete condition');if(t.type==='value')return t.value;if(['true','false'].includes(t.type))return t.type;throw new Error('Expected condition value');};
 const compare=(left,right)=>{
  const number=s=>/^[-+]?\d+(?:\.\d+)?$/.test(s)||/^0x[\da-f]+$/i.test(s)?Number(s):NaN;
  const a=number(left),b=number(right);if(Number.isFinite(a)&&Number.isFinite(b))return a<b?-1:a>b?1:0;
  if(/^\d+(?:\.\d+){1,3}$/.test(left)&&/^\d+(?:\.\d+){1,3}$/.test(right)){const a=left.split('.').map(Number),b=right.split('.').map(Number);for(let i=0;i<4;i++){if((a[i]??0)!==(b[i]??0))return (a[i]??0)<(b[i]??0)?-1:1;}return 0;}
  throw new Error('Relational conditions require numeric or version operands');
 };
 function atom(){if(++depth>64)throw new Error('Condition nesting limit');let result;
  if(take('!'))result=!atom();else if(take('(')){result=or();if(!take(')'))throw new Error('Missing condition parenthesis');}
  else if(['exists','hastrailingslash'].includes(tokens[at]?.type)){const fn=tokens[at++].type;if(!take('('))throw new Error('Missing condition (');const arg=value();if(!take(')'))throw new Error('Missing condition )');result=fn==='exists'?exists(arg):/[\\/]$/.test(arg);}
  else {const left=value(),op=tokens[at]?.type;if(['==','!=','<','>','<=','>='].includes(op)){at++;const right=value();if(op==='=='||op==='!='){let equal;try{equal=compare(left,right)===0;}catch{equal=left.toLowerCase()===right.toLowerCase();}result=op==='=='?equal:!equal;}else {const c=compare(left,right);result=op==='<'?c<0:op==='>'?c>0:op==='<='?c<=0:c>=0;}}else if(/^(true|false)$/i.test(left))result=left.toLowerCase()==='true';else throw new Error('Unsupported condition value');}
  depth--;return result;
 }
 function and(){let v=atom();while(take('and')){const r=atom();v=v&&r;}return v;}
 function or(){let v=and();while(take('or')){const r=and();v=v||r;}return v;}
 const result=or();if(at!==tokens.length)throw new Error('Unsupported condition suffix');return result;
}
