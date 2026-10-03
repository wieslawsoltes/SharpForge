import {frameworkType,enumTypes} from '@sharpforge/framework';
import {decodeCoded,systemType} from '@sharpforge/cil';
import {ManagedFault,isReference} from '../heap.js';

const widths={sbyte:[8,true],byte:[8,false],short:[16,true],ushort:[16,false],int:[32,true],uint:[32,false],long:[64,true],ulong:[64,false]};
const constantKinds={4:'sbyte',5:'byte',6:'short',7:'ushort',8:'int',9:'uint',10:'long',11:'ulong'};
const aliases={'System.SByte':'sbyte','System.Byte':'byte','System.Int16':'short','System.UInt16':'ushort','System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong'};

export function enumUnderlying(value,type='int') {
  const width=widths[aliases[type]??type];
  if(!width)throw new ManagedFault('InvalidProgramException','Invalid enum underlying type');
  const number=value?.enumType?value.value:value;
  if(typeof number!=='bigint'&&!Number.isInteger(number))throw new ManagedFault('InvalidProgramException','Enum value must be integral');
  const result=width[1]?BigInt.asIntN(width[0],BigInt(number)):BigInt.asUintN(width[0],BigInt(number));
  return width[0]===64?result:Number(result);
}
function constant(metadata,row) {
  const kind=constantKinds[row[0]&255],width=widths[kind];
  if(!width)return null;
  const bytes=metadata.blob(row[2]);
  if(bytes.length!==width[0]/8)throw new ManagedFault('InvalidProgramException','Malformed enum constant');
  let value=0n;for(let i=bytes.length-1;i>=0;i--)value=(value<<8n)|BigInt(bytes[i]);
  return enumUnderlying(value,kind);
}
/** Read framework or independent ECMA-335 enum metadata without treating it as Int32. */
export function enumInfo(vm,type) {
  const framework=frameworkType(type);
  if(framework?.kind==='enum')return {name:framework.name,underlyingType:framework.underlyingType??'int',members:Object.entries(framework.values),flags:!!framework.flags};
  const inspector=vm.inspector;
  if(!inspector)return null;
  const definition=inspector.types.find(item=>item.name===type||item.token===type);
  if(!definition?.baseToken||systemType(inspector.metadata.typeName(definition.baseToken))!=='System.Enum')return null;
  const storage=definition.fields.find(field=>!field.isStatic&&field.name==='value__');
  const underlyingType=storage&&(aliases[inspector.signature(storage.token).type]??inspector.signature(storage.token).type);
  if(!widths[underlyingType])throw new ManagedFault('InvalidProgramException','Enum requires an integral value__ field');
  const metadata=inspector.metadata,byToken=new Map(definition.fields.filter(field=>field.isStatic&&(field.flags&64)).map(field=>[field.token,field.name])),members=[];
  for(const row of metadata.rows[11]??[]) {
    const name=byToken.get(decodeCoded('HasConstant',row[1]));
    if(name!==undefined){const value=constant(metadata,row);if(value!==null)members.push([name,enumUnderlying(value,underlyingType)]);}
  }
  const flags=(metadata.rows[12]??[]).some(row=>decodeCoded('HasCustomAttribute',row[0])===definition.token&&inspector.resolveToken(decodeCoded('CustomAttributeType',row[1])).owner==='System.FlagsAttribute');
  return {name:definition.name,token:definition.token,underlyingType,members,flags};
}
export function enumValue(vm,type,value) {
  const info=enumInfo(vm,type);
  if(!info)throw new ManagedFault('InvalidProgramException','Enum type is not registered');
  return Object.freeze({enumType:info.name,underlyingType:info.underlyingType,value:enumUnderlying(value,info.underlyingType)});
}
export function sourceEnum(vm,index,value) { return enumValue(vm,enumTypes[index],value); }
export function enumPayload(vm,value) {
  if(value?.enumType)return {type:value.enumType,value:value.value};
  if(isReference(value)) { const record=vm.heap.get(value);if(record.kind==='box'&&enumInfo(vm,record.type))return {type:record.type,value:record.data[0]}; }
  return null;
}
export function enumToString(vm,value,type) {
  const payload=enumPayload(vm,value)??(type?{type,value}:null);if(!payload)return null;
  const info=enumInfo(vm,payload.type);if(!info)return null;
  const raw=enumUnderlying(payload.value,info.underlyingType),exact=info.members.find(([,number])=>BigInt(number)===BigInt(raw));
  if(exact)return exact[0];
  if(info.flags&&raw!==0&&raw!==0n) {
    const bits=widths[info.underlyingType][0],unsigned=number=>BigInt.asUintN(bits,BigInt(number));
    let remaining=unsigned(raw);const names=[];
    const members=[...info.members].filter(([,number])=>unsigned(number)!==0n).sort((a,b)=>unsigned(a[1])<unsigned(b[1])?1:-1);
    for(const [name,number] of members){const mask=unsigned(number);if((remaining&mask)===mask){remaining&=~mask;names.unshift(name);}}
    if(remaining===0n&&names.length)return names.join(', ');
  }
  return String(raw);
}
export function enumHasFlag(vm,value,flag) {
  if(flag===null)throw new ManagedFault('ArgumentNullException','Flag cannot be null');
  const left=enumPayload(vm,value),right=enumPayload(vm,flag);
  if(!left||!right||left.type!==right.type)throw new ManagedFault('ArgumentException','Flag must have the same enum type');
  const a=BigInt(left.value),b=BigInt(right.value);return (a&b)===b;
}
