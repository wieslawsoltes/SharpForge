import {asyncTypeTable} from './async-type-tables.js';
import {genericTypeParts} from '@sharpforge/cil';
import {nativeIntegerBits} from '@sharpforge/bytecode';
import {frameworkMethodTable} from './framework-method-table.js';
import {frameworkType, canonicalType} from '@sharpforge/framework';
import {exceptionTypeName, exceptionBaseType} from './exception-types.js';

const aliases = {object:'System.Object',string:'System.String',bool:'System.Boolean',char:'System.Char',sbyte:'System.SByte',byte:'System.Byte',short:'System.Int16',ushort:'System.UInt16',int:'System.Int32',uint:'System.UInt32',long:'System.Int64',ulong:'System.UInt64',float:'System.Single',double:'System.Double',decimal:'System.Decimal',nint:'System.IntPtr',nuint:'System.UIntPtr',void:'System.Void'};
const primitiveSizes = {'System.Boolean':1,'System.Char':2,'System.SByte':1,'System.Byte':1,'System.Int16':2,'System.UInt16':2,'System.Int32':4,'System.UInt32':4,'System.Int64':8,'System.UInt64':8,'System.Single':4,'System.Double':8,'System.Decimal':16,'System.IntPtr':4,'System.UIntPtr':4,'System.Void':0};
const genericPrefix = 'System.Collections.Generic.';
const genericNames = new Set(['IEnumerable','IEnumerator','ICollection','IList','IReadOnlyCollection','IReadOnlyList','IComparer','IEqualityComparer','List','Dictionary','HashSet','Queue','Stack']);
const arrayInterfaces = ['System.Collections.IList','System.Collections.ICollection','System.Collections.IEnumerable','System.ICloneable','System.Collections.IStructuralComparable','System.Collections.IStructuralEquatable'];

export function runtimeTypeName(input, definitions = null) {
  if(typeof input!=='string'||!input.trim())throw new TypeError('A runtime type name is required');
  const name = input.trim();
  if (definitions?.has(name)) return name;
  const array = /^(.*)\[([^\[\]]*)\]$/.exec(name);
  if(array) {
    const shape=array[2],dimensions=shape.split(',');
    if(shape!==''&&shape!=='*'&&!dimensions.every(dimension=>dimension===''||/^-?\d+\.\.\.-?\d*$/.test(dimension)))throw new TypeError('Invalid runtime array shape');
    if(dimensions.length>32)throw new TypeError('Runtime array rank exceeds 32');
    return runtimeTypeName(array[1], definitions)+(shape===''?'[]':dimensions.length===1?'[*]':'['+','.repeat(dimensions.length-1)+']');
  }
  if(name.endsWith('?'))return 'System.Nullable`1<'+runtimeTypeName(name.slice(0,-1), definitions)+'>';
  if(name.endsWith('&')||name.endsWith('*'))return runtimeTypeName(name.slice(0,-1), definitions)+name.at(-1);
  const parts = genericTypeParts(name);
  if (parts.arguments.length) {
    let definition = parts.definition.trim();
    if (!definitions?.has(definition) && !/`\d+$/.test(definition)) {
      const short = definition.replace(/^System\.Collections\.Generic\./, '');
      definition += '`' + (genericNames.has(short) ? short === 'Dictionary' ? 2 : 1 : parts.arguments.length);
    }
    return runtimeTypeName(definition, definitions) + '<' +
      parts.arguments.map(argument => argument ? runtimeTypeName(argument, definitions) : '').join(', ') + '>';
  }
  const stem=name.replace(/`\d+$/,'');
  if(/[<>\[\]]/.test(name))throw new TypeError('Unbalanced runtime type name');
  if(genericNames.has(stem))return genericPrefix+name;
  if(/^(Nullable|Action|Func|IComparable|IEquatable)`\d+$/.test(name))return 'System.'+name;
  return aliases[name]??exceptionTypeName(canonicalType(name));
}

/** Per-runtime type identity. The header points at this object, never at a name. */
export class MethodTable {
  constructor(registry,name,token) {this.registry=registry;this.name=name;this.token=token;}
}

