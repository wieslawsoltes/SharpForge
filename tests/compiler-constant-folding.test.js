import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseExpression} from '@sharpforge/syntax';
import {ConstantValue,Decimal,foldUnary,foldBinary,foldConversion,foldConditional,defaultValue,isFoldError,literalConstant,negatedLiteralConstant,binaryNumericPromotion,hasImplicitConstantConversion} from '../packages/compiler/src/constants/fold.js';
import {floatBits,doubleBits,formatFloatingPoint} from '../packages/compiler/src/constants/constant-value.js';
import {evaluateConstant,ConstantError} from '../packages/compiler/src/constants.js';
import {formatMessage} from '../packages/compiler/src/diagnostics/codes.js';

// The corpus is pinned from real Roslyn by packages/compiler/test/constants/generate.js; replaying it needs no .NET.
const corpus=JSON.parse(readFileSync(new URL('../packages/compiler/test/constants/roslyn-constants.json',import.meta.url),'utf8'));
const enums=Object.fromEntries(Object.entries(corpus.enums).map(([name,e])=>[name,{name,underlyingType:e.underlying,members:e.members}]));
const PRIMITIVES=['sbyte','byte','short','ushort','int','uint','long','ulong','char','float','double','decimal','bool','string','object'];
/** Codes the folder itself owns; every other code in the corpus is a binder error for which folding yields "not constant". */
const FOLD_CODES=['CS0220','CS0020','CS0221','CS0031','CS0463','CS0594','CS1021'];
const wellKnown={
  'int.MaxValue':ConstantValue.int(2147483647),'int.MinValue':ConstantValue.int(-2147483648),'long.MaxValue':ConstantValue.long(9223372036854775807n),'long.MinValue':ConstantValue.long(-9223372036854775808n),
  'uint.MaxValue':ConstantValue.uint(4294967295),'ulong.MaxValue':ConstantValue.ulong(18446744073709551615n),'byte.MaxValue':ConstantValue.byte(255),'sbyte.MinValue':ConstantValue.sbyte(-128),
  'short.MinValue':ConstantValue.short(-32768),'ushort.MaxValue':ConstantValue.ushort(65535),'char.MaxValue':ConstantValue.char(65535),
  'double.MaxValue':ConstantValue.double(Number.MAX_VALUE),'double.MinValue':ConstantValue.double(-Number.MAX_VALUE),'double.Epsilon':ConstantValue.double(Number.MIN_VALUE),'double.NaN':ConstantValue.double(NaN),
  'double.PositiveInfinity':ConstantValue.double(Infinity),'double.NegativeInfinity':ConstantValue.double(-Infinity),
  'float.MaxValue':ConstantValue.float(3.4028234663852886e38),'float.MinValue':ConstantValue.float(-3.4028234663852886e38),'float.Epsilon':ConstantValue.float(1.401298464324817e-45),'float.NaN':ConstantValue.float(NaN),
  'float.PositiveInfinity':ConstantValue.float(Infinity),'float.NegativeInfinity':ConstantValue.float(-Infinity),
  'decimal.MaxValue':ConstantValue.decimal('79228162514264337593543950335'),'decimal.MinValue':ConstantValue.decimal('-79228162514264337593543950335'),'decimal.One':ConstantValue.decimal('1'),'decimal.Zero':ConstantValue.decimal('0'),'decimal.MinusOne':ConstantValue.decimal('-1'),
  'System.Math.PI':ConstantValue.double(Math.PI),'System.Math.E':ConstantValue.double(Math.E)
};

