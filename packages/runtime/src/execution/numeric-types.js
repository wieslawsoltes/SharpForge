/** Scalar bytecode contract. Existing Int32=0/Double=1 conversion IDs stay fixed. */
export const numericTypeNames=Object.freeze(['int','double','sbyte','byte','short','ushort','uint','long','ulong','nint','nuint','float','decimal','char']);
export const NumericType=Object.freeze(Object.fromEntries(numericTypeNames.map((name,id)=>[name,id])));
export const numericAliases=Object.freeze({'System.SByte':'sbyte','System.Byte':'byte','System.Int16':'short','System.UInt16':'ushort','System.Char':'char','System.Boolean':'bool','System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.Single':'float','System.Double':'double','System.Decimal':'decimal','System.IntPtr':'nint','System.UIntPtr':'nuint'});
export const numericTypeName=type=>typeof type==='number'?numericTypeNames[type]:numericAliases[type]??type;
export const numericTypeId=type=>NumericType[numericTypeName(type)];
export function numericMode(type,checked=false) {
  const id=numericTypeId(type);if(id===undefined||typeof checked!=='boolean')throw new TypeError('Invalid scalar mode');
  return 16+id*2+Number(checked);
}
export function decodeNumericMode(mode) {
  if(!Number.isInteger(mode)||mode<16||mode>=16+numericTypeNames.length*2)throw new TypeError('Invalid scalar mode');
  return {type:numericTypeNames[(mode-16)>>1],checked:!!(mode&1)};
}
/** The portable VM ABI is explicitly 32-bit; 64-bit execution is an option. */
export function nativeIntegerBits(context={}) {
  const bits=context.nativeIntBits??32;
  if(bits!==32&&bits!==64)throw new TypeError('nativeIntBits must be 32 or 64');
  return bits;
}
export function integerType(type,context) {
  type=numericTypeName(type);
  const bits={sbyte:8,byte:8,short:16,ushort:16,char:16,bool:8,int:32,uint:32,long:64,ulong:64,nint:nativeIntegerBits(context),nuint:nativeIntegerBits(context)}[type];
  return bits===undefined?null:{type,bits,unsigned:['byte','ushort','char','bool','uint','ulong','nuint'].includes(type),native:type==='nint'||type==='nuint'};
}
