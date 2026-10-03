import {OpName,BinaryName,UnaryName,Builtins} from '../../../packages/bytecode/src/index.js';
import {canonicalType,frameworkType,frameworkAssignable} from '../../../packages/framework/src/index.js';
import {SchemaError} from './validate.js';

const fail=(code,message)=>{throw new SchemaError(code,message);};
const primitiveNames={bool:'System.Boolean',char:'System.Char',byte:'System.Byte',sbyte:'System.SByte',short:'System.Int16',ushort:'System.UInt16',int:'System.Int32',uint:'System.UInt32',long:'System.Int64',ulong:'System.UInt64',nint:'System.IntPtr',nuint:'System.UIntPtr',float:'System.Single',double:'System.Double',void:'System.Void',string:'System.String',object:'System.Object',Exception:'System.Exception'};
const stackPrimitives={'System.Void':'void','System.Boolean':'i32','System.Char':'i32','System.Byte':'i32','System.SByte':'i32','System.Int16':'i32','System.UInt16':'i32','System.Int32':'i32','System.UInt32':'i32','System.Int64':'i64','System.UInt64':'i64','System.IntPtr':'nativeint','System.UIntPtr':'nativeint','System.Single':'f32','System.Double':'f64'};
export const IR_OPERATIONS=Object.freeze(['nop','constant','load-local','store-local','load-argument','store-argument','local-address','argument-address','load-static','store-static','static-address','load-field','store-field','field-address','duplicate','discard','binary','unary','compare','convert','branch','branch-if','compare-branch','switch','leave','call','return','new-object','new-array','new-delegate','load-element','store-element','element-address','length','throw','rethrow','end-finally','function-address','box','unbox','cast','is-instance','check-finite','size-of']);
const integers=new Set(['i32','i64','nativeint']),numeric=new Set([...integers,'f32','f64']);
export function typeName(name){
  if(typeof name!=='string'||!name)fail('SCHEMA_TYPE_CONFLICT','Missing declared type');
  name=canonicalType(name);
  if(name.endsWith('[]'))return typeName(name.slice(0,-2))+'[]';
  return primitiveNames[name]??name;
}
export function stackType(name){
  name=typeName(name);
  if(name.endsWith('&'))return 'byref:'+stackType(name.slice(0,-1));
  if(name.endsWith('*'))return 'pointer:'+stackType(name.slice(0,-1));
  if(/(^|[<,])\s*!/.test(name)||['any','numeric','number','array','exception'].includes(name))fail('SCHEMA_UNSUPPORTED',`Unresolved declared type ${name}`);
  if(frameworkType(name)?.kind==='enum')return 'i32';
  return stackPrimitives[name]??'ref:'+name;
}
const reference=t=>t==='null'||t?.startsWith('ref:');
function assignable(actual,expected,context){
  if(actual===expected)return true;
  if(context.image&&actual==='i32'&&['f32','f64'].includes(expected))return true;
  if(actual==='null'&&expected.startsWith('ref:'))return true;
  if(['f32','f64'].includes(actual)&&['f32','f64'].includes(expected))return true;
  if(actual.startsWith('ref:')&&expected.startsWith('ref:')){
    const a=actual.slice(4),e=expected.slice(4);
    if(e==='System.Object'||e==='System.Array'&&a.endsWith('[]')||frameworkAssignable(e,a))return true;
    if(context.inspector){let type=context.inspector.types.find(t=>typeName(t.name)===a);const seen=new Set();while(type&&!seen.has(type.token)){seen.add(type.token);if(typeName(type.name)===e)return true;if(type.interfaces?.some(t=>typeName(context.inspector.metadata.typeName(t))===e))return true;type=context.inspector.types.find(t=>t.token===type.baseToken);}}
  }
  return false;
}
export function mergeType(a,b,context={}){
  if(a===b)return a;
  if(a==='null'&&b.startsWith('ref:'))return b;if(b==='null'&&a.startsWith('ref:'))return a;
  if(['f32','f64'].includes(a)&&['f32','f64'].includes(b))return 'f64';
  if(a.startsWith('ref:')&&b.startsWith('ref:'))return assignable(a,b,context)?b:assignable(b,a,context)?a:'ref:System.Object';
  fail('SCHEMA_TYPE_CONFLICT',`Incompatible control-flow types ${a} and ${b}`);
}
const integral=t=>integers.has(t);
function expect(actual,expected,context,where){
  const ok=expected==='any'?actual!=='void':expected==='number'||expected==='numeric'?numeric.has(actual):expected==='array'?actual==='null'||actual.startsWith('ref:')&&actual.endsWith('[]'):expected==='exception'?reference(actual):assignable(actual,expected,context);
  if(!ok)fail('SCHEMA_TYPE_CONFLICT',`${where}: ${actual} is not assignable to ${expected}`);
}
const signatureType=name=>['any','numeric','number','array','exception'].includes(name)?name:stackType(name);
function commonNumeric(types,{promote=false}={}){if(!types.length||types.some(t=>!numeric.has(t)))fail('SCHEMA_TYPE_CONFLICT','Numeric operands required');if(promote&&types.some(t=>['f32','f64'].includes(t))&&types.every(t=>['i32','f32','f64'].includes(t)))return types.includes('f64')?'f64':'f32';return types.reduce((a,b)=>a===b?a:['f32','f64'].includes(a)&&['f32','f64'].includes(b)?'f64':fail('SCHEMA_TYPE_CONFLICT',`Numeric width conflict ${a}/${b}`));}
function arrayElement(array){if(!array.startsWith('ref:')||!array.endsWith('[]'))fail('SCHEMA_TYPE_CONFLICT',`An exact array type is required, received ${array}`);return stackType(array.slice(4,-2));}
function sourceField(context,owner,index){if(!owner.startsWith('ref:'))fail('SCHEMA_TYPE_CONFLICT','Field receiver requires a declared reference type');const type=context.image.types.find(t=>typeName(t.name)===owner.slice(4)),field=type?.fields[index];if(!field)fail('SCHEMA_INVALID',`Unknown field ${owner}/${index}`);return {owner:owner.slice(4),name:field.name,type:stackType(field.type),storageType:typeName(field.type),index};}
function sourceTarget(method){return {id:String(method.id),owner:method.owner===null?null:typeName(method.owner),name:method.name,parameters:[...(!method.isStatic?[stackType(method.owner)]:[]),...method.parameters.map(p=>stackType(p.type))],returnType:stackType(method.returnType),parameterStorage:[...(!method.isStatic?[typeName(method.owner)]:[]),...method.parameters.map(p=>typeName(p.type))],returnStorage:typeName(method.returnType)};}
function cilTarget(inspector,token){const d=inspector.resolveToken(token);if(d.kind!=='method'||d.genericArguments||d.signature.genericArity)fail('SCHEMA_UNSUPPORTED','Uninstantiated or unknown method signature');return {id:String(token),owner:typeName(d.owner),name:d.name,parameters:[...(!d.signature.isStatic?[stackType(d.owner)]:[]),...d.signature.parameters.map(stackType)],returnType:stackType(d.signature.returnType),parameterStorage:[...(!d.signature.isStatic?[typeName(d.owner)]:[]),...d.signature.parameters.map(typeName)],returnStorage:typeName(d.signature.returnType),isStatic:d.signature.isStatic};}