// ---- a tiny C# constant-expression parser producing packages/syntax-shaped nodes (Literal/Unary/Binary/Cast/...) ----
const TOKEN=/\s*(?:(0[xX][\da-fA-F_]+[uUlL]*|0[bB][01_]+[uUlL]*|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[uUlLfFdDmM]*)|('(?:\\.[^']*|[^'\\])')|(@"(?:[^"]|"")*"|"(?:\\.|[^"\\])*")|([A-Za-z_]\w*)|(>>>|<<|>>|<=|>=|==|!=|&&|\|\||[-+*\/%()<>!~&|^?:.]))/y;
const unescape=text=>text.replace(/\\(x[\da-fA-F]{1,4}|u[\da-fA-F]{4}|.)/g,(_,e)=>e[0]==='x'||e[0]==='u'&&e.length>1?String.fromCharCode(parseInt(e.slice(1),16)):({n:'\n',t:'\t',r:'\r',0:'\0',a:'\x07',b:'\b',f:'\f',v:'\v'})[e]??e);
const LEVELS=[['||'],['&&'],['|'],['^'],['&'],['==','!='],['<','>','<=','>='],['<<','>>','>>>'],['+','-'],['*','/','%']];
function parseCSharp(text){
  const tokens=[];TOKEN.lastIndex=0;
  while(TOKEN.lastIndex<text.length){const m=TOKEN.exec(text);if(!m)throw new SyntaxError('Cannot tokenize '+text);tokens.push(m[1]!==undefined?{kind:'number',text:m[1]}:m[2]!==undefined?{kind:'char',text:m[2]}:m[3]!==undefined?{kind:'string',text:m[3]}:m[4]!==undefined?{kind:'identifier',text:m[4]}:{kind:m[5],text:m[5]});}
  let i=0;const peek=(k=0)=>tokens[i+k],take=()=>tokens[i++],at=kind=>peek()?.kind===kind,expect=kind=>{if(!at(kind))throw new SyntaxError(`Expected ${kind} in ${text}`);return take();};
  const typeName=()=>{let name=expect('identifier').text;if(at('?')){take();name+='?';}return name;};
  const isType=name=>PRIMITIVES.includes(name)||Object.hasOwn(enums,name);
  const conditional=()=>{const condition=binary(0);if(!at('?'))return condition;take();const whenTrue=conditional();expect(':');return {kind:'Conditional',condition,whenTrue,whenFalse:conditional()};};
  const binary=level=>{if(level===LEVELS.length)return unary();let left=binary(level+1);while(peek()&&LEVELS[level].includes(peek().kind)){const operator=take().kind;left={kind:'Binary',operator,left,right:binary(level+1)};}return left;};
  const unary=()=>{
    if(peek()&&['+','-','!','~'].includes(peek().kind)){const operator=take().kind,literal=at('number');const operand=unary();return {kind:'Unary',operator,operand,direct:literal&&operand.kind==='Literal'};}
    if(at('(')&&peek(1)?.kind==='identifier'&&isType(peek(1).text)&&peek(2)?.kind===')'){take();const type=take().text;take();return {kind:'Cast',type,expression:unary()};}
    return primary();
  };
  const primary=()=>{
    const t=take();if(!t)throw new SyntaxError('Unexpected end of '+text);
    if(t.kind==='number')return {kind:'Literal',type:'number',text:t.text};
    if(t.kind==='char')return {kind:'Literal',type:'char',value:unescape(t.text.slice(1,-1))};
    if(t.kind==='string')return {kind:'Literal',type:'string',value:t.text[0]==='@'?t.text.slice(2,-1).replaceAll('""','"'):unescape(t.text.slice(1,-1))};
    if(t.kind==='('){const e=conditional();expect(')');return e;}
    if(t.kind!=='identifier')throw new SyntaxError(`Unexpected ${t.text} in ${text}`);
    if(t.text==='true'||t.text==='false')return {kind:'Literal',type:'bool',value:t.text==='true'};
    if(t.text==='null')return {kind:'Literal',type:'null',value:null};
    if(t.text==='checked'||t.text==='unchecked'){expect('(');const expression=conditional();expect(')');return {kind:t.text==='checked'?'Checked':'Unchecked',expression};}
    if(t.text==='default'){expect('(');const type=typeName();expect(')');return {kind:'Default',type};}
    let name=t.text;while(at('.')){take();name+='.'+expect('identifier').text;}
    return {kind:'Name',name};
  };
  const root=conditional();if(i!==tokens.length)throw new SyntaxError('Trailing input in '+text);return root;
}
/** packages/syntax parses the int/double/bool/string subset; its literals carry no token text, so re-slice it from the source. */
function parseWithSyntaxPackage(text){
  if(!/^[\d\s+\-*\/%()<>=!&|^~?:.]+$|^[\w\s+\-*\/%()<>=!&|^~?:."]+$/.test(text)||/\d[uUlLfFdDmMxXbB_eE]|>>>|\b(?:default|checked|unchecked)\b|[A-Za-z]\.|\\|[A-Z]/.test(text))return null;
  const {expression,diagnostics}=parseExpression(text);if(diagnostics.length)return null;
  const convert=n=>{
    switch(n.kind){
      case 'Literal':return n.type==='int'||n.type==='double'?{kind:'Literal',type:'number',text:text.slice(n.start,n.end)}:{kind:'Literal',type:n.type,value:n.value};
      case 'Unary':if(n.postfix)throw new SyntaxError('postfix');return {kind:'Unary',operator:n.operator,operand:convert(n.operand),direct:n.operand.kind==='Literal'&&text.slice(n.start,n.operand.start).trim()===n.operator};
      case 'Binary':return {kind:'Binary',operator:n.operator,left:convert(n.left),right:convert(n.right)};
      case 'Conditional':return {kind:'Conditional',condition:convert(n.condition),whenTrue:convert(n.whenTrue),whenFalse:convert(n.whenFalse)};
      default:throw new SyntaxError('Unsupported syntax node '+n.kind);
    }
  };
  try{return convert(expression);}catch{return null;}
}

// ---- the expression-to-fold driver: what the binder does with fold.js ----
function evaluate(root,checkedContext){
  const errors=[],BAD=Symbol('bad');
  const done=result=>{if(isFoldError(result)){errors.push(result.error);return BAD;}return result;};
  const type=name=>enums[name]??name;
  const walk=(n,checked)=>{
    switch(n.kind){
      case 'Literal':return n.type==='number'?done(literalConstant(n.text)):n.type==='char'?ConstantValue.char(n.value):n.type==='string'?ConstantValue.string(n.value):n.type==='bool'?ConstantValue.bool(n.value):ConstantValue.null();
      case 'Name':{
        if(Object.hasOwn(wellKnown,n.name))return wellKnown[n.name];
        const [owner,member]=n.name.split('.');assert(enums[owner]&&Object.hasOwn(enums[owner].members,member),'unknown name '+n.name);
        return ConstantValue.enum(enums[owner],enums[owner].members[member]);
      }
      case 'Checked':case 'Unchecked':return walk(n.expression,n.kind==='Checked');
      case 'Default':return n.type.endsWith('?')?null:defaultValue(type(n.type));
      case 'Cast':{const v=walk(n.expression,checked);return v===BAD?BAD:done(foldConversion(v,type(n.type),{checked}));}
      case 'Unary':{
        if(n.operator==='-'&&n.direct){const special=negatedLiteralConstant(n.operand.text);if(special)return special;}
        const v=walk(n.operand,checked);return v===BAD?BAD:done(foldUnary(n.operator,v,{checked}));
      }
      case 'Binary':{const l=walk(n.left,checked),r=walk(n.right,checked);return l===BAD||r===BAD?BAD:done(foldBinary(n.operator,l,r,{checked}));}
      case 'Conditional':{const c=walk(n.condition,checked),a=walk(n.whenTrue,checked),b=walk(n.whenFalse,checked);return [c,a,b].includes(BAD)?BAD:done(foldConditional(c,a,b));}
      default:throw new Error('Unsupported node '+n.kind);
    }
  };
  const value=walk(root,checkedContext);
  return {value:value===BAD?null:value,errors};
}
/** Renders a fold outcome in the corpus row shape so a mismatch prints both sides. */
function render(outcome){
  if(outcome.errors.length)return {diagnostics:outcome.errors.map(e=>e.code),messages:outcome.errors.map(e=>formatMessage(e.code,e.args))};
  const v=outcome.value;if(!v)return {constant:false};
  const row={type:v.typeName};
  if(v.value===null)row.value=null;
  else if(v.type==='float'||v.type==='double')row.bits=Number.isNaN(v.value)?'NaN':v.type==='float'?floatBits(v.value):doubleBits(v.value);
  else if(v.type==='decimal'){row.value=v.value.toString();row.bits=v.value.toBits();}
  else if(v.type==='bool'||v.type==='string')row.value=v.value;
  else row.value=String(v.value);
  return row;
}
function expected(row){
  if(row.diagnostics)return row.diagnostics.every(c=>FOLD_CODES.includes(c))?{diagnostics:row.diagnostics,messages:row.messages}:{constant:false};
  if(row.constant===false)return {constant:false};
  const e={type:row.type};
  if(row.type==='float'||row.type==='double')e.bits=row.value==='NaN'?'NaN':row.bits;// the sign/payload of a NaN is not observable from JavaScript
  else if(row.type==='decimal'){e.value=row.value.replace(/^-(?=[0.]*$)/,'');e.bits=row.bits.slice(0,3).every(w=>w===0)?[0,0,0,row.bits[3]&0x7fffffff]:row.bits;}
  else e.value=row.value;
  return e;
}

test('A02-T32 ConstantValue is a typed, immutable value for every primitive and for enums',()=>{
  const color=enums.Color;
  const samples=[ConstantValue.sbyte(-128),ConstantValue.byte(255),ConstantValue.short(-32768),ConstantValue.ushort(65535),ConstantValue.int(-2147483648),ConstantValue.uint(4294967295),ConstantValue.long(-9223372036854775808n),ConstantValue.ulong(18446744073709551615n),ConstantValue.char('a'),ConstantValue.float(0.1),ConstantValue.double(0.1),ConstantValue.decimal('1.50'),ConstantValue.bool(true),ConstantValue.string('s'),ConstantValue.null()];
  assert.deepEqual(samples.map(v=>v.type),['sbyte','byte','short','ushort','int','uint','long','ulong','char','float','double','decimal','bool','string','null']);
  for(const v of samples){assert(Object.isFrozen(v));assert(v.equals(ConstantValue.of(v.type,v.value)),v.type);assert.equal(v.isEnum,false);}
  assert.equal(typeof samples[6].value,'bigint');assert.equal(typeof samples[7].value,'bigint');assert.equal(samples[8].value,97);assert.equal(samples[9].value,Math.fround(0.1));assert(samples[11].value instanceof Decimal);
  assert.throws(()=>ConstantValue.byte(256),RangeError);assert.throws(()=>ConstantValue.int(2147483648),RangeError);assert.throws(()=>ConstantValue.ulong(-1n),RangeError);assert.throws(()=>ConstantValue.decimal('1e40'),RangeError);
  const green=ConstantValue.enum(color,2);
  assert.equal(green.type,'byte');assert.equal(green.enumType,color);assert.equal(green.typeName,'Color');assert(green.isEnum);assert.equal(green.value,2);
  assert(!green.equals(ConstantValue.byte(2)));assert(green.equals(ConstantValue.enum({name:'Color',underlyingType:'byte'},2)));assert(!green.equals(ConstantValue.enum({name:'Other',underlyingType:'byte'},2)));
  assert.throws(()=>ConstantValue.enum(color,256),RangeError);
  // Enum type symbols work too: the folder reads enumUnderlyingType.specialType and toDisplayString().
  const symbol={toDisplayString:()=>'N.Flags',enumUnderlyingType:{specialType:'System_UInt16'}};
  const flag=ConstantValue.enum(symbol,65535);assert.equal(flag.type,'ushort');assert.equal(flag.typeName,'N.Flags');
  assert.deepEqual(foldBinary('+',flag,ConstantValue.int(1)),{error:{code:'CS0221',args:['65536','N.Flags']}});
  assert.equal(foldBinary('+',flag,ConstantValue.int(1),{checked:false}).value,0);
  assert.equal(ConstantValue.string(null).isNull,true);assert.equal(ConstantValue.null('object').type,'object');assert(ConstantValue.double(NaN).equals(ConstantValue.double(NaN)));assert(!ConstantValue.double(0).equals(ConstantValue.double(-0)));
  assert(!ConstantValue.decimal('1.0').equals(ConstantValue.decimal('1.00')));assert.equal(String(ConstantValue.decimal('1.00').value),'1.00');
  assert.deepEqual([ConstantValue.char('a').displayValue,ConstantValue.double(1e20).displayValue,ConstantValue.float(16777216).displayValue,ConstantValue.double(0.00001).displayValue,ConstantValue.decimal('2.50').displayValue,ConstantValue.long(-5n).displayValue],['a','1E+20','16777216','1E-05','2.50M','-5']);
  assert.deepEqual([formatFloatingPoint(123456789012345680),formatFloatingPoint(0.0001),formatFloatingPoint(-1.5),formatFloatingPoint(Math.fround(1e10),true),formatFloatingPoint(Math.fround(0.1),true)],['1.2345678901234568E+17','0.0001','-1.5','1E+10','0.1']);
});
test('A02-T32 fold API: results, not-constant and error records',()=>{
  const int=ConstantValue.int,max=int(2147483647);
  assert(foldBinary('+',int(1),int(2)).equals(int(3)));
  // Checked is the default context for constants; errors are records, never exceptions.
  assert.deepEqual(foldBinary('+',max,int(1)),{error:{code:'CS0220',args:[]}});assert(isFoldError(foldBinary('+',max,int(1))));assert(Object.isFrozen(foldBinary('+',max,int(1)).error));
  assert(foldBinary('+',max,int(1),{checked:false}).equals(int(-2147483648)));
  assert.deepEqual(foldBinary('/',int(1),int(0),{checked:false}),{error:{code:'CS0020',args:[]}});
  assert.deepEqual(foldConversion(int(300),'byte'),{error:{code:'CS0221',args:['300','byte']}});assert(foldConversion(int(300),'byte',{checked:false}).equals(ConstantValue.byte(44)));
  assert.deepEqual(foldBinary('*',ConstantValue.decimal('79228162514264337593543950335'),ConstantValue.decimal('2')),{error:{code:'CS0463',args:[]}});
  assert.deepEqual(foldConversion(ConstantValue.decimal('256'),'byte',{checked:false}),{error:{code:'CS0031',args:['256M','byte']}});
  assert.equal(isFoldError(null),false);assert.equal(isFoldError(int(1)),false);
  // Not constant / not applicable is null; an error or null operand propagates.
  assert.equal(foldBinary('+',ConstantValue.string('a'),int(1)),null);assert.equal(foldBinary('+',ConstantValue.ulong(1n),int(-1)),null);assert.equal(foldUnary('-',ConstantValue.ulong(1n)),null);assert.equal(foldUnary('!',int(1)),null);
  assert.equal(foldBinary('+',null,int(1)),null);assert.equal(foldUnary('-',null),null);assert.equal(foldConversion(null,'int'),null);assert.equal(foldConversion(ConstantValue.string('a'),'object'),null);
  const overflow=foldBinary('+',max,int(1));assert.equal(foldBinary('*',overflow,int(2)),overflow);assert.equal(foldUnary('-',overflow),overflow);assert.equal(foldConversion(overflow,'long'),overflow);assert.equal(foldConditional(ConstantValue.bool(true),overflow,int(1)),overflow);
  // Binary numeric promotion and the implicit constant conversions behind it.
  const type=(a,b)=>binaryNumericPromotion(a,b);
  assert.deepEqual([type(ConstantValue.byte(1),ConstantValue.byte(2)),type(ConstantValue.uint(1),int(1)),type(ConstantValue.uint(1),int(-1)),type(ConstantValue.ulong(1n),int(1)),type(ConstantValue.ulong(1n),int(-1)),type(ConstantValue.ulong(1n),ConstantValue.short(1)),type(ConstantValue.char('a'),ConstantValue.char('b')),type(ConstantValue.float(1),ConstantValue.long(1n)),type(ConstantValue.decimal('1'),ConstantValue.double(1)),type(ConstantValue.decimal('1'),int(1))],['int','uint','long','ulong',null,null,'int','float',null,'decimal']);
  assert.deepEqual([hasImplicitConstantConversion(int(255),'byte'),hasImplicitConstantConversion(int(256),'byte'),hasImplicitConstantConversion(ConstantValue.long(1n),'ulong'),hasImplicitConstantConversion(ConstantValue.long(1n),'int'),hasImplicitConstantConversion(ConstantValue.uint(1),'int'),hasImplicitConstantConversion(ConstantValue.char('a'),'int'),hasImplicitConstantConversion(ConstantValue.float(1),'decimal')],[true,false,true,false,false,true,false]);
  // Shift counts are masked to the promoted width; defaults; conditional typing.
  assert(foldBinary('<<',int(1),int(33)).equals(int(2)));assert(foldBinary('<<',ConstantValue.long(1n),int(65)).equals(ConstantValue.long(2n)));assert(foldBinary('>>>',int(-1),int(28)).equals(int(15)));
  assert(defaultValue('long').equals(ConstantValue.long(0n)));assert(defaultValue('char').equals(ConstantValue.char(0)));assert(defaultValue('string').equals(ConstantValue.string(null)));assert(defaultValue(enums.Big).equals(ConstantValue.enum(enums.Big,0n)));assert(defaultValue('decimal').equals(ConstantValue.decimal('0')));
  assert(foldConditional(ConstantValue.bool(false),int(1),ConstantValue.long(2n)).equals(ConstantValue.long(2n)));assert(foldConditional(ConstantValue.bool(true),int(1),ConstantValue.long(2n)).equals(ConstantValue.long(1n)));assert.equal(foldConditional(int(1),int(1),int(2)),null);
  // Literal typing, including the int.MinValue / long.MinValue rule and the literal range errors.
  assert.deepEqual(['1','2147483648','4294967296','9223372036854775808','1u','1L','1UL','0xFFFFFFFF','0b11','1.5','1.5f','1.5m','1e3','1_0'].map(t=>literalConstant(t).type),['int','uint','long','ulong','uint','long','ulong','uint','int','double','float','decimal','double','int']);
  assert.deepEqual(literalConstant('18446744073709551616'),{error:{code:'CS1021',args:[]}});assert.deepEqual(literalConstant('1e400'),{error:{code:'CS0594',args:['double']}});assert.deepEqual(literalConstant('1e39f'),{error:{code:'CS0594',args:['float']}});assert.deepEqual(literalConstant('1e29m'),{error:{code:'CS0594',args:['decimal']}});assert.equal(literalConstant('abc'),null);
  assert(negatedLiteralConstant('2147483648').equals(int(-2147483648)));assert(negatedLiteralConstant('9223372036854775808').equals(ConstantValue.long(-9223372036854775808n)));assert.equal(negatedLiteralConstant('2147483648U'),null);assert.equal(negatedLiteralConstant('5'),null);
  // A float literal is rounded once from its decimal digits: just above the midpoint of 1 and the next float, rounding
  // through double first lands exactly on the midpoint and ties back down to 1 (the corpus pins Roslyn's answer).
  assert.equal(Math.fround(Number('1.00000005960464477550')),1);
  assert.equal(literalConstant('1.00000005960464477550f').value,1.0000001192092896);assert.equal(literalConstant('1.00000005960464477539f').value,1);assert.equal(literalConstant('1.000000059604644775390625f').value,1);
});
test('A02-T32 Decimal models System.Decimal scale and rounding',()=>{
  const d=text=>Decimal.parse(text),text=v=>v===null?'overflow':v.toString();
  assert.deepEqual([d('1.0').add(d('1.00')),d('0.1').multiply(d('0.1')),d('1').divide(d('3')),d('2').divide(d('3')),d('4.00').divide(d('2')),d('1').divide(d('8')),d('100').divide(d('2.0')),d('-7').remainder(d('3')),d('1').remainder(d('3.000')),d('79228162514264337593543950335').add(d('1')),d('79228162514264337593543950335').add(d('0.4'))].map(text),
    ['2.00','0.01','0.3333333333333333333333333333','0.6666666666666666666666666667','2.00','0.125','50','-1','1','overflow','79228162514264337593543950335']);
  assert.deepEqual(d('1.5').toBits(),[15,0,0,65536]);assert.deepEqual(d('-1').toBits(),[1,0,0,-2147483648]);assert.equal(d('1e29'),null);assert.equal(d('x'),null);
  assert.deepEqual([Decimal.fromDouble(0.1),Decimal.fromDouble(1e15),Decimal.fromDouble(Math.fround(1.1),true),Decimal.fromDouble(NaN),Decimal.fromDouble(1e30),Decimal.fromDouble(1e-30)].map(text),['0.1','1000000000000000','1.1','overflow','overflow','0']);
  assert.equal(d('0.1').toDouble(),0.1);assert.equal(d('12.9').truncate(),12n);assert.equal(d('-12.9').truncate(),-12n);assert.equal(d('1.0').compare(d('1.00')),0);assert.equal(d('1.5').compare(d('2')),-1);
  assert.throws(()=>new Decimal(1n<<96n,0),RangeError);assert.throws(()=>new Decimal(1n,29),RangeError);assert.throws(()=>d('1').divide(d('0')),RangeError);
});
test('A02-T32 evaluateConstant keeps the current AST profile behaviour on top of fold.js',()=>{
  const evaluate=(text,options)=>evaluateConstant(parseExpression(text).expression,options);
  const fails=(text,options,code,args=[])=>assert.throws(()=>evaluate(text,options),e=>{assert(e instanceof ConstantError);assert.equal(e.code,code);assert.deepEqual(e.args,args);assert.equal(e.message,formatMessage(code,args));assert.equal(typeof e.node.start,'number');return true;},text);
  assert.deepEqual(evaluate('1+2*3'),{type:'int',value:7});assert.equal(evaluate('1+2*3',{maxNodes:1}),null);
  assert.deepEqual(evaluate('7/2'),{type:'int',value:3});assert.deepEqual(evaluate('-7%3'),{type:'int',value:-1});assert.deepEqual(evaluate('1/2.0'),{type:'double',value:0.5});assert.deepEqual(evaluate('1<<33'),{type:'int',value:2});
  assert.deepEqual(evaluate('"a"+null+"b"'),{type:'string',value:'ab'});assert.deepEqual(evaluate('"a"==null'),{type:'bool',value:false});assert.deepEqual(evaluate('true&&!false'),{type:'bool',value:true});assert.deepEqual(evaluate('1<2?"y":"n"'),{type:'string',value:'y'});
  assert.deepEqual(evaluate('default(string)'),{type:'string',value:null});assert.deepEqual(evaluate('default(object)'),{type:'object',value:null});assert.deepEqual(evaluate('default(double)'),{type:'double',value:0});
  assert.equal(evaluate('"a"+1'),null);assert.equal(evaluate("'a'"),null);assert.equal(evaluate('x+1'),null);assert.equal(evaluate('1>>>1'),null);
  assert.deepEqual(evaluate('x+1',{resolve:n=>n.name==='x'?{type:'int',value:41}:null}),{type:'int',value:42});
  assert.deepEqual(evaluate('-2147483648'),{type:'int',value:-2147483648});
  fails('2147483647+1',{},'CS0220');assert.deepEqual(evaluate('2147483647+1',{checked:false}),{type:'int',value:-2147483648});assert.deepEqual(evaluate('unchecked(2147483647+1)'),{type:'int',value:-2147483648});fails('checked(2147483647+1)',{checked:false},'CS0220');
  fails('1/0',{},'CS0020');fails('1%0',{checked:false},'CS0020');assert.deepEqual(evaluate('1.0/0'),{type:'double',value:Infinity});
  // Profile behaviour that differs from Roslyn (see constants.js) is preserved exactly.
  fails('-2147483648/-1',{checked:false},'CS0220');assert.deepEqual(evaluate('-2147483648%-1'),{type:'int',value:0});
  fails('(int)1e10',{},'CS0220');assert.deepEqual(evaluate('(int)1e10',{checked:false}),{type:'int',value:-2147483648});
  fails('(int)(1.0/0)',{},'CS0221',['Infinity','int']);fails('(int)(0.0/0)',{},'CS0221',['NaN','int']);assert.deepEqual(evaluate('(int)(0.0/0)',{checked:false}),{type:'int',value:-2147483648});
  assert.deepEqual(evaluate('(int)-1.9'),{type:'int',value:-1});assert.deepEqual(evaluate('(double)3'),{type:'double',value:3});assert.deepEqual(evaluate('~5'),{type:'int',value:-6});
  fails('2147483648+0',{},'CS0220');assert.deepEqual(evaluate('2147483648+0',{checked:false}),{type:'int',value:-2147483648});assert.deepEqual(evaluate('2147483648'),{type:'int',value:2147483648});
});
test('A02-T32 corpus is a Roslyn pin of a few hundred constant expressions',()=>{
  assert.match(corpus.roslyn,/^\d+\.\d+/);assert(corpus.rows.length>=1500);
  for(const code of ['CS0220','CS0020','CS0221','CS0031','CS0463','CS0594','CS1021'])assert(corpus.rows.some(r=>r.diagnostics?.includes(code)),code);
  for(const type of ['sbyte','byte','short','ushort','int','uint','long','ulong','char','float','double','decimal','bool','string','null','Color','Big'])assert(corpus.rows.some(r=>r.type===type&&r.constant!==false),type);
});
test('A02-T32 constant folding matches Roslyn results and diagnostics on the whole corpus',()=>{
  const failures=[];let viaSyntax=0;
  for(const row of corpus.rows){
    const want=expected(row);let got;
    try{
      got=render(evaluate(parseCSharp(row.expression),row.checked));
      const ast=parseWithSyntaxPackage(row.expression);
      if(ast){viaSyntax++;assert.deepEqual(render(evaluate(ast,row.checked)),got,'packages/syntax and the test parser disagree');}
      assert.deepEqual(got,want);
    }catch(error){failures.push(`${row.checked?'checked  ':'unchecked'} ${row.expression}\n    roslyn: ${JSON.stringify(row.diagnostics?{diagnostics:row.diagnostics,messages:row.messages}:want)}\n    fold:   ${got?JSON.stringify(got):error.message}`);}
  }
  assert(viaSyntax>=100,'packages/syntax should drive a meaningful share of the corpus, drove '+viaSyntax);
  assert.equal(failures.length,0,`${failures.length} of ${corpus.rows.length} rows differ from Roslyn:\n`+failures.slice(0,60).join('\n'));
});
