/** Side-effect-free C# constant evaluation for this compiler's primitive type profile.
 * Returning null means nonconstant; diagnostics retain the exact source node.
 * BigInt is used internally to detect Int32 multiplication overflow exactly.
 */
export class ConstantError extends Error {
  constructor(node, code, message) { super(message); this.name='ConstantError';this.node=node;this.code=code; }
}
export function evaluateConstant(node, {resolve=()=>null, checked=true, maxNodes=2048}={}) {
  let remaining=maxNodes;
  const fail=(n,code,text)=>{throw new ConstantError(n,code,text);};
  const int=(v,n,check)=>{
    const b=typeof v==='bigint'?v:BigInt(v);
    if(check&&(b< -2147483648n||b>2147483647n))fail(n,'CS0220','The operation overflows at compile time in checked mode');
    return {type:'int',value:Number(BigInt.asIntN(32,b))};
  };
  const walk=(n,check)=>{
    if(!n||--remaining<0)return null;
    if(n.kind==='Literal')return ['int','double','bool','string','null'].includes(n.type)?{type:n.type,value:n.value}:null;
    if(n.kind==='Name'||n.kind==='Member')return resolve(n);
    if(n.kind==='Checked'||n.kind==='Unchecked')return walk(n.expression,n.kind==='Checked');
    if(n.kind==='Default'&&['int','double','bool','string','object'].includes(n.type))return {type:n.type,value:n.type==='bool'?false:['int','double'].includes(n.type)?0:null};
    if(n.kind==='Unary'){
      if(n.operator==='-'&&n.operand.kind==='Literal'&&n.operand.type==='int'&&n.operand.value===2147483648)return int(-2147483648,n,check);
      const x=walk(n.operand,check);if(!x)return null;
      if(n.operator==='!'&&x.type==='bool')return {type:'bool',value:!x.value};
      if(n.operator==='~'&&x.type==='int')return int(~x.value,n,false);
      if(['+','-'].includes(n.operator)&&['int','double'].includes(x.type))return x.type==='int'?int(n.operator==='-'?-BigInt(x.value):BigInt(x.value),n,check):{type:'double',value:n.operator==='-'?-x.value:x.value};
      return null;
    }
    if(n.kind==='Cast'){
      const x=walk(n.expression,check);if(!x||!['int','double'].includes(x.type)||!['int','double'].includes(n.type))return null;
      if(n.type==='double')return {type:'double',value:Number(x.value)};
      const value=Math.trunc(x.value);if(!check&&x.type==='double')return {type:'int',value:Number.isNaN(value)?0:Math.max(-2147483648,Math.min(2147483647,value))|0};
      if(!Number.isFinite(value))fail(n,'CS0221','Constant value cannot be converted to int');
      return int(value,n,check);
    }
    if(n.kind==='Conditional'){
      const condition=walk(n.condition,check),yes=walk(n.whenTrue,check),no=walk(n.whenFalse,check);
      return condition?.type==='bool'&&yes&&no?(condition.value?yes:no):null;
    }
    if(n.kind!=='Binary')return null;
    const l=walk(n.left,check),r=walk(n.right,check),op=n.operator;
    if(!l||!r)return null;
    const a=l.value,b=r.value;
    if(op==='+'&&(l.type==='string'||r.type==='string')){
      // C# constant string concatenation is restricted to strings/null, not boxing.
      return ['string','null'].includes(l.type)&&['string','null'].includes(r.type)?{type:'string',value:(a??'')+(b??'')}:null;
    }
    if(l.type==='bool'&&r.type==='bool'&&['&&','||','&','|','^','==','!='].includes(op))return {type:'bool',value:op==='&&'||op==='&'?a&&b:op==='||'||op==='|'?a||b:op==='^'||op==='!='?a!==b:a===b};
    if(['==','!='].includes(op)&&['string','null'].includes(l.type)&&['string','null'].includes(r.type))return {type:'bool',value:op==='=='?a===b:a!==b};
    if(!['int','double'].includes(l.type)||!['int','double'].includes(r.type))return null;
    if(['==','!=','<','>','<=','>='].includes(op))return {type:'bool',value:op==='=='?a===b:op==='!='?a!==b:op==='<'?a<b:op==='>'?a>b:op==='<='?a<=b:a>=b};
    if(l.type==='double'||r.type==='double'){
      if(!['+','-','*','/','%'].includes(op))return null;
      return {type:'double',value:op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:op==='/'?a/b:a%b};
    }
    if(['<<','>>','&','|','^'].includes(op))return int(op==='<<'?a<<(b&31):op==='>>'?a>>(b&31):op==='&'?a&b:op==='|'?a|b:a^b,n,false);
    if(!['+','-','*','/','%'].includes(op))return null;
    if((op==='/'||op==='%')&&b===0)fail(n,'CS0020','Division by constant zero');
    if(op==='/'&&a===-2147483648&&b===-1)fail(n,'CS0220','Constant Int32 division overflows');
    const x=BigInt(a),y=BigInt(b);return int(op==='+'?x+y:op==='-'?x-y:op==='*'?x*y:op==='/'?x/y:x%y,n,check);
  };
  return walk(node,checked);
}
