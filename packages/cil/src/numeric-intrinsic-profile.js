/** Closed scalar numeric API descriptors; no runtime dependency. */
const definitions=[];
const define=(owner,name,parameters,returnType,isStatic=true)=>definitions.push(Object.freeze({owner,name,parameters:Object.freeze(parameters),returnType,isStatic,implementation:'decimal'}));
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
export const numericIntrinsicDefinitions=Object.freeze(definitions);