function builtin(name, nativeIntBits = 32) {
  if(name==='System.Object')return {base:null};
  if(name==='System.ValueType')return {base:'System.Object'};
  if(name==='System.Enum')return {base:'System.ValueType',interfaces:['System.IComparable','System.IFormattable','System.IConvertible']};
  if(name==='System.Array')return {base:'System.Object',interfaces:arrayInterfaces};
  if(name==='System.Delegate')return {base:'System.Object',interfaces:['System.ICloneable','System.Runtime.Serialization.ISerializable']};
  if(name==='System.MulticastDelegate')return {base:'System.Delegate'};
  if(name==='System.Reflection.MemberInfo')return {base:'System.Object'};
  if(name==='System.Type')return {base:'System.Reflection.MemberInfo'};
  if(name==='System.Reflection.TypeInfo')return {base:'System.Type'};
  if(name==='System.RuntimeType')return {base:'System.Reflection.TypeInfo',flags:{sealed:true}};
  if(name in primitiveSizes) {
    const interfaces=name==='System.Void'?[]:['System.IComparable',...(name==='System.Boolean'?[]:['System.IFormattable']),'System.IConvertible','System.IComparable`1<'+name+'>','System.IEquatable`1<'+name+'>'];
    return {base:'System.ValueType',flags:{valueType:true,primitive:!['System.Decimal','System.Void'].includes(name),sealed:true},valueSize:name==='System.IntPtr'||name==='System.UIntPtr'?nativeIntBits/8:primitiveSizes[name],interfaces};
  }
  if(name==='System.String')return {base:'System.Object',instanceSize:24,flags:{sealed:true},interfaces:['System.IComparable','System.ICloneable','System.IConvertible','System.IComparable`1<System.String>','System.IEquatable`1<System.String>','System.Collections.IEnumerable',genericPrefix+'IEnumerable`1<System.Char>']};
  const exceptionBase=exceptionBaseType(name);
  if(exceptionBase)return {base:exceptionBase,flags:{exception:true}};
  if(name==='System.Nullable`1')return {base:'System.ValueType',flags:{valueType:true,nullable:true,sealed:true},variance:[0]};
  if(/^System\.(Action|Func)`\d+$/.test(name)) {
    const arity=Number(name.split('`')[1]);return {base:'System.MulticastDelegate',flags:{delegate:true,sealed:true},variance:Array.from({length:arity},(_,i)=>name.startsWith('System.Func')&&i===arity-1?1:-1)};
  }
  if(name===genericPrefix+'List`1')return {base:'System.Object',variance:[0],interfaces:[genericPrefix+'IList`1<!0>',genericPrefix+'IReadOnlyList`1<!0>','System.Collections.IList']};
  if(name===genericPrefix+'IList`1')return {flags:{interface:true},variance:[0],interfaces:[genericPrefix+'ICollection`1<!0>']};
  if(name===genericPrefix+'ICollection`1')return {flags:{interface:true},variance:[0],interfaces:[genericPrefix+'IEnumerable`1<!0>']};
  if(name===genericPrefix+'IReadOnlyList`1')return {flags:{interface:true},variance:[1],interfaces:[genericPrefix+'IReadOnlyCollection`1<!0>']};
  if(name===genericPrefix+'IReadOnlyCollection`1')return {flags:{interface:true},variance:[1],interfaces:[genericPrefix+'IEnumerable`1<!0>']};
  if(name===genericPrefix+'IEnumerable`1')return {flags:{interface:true},variance:[1],interfaces:['System.Collections.IEnumerable']};
  if(name===genericPrefix+'IEnumerator`1')return {flags:{interface:true},variance:[1],interfaces:['System.Collections.IEnumerator','System.IDisposable']};
  if([genericPrefix+'IComparer`1',genericPrefix+'IEqualityComparer`1','System.IComparable`1'].includes(name))return {flags:{interface:true},variance:[-1]};
  if(name==='System.IEquatable`1')return {flags:{interface:true},variance:[0]};
  if(name==='System.Collections.IList')return {flags:{interface:true},interfaces:['System.Collections.ICollection']};
  if(name==='System.Collections.ICollection')return {flags:{interface:true},interfaces:['System.Collections.IEnumerable']};
  if(['System.IComparable','System.IFormattable','System.IConvertible','System.ICloneable','System.IDisposable','System.Collections.IEnumerable','System.Collections.IEnumerator','System.Collections.IStructuralComparable','System.Collections.IStructuralEquatable','System.Runtime.Serialization.ISerializable'].includes(name))return {flags:{interface:true}};
  const async = asyncTypeTable(name, nativeIntBits);
  if (async) return async;
  const framework=frameworkType(name);
  if(framework)return frameworkMethodTable(framework);
  return {base:'System.Object',flags:{external:true,dynamic:true}};
}

