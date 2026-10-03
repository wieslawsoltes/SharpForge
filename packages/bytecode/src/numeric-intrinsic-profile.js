/** Closed scalar numeric API descriptors; no runtime dependency. */
const definitions=[];
const define=(owner,name,parameters,returnType,isStatic=true,implementation='decimal',extra={})=>definitions.push(Object.freeze({owner,name,parameters:Object.freeze(parameters),returnType,isStatic,implementation,...extra}));
const D='System.Decimal';
for(const type of ['int','uint','long','ulong','float','double'])define(D,'.ctor',[type],'void',false);
define(D,'.ctor',['int[]'],'void',false);define(D,'.ctor',['int','int','int','bool','byte'],'void',false);
for(const name of ['Add','Subtract','Multiply','Divide','Remainder','op_Addition','op_Subtraction','op_Multiply','op_Division','op_Modulus'])define(D,name,[D,D],D);
for(const name of ['op_Equality','op_Inequality','op_LessThan','op_LessThanOrEqual','op_GreaterThan','op_GreaterThanOrEqual','Equals'])define(D,name,[D,D],'bool');
define(D,'Compare',[D,D],'int');
for(const name of ['Negate','Abs','Ceiling','Floor','Truncate','op_UnaryNegation','op_UnaryPlus','op_Increment','op_Decrement'])define(D,name,[D],D);
for(const parameters of [[D],[D,'int'],[D,'System.MidpointRounding'],[D,'int','System.MidpointRounding']])define(D,'Round',parameters,D);
define(D,'GetBits',[D],'int[]');define(D,'Parse',['string'],D);define(D,'TryParse',['string',D+'&'],'bool');
for(const parameters of [[],['string']])define(D,'ToString',parameters,'string',false);
for(const parameter of [D,'object']){define(D,'Equals',[parameter],'bool',false);define(D,'CompareTo',[parameter],'int',false);}
define(D,'GetHashCode',[],'int',false);
const integers=['sbyte','byte','short','ushort','char','int','uint','long','ulong'];
for(const type of integers)define(D,'op_Implicit',[type],D);
for(const type of ['float','double'])define(D,'op_Explicit',[type],D);
for(const type of [...integers,'float','double'])define(D,'op_Explicit',[D],type);
for(const [name,type] of Object.entries({ToSByte:'sbyte',ToByte:'byte',ToInt16:'short',ToUInt16:'ushort',ToInt32:'int',ToUInt32:'uint',ToInt64:'long',ToUInt64:'ulong',ToSingle:'float',ToDouble:'double'}))define(D,name,[D],type);
for(const name of ['Abs','Ceiling','Floor','Truncate'])define('System.Math',name,[D],D);
for(const name of ['Min','Max'])define('System.Math',name,[D,D],D);
define('System.Math','Sign',[D],'int');
for(const parameters of [[D],[D,'int'],[D,'System.MidpointRounding'],[D,'int','System.MidpointRounding']])define('System.Math','Round',parameters,D);
for(const [name,parameter,result] of [['SingleToInt32Bits','float','int'],['DoubleToInt64Bits','double','long'],['Int32BitsToSingle','int','float'],['Int64BitsToDouble','long','double']])define('System.BitConverter',name,[parameter],result);
for(const type of ['sbyte','short','int','long','float','double'])define('System.Math','Abs',[type],type,true,'math');
for(const type of ['sbyte','byte','short','ushort','int','uint','long','ulong','float','double'])for(const name of ['Min','Max'])define('System.Math',name,[type,type],type,true,'math');
for(const name of ['Ceiling','Floor','Truncate','Sqrt','Sin','Cos','Tan','Asin','Acos','Atan','Exp','Log10'])define('System.Math',name,['double'],'double',true,'math');
for(const name of ['Pow','Atan2','Log'])define('System.Math',name,['double','double'],'double',true,'math');
define('System.Math','Log',['double'],'double',true,'math');
for(const type of ['sbyte','short','int','long','float','double'])define('System.Math','Sign',[type],'int',true,'math');
for(const parameters of [['double'],['double','int'],['double','System.MidpointRounding'],['double','int','System.MidpointRounding']])define('System.Math','Round',parameters,'double',true,'math');
for(const name of ['Write','WriteLine']) {
  for(const type of ['bool','char','int','uint','long','ulong','float','double','System.Decimal','string','object'])define('System.Console',name,[type],'void',true,'console');
  for(const type of ['nint','nuint'])define('System.Console',name,['object'],'void',true,'console',{formatType:type});
}
for(const type of ['bool','char','sbyte','byte','short','ushort','int','uint','long','ulong','float','double','System.Decimal','string','object'])define('System.Convert','ToString',[type],'string',true,'convertString');
for(const type of ['nint','nuint'])define('System.Convert','ToString',['object'],'string',true,'convertString',{formatType:type});
define('System.Object','.ctor',[],'void',false,'object');
export const numericIntrinsicDefinitions=Object.freeze(definitions);
