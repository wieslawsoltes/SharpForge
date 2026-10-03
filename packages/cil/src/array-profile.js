import {arrayRuntimeDefinition} from './array-runtime-profile.js';
import {canonicalType} from '@sharpforge/framework';

const aliases={Array:'System.Array','System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.Int16':'short','System.UInt16':'ushort','System.SByte':'sbyte','System.Byte':'byte','System.Char':'char','System.Boolean':'bool','System.Single':'float','System.Double':'double','System.Object':'object','System.String':'string','System.Void':'void'};
function canonical(name) {
  if(typeof name!=='string')return null;
  if(name.endsWith('&'))return canonical(name.slice(0,-1))+'&';
  if(name.endsWith('[]'))return canonical(name.slice(0,-2))+'[]';
  const type=canonicalType(name);return aliases[type]??type;
}
const indices=(parameters,count,type='int')=>parameters.length===count&&parameters.every(item=>canonical(item)===type);
/** Array pseudo-methods are CLR-provided methods on ARRAY TypeSpecs, not MethodDefs. */
export function arrayMethodDefinition(descriptor) {
  const runtime=arrayRuntimeDefinition(descriptor);if(runtime)return runtime;
  if(descriptor?.kind!=='method'||!descriptor.signature||!Array.isArray(descriptor.signature.parameters))return null;
  const {name,owner,signature}=descriptor,{parameters,isStatic}=signature,result=canonical(signature.returnType);
  if(signature.genericArity||signature.callingConvention||descriptor.genericArguments)return null;
  let operation=null,rank=0,elementType=null;
  const array=/^(.*)\[([^\[\]]*)\]$/.exec(owner);
  if(array&&array[2]!==''&&!isStatic) {
    const dimensions=array[2].split(',');
    if(!dimensions.every(part=>part===''||part==='*'&&dimensions.length===1||/^-?\d+\.\.\.-?\d*$/.test(part)))return null;
    rank=dimensions.length;elementType=array[1];if(rank>32)return null;
    if(name==='.ctor'&&result==='void'&&(indices(parameters,rank)||indices(parameters,rank*2)))operation='construct';
    else if(name==='Get'&&indices(parameters,rank)&&canonical(elementType)===result)operation='get';
    else if(name==='Set'&&result==='void'&&indices(parameters.slice(0,-1),rank)&&canonical(parameters.at(-1))===canonical(elementType))operation='set';
    else if(name==='Address'&&indices(parameters,rank)&&result===canonical(elementType)+'&')operation='address';
  } else if(owner==='System.Array') {
    const p=parameters.map(canonical);
    if(isStatic&&name==='CreateInstance'&&result==='System.Array'&&p[0]==='System.Type'&&
      (indices(p.slice(1),1)||indices(p.slice(1),2)||indices(p.slice(1),3)||p.length===2&&['int[]','long[]'].includes(p[1])||p.length===3&&p[1]==='int[]'&&p[2]==='int[]'))operation='create';
    if(!isStatic) {
      if(['get_Rank','get_Length'].includes(name)&&p.length===0&&result==='int')operation=name.slice(4).toLowerCase();
      if(name==='get_LongLength'&&p.length===0&&result==='long')operation='longLength';
      if(['GetLength','GetLongLength','GetLowerBound','GetUpperBound'].includes(name)&&indices(p,1)&&result===(name==='GetLongLength'?'long':'int'))operation=name;
      const indexParameters=name==='SetValue'?p.slice(1):p;
      const validIndices=[1,2,3].some(count=>indices(indexParameters,count)||indices(indexParameters,count,'long'))||indexParameters.length===1&&['int[]','long[]'].includes(indexParameters[0]);
      if(name==='GetValue'&&result==='object'&&validIndices)operation='getValue';
      if(name==='SetValue'&&result==='void'&&p[0]==='object'&&validIndices)operation='setValue';
    }
  }
  return operation?Object.freeze({implementation:'array',descriptor,operation,rank,elementType,contract:null}):null;
}