/** Lower one instruction. Every effect is explicit, including source-VM value-retaining stores. */
function transfer(raw,offset,input,env){
  const {method,encoding,context,index,locals,parameters,returnType,regions}=env,source=encoding==='bytecode',name=raw.name;
  const args=source?raw.operand:[raw.operand],a=args[0],b=args[1],next=offset+1;
  const peek=n=>{if(input.length<n)fail('SCHEMA_TYPE_CONFLICT',`${name}@${offset}: evaluation stack underflow`);return input.slice(input.length-n);};
  const emit=(opcode,operands,pops,outputs,expected=null,successors=[next])=>{
    const inputs=peek(pops);if(expected)inputs.forEach((t,i)=>expect(t,expected[i],context,`${name}@${offset} operand ${i}`));
    return {offset,opcode,operands,inputTypes:inputs,outputTypes:outputs,resultType:outputs.at(-1)??'void',stackIn:[...input],stackOut:[...input.slice(0,input.length-pops),...outputs],successors,sourceEncoding:encoding,sourceOffset:raw.offset,sourceOpcode:name};
  };
  const branchTarget=target=>index(target,false);
  const local=(slot,arg=false)=>{const slots=arg?parameters:locals;if(!Number.isInteger(slot)||slot<0||slot>=slots.length)fail('SCHEMA_INVALID',`Unknown ${arg?'argument':'local'} slot ${slot}`);return slots[slot];};
  const call=(target,count,{construct=false,padding=false}={})=>{const expected=construct?target.parameters.slice(1):target.parameters;if(count!==expected.length)fail('SCHEMA_TYPE_CONFLICT','Call argument count differs from signature');const result=construct?stackType(target.owner):target.returnType;return emit(construct?'new-object':'call',[{...target,voidResult:padding?'null':'none'}],count,result==='void'?(padding?['null']:[]):[result],expected);};
  const binary=(operator,mode={})=>{const [left,right]=peek(2);let result;if(['==','!=','<','<=','>','>='].includes(operator)){if(reference(left)&&reference(right)){if(!['==','!='].includes(operator))fail('SCHEMA_TYPE_CONFLICT','Reference ordering is unsupported');}else commonNumeric([left,right],{promote:source});result='i32';}else if(mode.string){if(operator!=='+')fail('SCHEMA_TYPE_CONFLICT','Invalid string binary operation');result='ref:System.String';}else{result=commonNumeric([left,right],{promote:source});if(['&','|','^','<<','>>'].includes(operator)&&!integral(result))fail('SCHEMA_TYPE_CONFLICT','Integer operands required');if(mode.integer&&result!=='i32')fail('SCHEMA_TYPE_CONFLICT','Int32 binary mode requires Int32 operands');}return emit(['==','!=','<','<=','>','>='].includes(operator)?'compare':'binary',[operator,mode],2,[result]);};
  if(source){
    switch(name){
      case 'SEQ':case 'NOP':return emit('nop',[],0,[]);
      case 'CONST':{if(![0,1].includes(b))fail('SCHEMA_UNSUPPORTED','Unknown constant numeric hint');if(!Number.isInteger(a)||a<0||a>=context.image.constants.length)fail('SCHEMA_INVALID','Invalid constant index');const value=context.image.constants[a],type=value===null?'null':typeof value==='string'?'ref:System.String':typeof value==='boolean'?'i32':typeof value==='number'?(b===1?'f64':Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?'i32':'f64'):fail('SCHEMA_UNSUPPORTED','Unsupported constant carrier');return emit('constant',[typeof value==='boolean'?Number(value):value],0,[type]);}
      case 'ENUM':return emit('constant',[b],0,['i32']);
      case 'LDLOC':return emit('load-local',[a],0,[local(a)]);
      case 'STLOC':return emit('store-local',[a,{retainValue:true}],1,[local(a)],[local(a)]);
      case 'LDSTATIC':case 'STSTATIC':{const field=context.image.statics[a];if(!field)fail('SCHEMA_INVALID','Unknown static field');const type=stackType(field.type);return name==='LDSTATIC'?emit('load-static',[{id:a,name:field.name,type,storageType:typeName(field.type)}],0,[type]):emit('store-static',[{id:a,name:field.name,type,storageType:typeName(field.type)},{retainValue:true}],1,[type],[type]);}
      case 'LDFLD':case 'STFLD':{const values=peek(name==='LDFLD'?1:2),field=sourceField(context,values[0],a);return name==='LDFLD'?emit('load-field',[field],1,[field.type],[stackType(field.owner)]):emit('store-field',[field,{retainValue:true}],2,[field.type],[stackType(field.owner),field.type]);}
      case 'DUP':return emit('duplicate',[],1,[peek(1)[0],peek(1)[0]]);
      case 'POP':return emit('discard',[],1,[]);
      case 'BINARY':if(!BinaryName[a])fail('SCHEMA_INVALID','Unknown binary operation');return binary(BinaryName[a],{integer:b===1||b===5,checked:b===5,string:b===2});
      case 'UNARY':{if(!UnaryName[a])fail('SCHEMA_INVALID','Unknown unary operation');const type=peek(1)[0];if(!numeric.has(type))fail('SCHEMA_TYPE_CONFLICT','Unary operand must be numeric');return emit('unary',[UnaryName[a],{checked:b===5}],1,[UnaryName[a]==='!'?'i32':type]);}
      case 'CONVERT':{if(!numeric.has(peek(1)[0]))fail('SCHEMA_TYPE_CONFLICT','Numeric conversion required');if(![0,1].includes(a))fail('SCHEMA_UNSUPPORTED','Unknown source numeric conversion');return emit('convert',[a===0?'i32':'f64',{checked:b===1}],1,[a===0?'i32':'f64']);}
      case 'JUMP':{const target=branchTarget(a),unwinds=regions.map((r,i)=>r.kind==='finally'&&offset>=r.start&&offset<r.end&&!(target>=r.start&&target<r.end)?i:null).filter(i=>i!==null);return emit(unwinds.length?'leave':'branch',[target,...(unwinds.length?[{unwindRegions:unwinds}]:[])],unwinds.length?input.length:0,[],null,[target]);}
      case 'JFALSE':case 'JTRUE':return emit('branch-if',[branchTarget(a),name==='JTRUE'],1,[],['i32'],[branchTarget(a),next]);
      case 'CALL':{const target=context.image.methods[a];if(!target)fail('SCHEMA_INVALID','Unknown call target');return call(sourceTarget(target),b,{padding:true});}
      case 'BUILTIN':{const builtin=Builtins[a];if(!builtin||b<builtin.min||b>builtin.max)fail('SCHEMA_INVALID','Unknown builtin or argument count');const values=peek(b),expected=builtin.params.slice(0,b).map(signatureType);if(expected.length!==b)fail('SCHEMA_UNSUPPORTED','Builtin optional signature is unavailable');const result=builtin.result==='numeric'?commonNumeric(values,{promote:true}):signatureType(builtin.result);if(['any','number','array','exception'].includes(result))fail('SCHEMA_UNSUPPORTED',`Unresolved builtin result ${builtin.name}`);return emit('call',[{id:'builtin:'+builtin.id,owner:builtin.contract?.owner??null,name:builtin.name,parameters:expected,returnType:result,voidResult:'null'}],b,result==='void'?['null']:[result],expected);}
      case 'RET':{expect(peek(1)[0],returnType==='void'?'null':returnType,context,'Return');if(input.length!==1)fail('SCHEMA_TYPE_CONFLICT','Return must consume the complete evaluation stack');return emit('return',[{discardPadding:returnType==='void'}],1,[],null,[]);}
      case 'NEWOBJ':{const type=context.image.types[a];if(!type)fail('SCHEMA_INVALID','Unknown object type');return emit('new-object',[{type:typeName(type.name),constructor:null}],0,[stackType(type.name)]);}
      case 'NEWARR':{const type=context.image.constants[a];if(typeof type!=='string')fail('SCHEMA_INVALID','Array element type is not declared');return emit('new-array',[typeName(type)],1,[stackType(typeName(type)+'[]')],['i32']);}
      case 'LDELEM':{const [array]=peek(2),type=arrayElement(array);return emit('load-element',[type],2,[type],[array,'i32']);}
      case 'STELEM':{const values=peek(3),type=arrayElement(values[0]);return emit('store-element',[type,{retainValue:true}],3,[type],[values[0],'i32',type]);}
      case 'LENGTH':{const type=peek(1)[0];if(type!=='ref:System.String')arrayElement(type);return emit('length',[],1,['i32']);}
      case 'THROW':if(!reference(peek(1)[0]))fail('SCHEMA_TYPE_CONFLICT','Thrown value must be an exception reference');return emit('throw',[],1,[],null,[]);
      case 'RETHROW':return emit('rethrow',[],0,[],null,[]);
      case 'ENDFINALLY':if(input.length)fail('SCHEMA_TYPE_CONFLICT','Finally exit stack is not empty');return emit('end-finally',[],0,[],null,[]);
      case 'DELEGATE':{const target=context.image.methods[a],type=context.image.constants[b];if(!target||frameworkType(type)?.kind!=='delegate')fail('SCHEMA_INVALID','Unknown delegate target');const expected=target.isStatic?'ref:System.Object':stackType(target.owner);return emit('new-delegate',[sourceTarget(target),typeName(type)],1,[stackType(type)],[expected]);}
      default:fail('SCHEMA_UNSUPPORTED',`Unsupported source opcode ${name}`);
    }
  }
  const inspector=context.inspector;
  if(['nop','break'].includes(name))return emit('nop',[],0,[]);
  if(name==='ldnull')return emit('constant',[null],0,['null']);
  if(name==='ldstr')return emit('constant',[inspector.resolveToken(a).value],0,['ref:System.String']);
  if(/^ldc\./.test(name)){const type=name.startsWith('ldc.i4')?'i32':name==='ldc.i8'?'i64':name==='ldc.r4'?'f32':name==='ldc.r8'?'f64':fail('SCHEMA_UNSUPPORTED','Unknown CIL constant');const value=a??(name.endsWith('.m1')?-1:Number(name.split('.').at(-1)));return emit('constant',[typeof value==='bigint'?value.toString():value],0,[type]);}
  if(/^(ldarg|ldarga|starg|ldloc|ldloca|stloc)(\.|$)/.test(name)){const slot=a??Number(name.split('.').at(-1)),arg=name.includes('arg'),type=local(slot,arg);return name.startsWith('st')?emit(arg?'store-argument':'store-local',[slot,{retainValue:false}],1,[],[type]):emit(name.startsWith('ldarga')?'argument-address':name.startsWith('ldloca')?'local-address':arg?'load-argument':'load-local',[slot],0,[name.startsWith('ldarga')||name.startsWith('ldloca')?'byref:'+type:type]);}
  if(name==='dup')return emit('duplicate',[],1,[peek(1)[0],peek(1)[0]]);
  if(name==='pop')return emit('discard',[],1,[]);
  if(['call','callvirt','newobj'].includes(name)){const target=cilTarget(inspector,a);if(name==='newobj'&&target.isStatic)fail('SCHEMA_TYPE_CONFLICT','Constructor must be an instance method');return call(target,target.parameters.length-(name==='newobj'?1:0),{construct:name==='newobj'});}
  if(name==='ldftn')return emit('function-address',[cilTarget(inspector,a)],0,['nativeint']);
  if(name==='ret'){if(returnType!=='void')expect(peek(1)[0],returnType,context,'Return');if(input.length!==(returnType==='void'?0:1))fail('SCHEMA_TYPE_CONFLICT','Return stack differs from signature');return emit('return',[{discardPadding:false}],input.length,[],null,[]);}
  if(/^br(\.s)?$/.test(name))return emit('branch',[branchTarget(a)],0,[],null,[branchTarget(a)]);
  if(/^leave(\.s)?$/.test(name))return emit('leave',[branchTarget(a)],input.length,[],null,[branchTarget(a)]);
  if(/^br(true|false)(\.s)?$/.test(name)){if(!integral(peek(1)[0])&&!reference(peek(1)[0]))fail('SCHEMA_TYPE_CONFLICT','Branch condition must be integer or reference');return emit('branch-if',[branchTarget(a),name.startsWith('brtrue')],1,[],null,[branchTarget(a),next]);}
  if(/^b(eq|ge|gt|le|lt|ne)(\.un)?(\.s)?$/.test(name)){const [left,right]=peek(2);if(!(reference(left)&&reference(right)))commonNumeric([left,right]);return emit('compare-branch',[name.split('.')[0],branchTarget(a),{unsigned:name.includes('.un')}],2,[],null,[branchTarget(a),next]);}
  if(name==='switch'){if(!Array.isArray(a))fail('SCHEMA_INVALID','Switch target vector required');const targets=a.map(branchTarget);return emit('switch',[targets],1,[],['i32'],[...targets,next]);}
  const op=name.split('.')[0],operators={add:'+',sub:'-',mul:'*',div:'/',rem:'%',and:'&',or:'|',xor:'^',shl:'<<',shr:'>>',ceq:'==',cgt:'>',clt:'<'};
  if(operators[op]){if(['shl','shr'].includes(op)){const [value,count]=peek(2);if(!integral(value)||!['i32','nativeint'].includes(count))fail('SCHEMA_TYPE_CONFLICT','Shift operands require integer value and count');return emit('binary',[operators[op],{unsigned:name.includes('.un')}],2,[value]);}return binary(operators[op],{checked:name.includes('.ovf'),unsigned:name.includes('.un')});}
  if(['neg','not'].includes(name)){const type=peek(1)[0];if(!numeric.has(type)||name==='not'&&!integral(type))fail('SCHEMA_TYPE_CONFLICT','Invalid unary numeric type');return emit('unary',[name==='neg'?'-':'~'],1,[type]);}
  if(name.startsWith('conv.')){const match=/^conv\.(?:ovf\.)?(i1|u1|i2|u2|i4|u4|i8|u8|i|u|r4|r8|r)(?:\.un)?$/.exec(name);if(!match)fail('SCHEMA_UNSUPPORTED','Unknown conversion');const target=match[1],type=['i8','u8'].includes(target)?'i64':['i','u'].includes(target)?'nativeint':target==='r4'?'f32':['r8','r'].includes(target)?'f64':'i32';if(!numeric.has(peek(1)[0]))fail('SCHEMA_TYPE_CONFLICT','Numeric conversion required');return emit('convert',[type,{storage:target,checked:name.includes('.ovf'),unsigned:name.includes('.un')}],1,[type]);}
  if(['ldfld','stfld','ldflda','ldsfld','stsfld','ldsflda'].includes(name)){const field=inspector.resolveToken(a);if(field.kind!=='field')fail('SCHEMA_INVALID','Field token required');const type=stackType(field.signature.type),descriptor={id:String(a),owner:typeName(field.owner),name:field.name,type,storageType:typeName(field.signature.type)},stat=name.includes('sf'),write=name.startsWith('st'),address=name.endsWith('a');return emit(stat?(write?'store-static':address?'static-address':'load-static'):(write?'store-field':address?'field-address':'load-field'),[descriptor,...(write?[{retainValue:false}]:[])],(stat?0:1)+(write?1:0),write?[]:[address?'byref:'+type:type],[...(!stat?[stackType(field.owner)]:[]),...(write?[type]:[])]);}
  if(name==='newarr'){const type=typeName(inspector.metadata.typeName(a));return emit('new-array',[type],1,[stackType(type+'[]')],['i32']);}
  if(name==='ldlen'){arrayElement(peek(1)[0]);return emit('length',[],1,['nativeint']);}
  if(name==='ldelema'||/^([ls]delem|stelem)(\.|$)/.test(name)){
    const write=name.startsWith('st'),values=peek(write?3:2),actual=values[0]==='null'?null:arrayElement(values[0]);let type;
    if(name==='ldelem'||name==='stelem'||name==='ldelema')type=stackType(inspector.metadata.typeName(a));else{const suffix=name.split('.').at(-1);type=suffix==='ref'?actual:({i1:'i32',u1:'i32',i2:'i32',u2:'i32',i4:'i32',u4:'i32',i8:'i64',i:'nativeint',r4:'f32',r8:'f64'}[suffix]);}
    if(!type)fail('SCHEMA_UNSUPPORTED','Array element type cannot be resolved');if(actual&&!assignable(actual,type,context)&&!assignable(type,actual,context))fail('SCHEMA_TYPE_CONFLICT','Array element opcode differs from its declared element type');
    return emit(write?'store-element':name==='ldelema'?'element-address':'load-element',[type,...(write?[{retainValue:false}]:[])],write?3:2,write?[]:[name==='ldelema'?'byref:'+type:type],[values[0],'i32',...(write?[type]:[])]);
  }
  if(name==='throw'){if(!reference(peek(1)[0]))fail('SCHEMA_TYPE_CONFLICT','Thrown value must be a reference');return emit('throw',[],1,[],null,[]);}
  if(name==='rethrow')return emit('rethrow',[],0,[],null,[]);
  if(name==='endfinally'){if(input.length)fail('SCHEMA_TYPE_CONFLICT','Finally exit stack is not empty');return emit('end-finally',[],0,[],null,[]);}
  if(['castclass','isinst','box','unbox','unbox.any'].includes(name)){const type=stackType(inspector.metadata.typeName(a)),boxed='ref:'+typeName(inspector.metadata.typeName(a));if(name==='box')return emit('box',[type],1,[boxed],[type]);if(!reference(peek(1)[0]))fail('SCHEMA_TYPE_CONFLICT','Reference operand required');return emit(name==='castclass'?'cast':name==='isinst'?'is-instance':'unbox',[type],1,[name==='unbox'?'byref:'+type:name==='unbox.any'?type:boxed]);}
  if(name==='ckfinite'){const type=peek(1)[0];if(!['f32','f64'].includes(type))fail('SCHEMA_TYPE_CONFLICT','Finite check requires floating operand');return emit('check-finite',[],1,[type]);}
  if(name==='sizeof')return emit('size-of',[typeName(inspector.metadata.typeName(a))],0,['i32']);
  if(['ldobj','stobj','cpobj','initobj'].includes(name)||/^[ls]t?d?ind\./.test(name))fail('SCHEMA_UNSUPPORTED',`Indirect memory instruction ${name} requires an owned address/lifetime proof`);
  fail('SCHEMA_UNSUPPORTED',`Unsupported CIL opcode ${name}`);
}