const substitute=(name,args)=>name.replace(/!!?\d+/g,match=>match.startsWith('!!')?match:args[Number(match.slice(1))]?.name??match);

export class MethodTableRegistry {
  constructor({tokenResolver=null,nativeIntBits=32}={}) {
    Object.defineProperty(this,'nativeIntBits',{value:nativeIntegerBits({nativeIntBits}),enumerable:true});
    this.tokenResolver=tokenResolver;this.descriptors=new Map();this.descriptorTokens=new Map();this.tables=new Map();this.tokens=new Map();this.nextToken=-1;this.building=new Set();
  }
  define(descriptor) {
    const name=descriptor.name;
    if(typeof name!=='string'||!name)throw new TypeError('A method table definition needs a name');
    if(this.tables.has(name))throw new TypeError('Cannot redefine a materialized method table: '+name);
    if(this.descriptors.has(name))throw new TypeError('Duplicate method table definition: '+name);
    const stored={...descriptor,name,token:descriptor.token??this.nextToken--};
    if(this.descriptorTokens.has(stored.token))throw new TypeError('Duplicate method table token');
    this.descriptors.set(name,stored);
    this.descriptorTokens.set(stored.token,name);return this;
  }
  get(input) {
    if(input instanceof MethodTable) {
      if(input.registry!==this)throw new TypeError('Method table belongs to another runtime');
      return input;
    }
    if(typeof input==='number') {
      if(this.tokens.has(input))return this.tokens.get(input);
      const name=this.descriptorTokens.get(input)??this.tokenResolver?.(input);
      if(!name)throw new TypeError('Unknown runtime type token: '+input);
      const table=this.get(name);this.tokens.set(input,table);return table;
    }
    const name=this.descriptors.has(input)?input:runtimeTypeName(input, this.descriptors);
    if(this.tables.has(name))return this.tables.get(name);
    if(this.building.size>=128)throw new TypeError('Runtime type nesting limit exceeded');
    let descriptor=this.descriptors.get(name),array=/^(.*)(\[(?:,*|\*)\])$/.exec(name);
    if(!descriptor&&array) {
      const rank=array[2]==='[*]'?1:array[2].length-1,szArray=array[2]==='[]';
      descriptor={name,base:'System.Array',elementType:array[1],rank,flags:{array:true,szArray,sealed:true},interfaces:szArray?[genericPrefix+'IList`1<'+array[1]+'>',genericPrefix+'IReadOnlyList`1<'+array[1]+'>']:[]};
    }
    if(!descriptor&&(name.endsWith('&')||name.endsWith('*')))descriptor={name,base:null,elementType:name.slice(0,-1),flags:{byRef:name.endsWith('&'),pointer:name.endsWith('*')}};
    if(!descriptor&&/^!\d+$/.test(name))descriptor={name,base:null,flags:{genericParameter:true}};
    const parts = descriptor ? null : genericTypeParts(name);
    if (parts?.arguments.length) {
      const definition = this.get(parts.definition), typeArguments = parts.arguments;
      if(typeArguments.every(argument=>!argument))return definition;
      if(typeArguments.length!==definition.genericArity||typeArguments.some(argument=>!argument))throw new TypeError('Generic type argument count does not match definition');
      const args=typeArguments.map(argument=>this.get(argument));
      // An argument's interfaces may have materialized this exact instantiation.
      if(this.tables.has(name))return this.tables.get(name);
      // Read the definition descriptor so recursive fields (Node<T>.Next) do
      // not depend on the open table having finished materializing its fields.
      const template=this.descriptors.get(definition.name)??builtin(definition.name,this.nativeIntBits);
      descriptor={name,genericDefinition:definition,typeArguments:args,base:template.base===null?null:substitute(template.base??'System.Object',args),
        interfaces:(template.interfaces??[]).map(type=>substitute(type,args)),flags:{...definition.flags,genericDefinition:false},variance:template.variance??definition.variance,
        fields:(template.fields??[]).map(field=>({...field,type:substitute(field.type,args),...(field.storageType?{storageType:substitute(field.storageType,args)}:{})})),enumUnderlyingType:template.enumUnderlyingType,vtable:template.vtable??definition.vtable,
        valueSize:template.valueSize};
    }
    descriptor??={name,...builtin(name,this.nativeIntBits)};
    const token=descriptor.token??this.nextToken--,table=new MethodTable(this,name,token);
    this.tables.set(name,table);this.tokens.set(token,table);this.building.add(name);
    try {
      const arity=descriptor.genericArity??Number(/`(\d+)$/.exec(name)?.[1]??0);
      table.flags=Object.freeze({interface:false,valueType:false,enum:false,array:false,szArray:false,delegate:false,nullable:false,primitive:false,byRef:false,pointer:false,genericParameter:false,genericDefinition:arity>0,...descriptor.flags});
      table.genericArity=descriptor.genericDefinition?.genericArity??arity;
      table.genericDefinition=descriptor.genericDefinition??null;
      table.definitionToken=table.genericDefinition?.definitionToken??token;
      table.typeArguments=Object.freeze([...(descriptor.typeArguments??[])]);
      table.containsGenericParameters=table.flags.genericDefinition||table.flags.genericParameter||table.typeArguments.some(argument=>argument.containsGenericParameters);
      table.variance=Object.freeze([...(descriptor.variance??Array(arity).fill(0))]);
      table.base=descriptor.base===null||table.flags.interface?null:this.get(descriptor.base??'System.Object');
      if(table.base&&this.building.has(table.base.name))throw new TypeError('Cyclic runtime type hierarchy');
      const ancestors=new Set([table]);
      for(let current=table.base;current;current=current.base){if(ancestors.has(current))throw new TypeError('Cyclic runtime type hierarchy');ancestors.add(current);}
      table.elementType=descriptor.elementType?this.get(descriptor.elementType):null;
      table.containsGenericParameters||=!!table.elementType?.containsGenericParameters;
      table.rank=descriptor.rank??0;
      table.enumUnderlyingType=descriptor.enumUnderlyingType?this.get(descriptor.enumUnderlyingType):null;
      table.nullableType=table.flags.nullable&&table.typeArguments.length?table.typeArguments[0]:null;
      table.interfaces=Object.freeze((descriptor.interfaces??[]).map(type=>this.get(type)));
      if(table.interfaces.some(type=>this.building.has(type.name)))throw new TypeError('Cyclic runtime interface hierarchy');
      table.vtable=new Map(descriptor.vtable??table.base?.vtable??[]);
      table.interfaceMap=new Map(table.base?.interfaceMap??[]);
      for(const type of table.interfaces){table.interfaceMap.set(type,type.vtable??new Map());for(const [parent,slots] of type.interfaceMap??[])table.interfaceMap.set(parent,slots);}
      for(const [type,slots] of table.interfaceMap)table.interfaceMap.set(type,new Map([...slots].map(([declaration,body])=>[declaration,table.vtable.get(declaration)??body])));
      table.declaredFields=Object.freeze((descriptor.fields??[]).map(field=>Object.freeze({...field,type:this.get(field.type)})));
      table.fields=Object.freeze([...(table.base?.fields??[]),...table.declaredFields]);
      const referenceSlot=type=>!type.flags.valueType||type.gcBitmap?.some(Boolean)||false;
      table.gcBitmap=Object.freeze(table.flags.array?[referenceSlot(table.elementType)]:table.fields.map(field=>referenceSlot(field.type)));
      table.instanceSize=descriptor.instanceSize??32+table.fields.length*8;
      table.valueSize=descriptor.valueSize??(table.enumUnderlyingType?.valueSize??table.fields.length*8);
      return Object.freeze(table);
    } catch(error) {this.tables.delete(name);this.tokens.delete(token);throw error;}
    finally {this.building.delete(name);}
  }
}

/** Source and CIL heaps use the same headers; source fields retain their IR slots. */
export function createSourceMethodTables(image,options={}) {
  const registry=new MethodTableRegistry(options);
  for(const [index,type] of (image.types??[]).entries())registry.define({name:type.name,token:type.token??0x02000001+(type.id??index),base:type.base??'System.Object',interfaces:type.interfaces??[],fields:type.fields??[],flags:{enum:!!type.enum,valueType:!!type.enum},enumUnderlyingType:type.enum?type.underlyingType??'int':null,
    vtable:(image.methods??[]).filter(method=>method.owner===type.name&&!method.isStatic).map(method=>[method.id,method.id])});
  for(const type of image.types??[])registry.get(type.name);
  return registry;
}