export function lowerMethodBody(method,encoding,context={}){
  if(!['bytecode','cil'].includes(encoding))fail('SCHEMA_UNSUPPORTED','Unknown body encoding');
  if(encoding==='bytecode'&&!context.image||encoding==='cil'&&!context.inspector)fail('SCHEMA_CONTEXT','Lowering requires image or inspector metadata');
  const source=encoding==='bytecode',code=method.code;
  if(source&&(!(code instanceof Int32Array)||code.length%3))fail('SCHEMA_INVALID','Bytecode triples required');
  const raw=source?Array.from({length:code.length/3},(_,offset)=>({offset,name:OpName[code[offset*3]],operand:[code[offset*3+1],code[offset*3+2]]})):method.instructions;
  if(!raw?.length||raw.length>1_000_000)fail('SCHEMA_LIMIT','Body instruction count outside supported limits');
  if(raw[0].offset!==0||raw.some((i,n)=>!Number.isInteger(i.offset)||i.offset<0||n>0&&i.offset<=raw[n-1].offset))fail('SCHEMA_INVALID','Instruction offsets must start at zero and increase');
  const offsets=new Map(raw.map((i,n)=>[i.offset,n]));if(offsets.size!==raw.length)fail('SCHEMA_INVALID','Duplicate instruction offsets');
  const end=source?raw.length:method.codeSize;if(!Number.isInteger(end)||end<=raw.at(-1).offset)fail('SCHEMA_INVALID','Method end must follow its last instruction');offsets.set(end,raw.length);
  const index=(offset,allowEnd=true)=>{const value=offsets.get(offset);if(value===undefined||!allowEnd&&value===raw.length)fail('SCHEMA_INVALID',`Offset ${offset} is not an instruction boundary`);return value;};
  const signature=source?sourceTarget(method):cilTarget(context.inspector,method.token),locals=method.locals.map(l=>stackType(typeof l==='string'?l:l.type)),parameters=signature.parameters,returnType=signature.returnType;
  const regions=(method.handlers??[]).map(h=>{
    const kind=h.kind??({0:'catch',1:'filter',2:'finally',4:'fault'}[h.flags??0]);if(!['catch','finally'].includes(kind))fail('SCHEMA_UNSUPPORTED',`Exception region ${kind} is not executable in this lowering profile`);
    let handlerEnd=h.handlerEnd;
    if(source&&kind==='catch'){const sibling=method.handlers.filter(other=>other.start===h.start&&other.end===h.end&&other.target>h.target).sort((a,b)=>a.target-b.target)[0];handlerEnd=sibling?.target??code[h.end*3+1];}
    if(handlerEnd===undefined)fail('SCHEMA_INVALID','Handler end is missing');
    return {kind,start:index(h.start),end:index(source&&kind==='finally'?h.end+1:h.end),handlerStart:index(h.target,false),handlerEnd:index(handlerEnd),catchType:kind==='catch'?stackType(source?(h.type??method.locals[h.slot]?.type??'Exception'):context.inspector.metadata.typeName(h.catchType)):null,filterStart:null};
  });
  for(const r of regions)if(r.start>=r.end||r.handlerStart>=r.handlerEnd)fail('SCHEMA_INVALID','Empty or reversed exception region');
  const env={method,encoding,context,index,locals,parameters,returnType,regions},states=new Map(),instructions=Array(raw.length),queue=[];
  const enqueue=(offset,state)=>{if(!Number.isInteger(offset)||offset<0||offset>=raw.length)fail('SCHEMA_INVALID','Control flow leaves method body');const old=states.get(offset);if(!old){states.set(offset,[...state]);queue.push(offset);return;}if(old.length!==state.length)fail('SCHEMA_TYPE_CONFLICT',`Stack height differs at join ${offset}`);const merged=old.map((t,i)=>mergeType(t,state[i],context));if(merged.some((t,i)=>t!==old[i])){states.set(offset,merged);queue.push(offset);}};
  enqueue(0,[]);for(const r of regions)enqueue(r.handlerStart,!source&&r.kind==='catch'?[r.catchType]:[]);
  let iterations=0,head=0;
  while(true){
    while(head<queue.length){if(++iterations>raw.length*64)fail('SCHEMA_LIMIT','Type propagation did not converge');const offset=queue[head++],instruction=transfer(raw[offset],offset,states.get(offset),env);instructions[offset]=instruction;for(const target of instruction.successors)enqueue(target,instruction.stackOut);}
    // Compiler-generated dead epilogues form independent blocks; check their types too.
    const unvisited=instructions.findIndex(i=>!i);if(unvisited<0)break;enqueue(unvisited,[]);
  }
  const safepoints=[];for(const i of instructions){if(['call','return'].includes(i.opcode))safepoints.push({offset:i.offset,kind:2});if(['new-object','new-array','new-delegate','box'].includes(i.opcode))safepoints.push({offset:i.offset,kind:3});if(i.successors.some(target=>target<=i.offset))safepoints.push({offset:i.offset,kind:1});if(i.opcode==='call'&&/\b(Await|Yield)\b/.test(i.operands[0]?.name??''))safepoints.push({offset:i.offset,kind:5});}
  return {schemaVersion:1,methodId:signature.id,encoding,typeState:'resolved',offsetUnit:'instruction',parameters,parameterStorageTypes:signature.parameterStorage,returnType,returnStorageType:signature.returnStorage,locals,localStorageTypes:method.locals.map(l=>typeName(typeof l==='string'?l:l.type)),instructions,exceptionRegions:regions,safepoints,maxStack:instructions.reduce((max,i)=>Math.max(max,i.stackIn.length,i.stackOut.length),0)};
}
