import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {MetadataBuilder,Writer,CilWriter,methodSignature,codedIndex,token,writePE,TEXT_RVA} from '@sharpforge/cil';

export function castingRegistry() {
  const registry=new MethodTableRegistry();
  for(const definition of [
    {name:'CastFixtures.IRoot',flags:{interface:true}},
    {name:'CastFixtures.IChild',flags:{interface:true},interfaces:['CastFixtures.IRoot']},
    {name:'CastFixtures.Base',interfaces:['CastFixtures.IRoot']},
    {name:'CastFixtures.Derived',base:'CastFixtures.Base',interfaces:['CastFixtures.IChild']},
    {name:'CastFixtures.Other'},
    {name:'CastFixtures.Color',base:'System.Enum',flags:{valueType:true,enum:true},enumUnderlyingType:'int'},
    {name:'CastFixtures.OtherColor',base:'System.Enum',flags:{valueType:true,enum:true},enumUnderlyingType:'int'},
    {name:'CastFixtures.ByteColor',base:'System.Enum',flags:{valueType:true,enum:true},enumUnderlyingType:'byte'},
    {name:'CastFixtures.ICov`1',flags:{interface:true},variance:[1]},
    {name:'CastFixtures.IContra`1',flags:{interface:true},variance:[-1]},
    {name:'CastFixtures.IInvariant`1',flags:{interface:true},variance:[0]},
    {name:'CastFixtures.Box`1',variance:[0]},
    {name:'CastFixtures.Producer',interfaces:['CastFixtures.ICov`1<string>']},
    {name:'CastFixtures.Consumer',interfaces:['CastFixtures.IContra`1<object>']},
    {name:'First.Widget'}, {name:'Second.Widget'},
  ])registry.define(definition);
  return registry;
}

// Direction is deliberately source -> target, while Type.IsAssignableFrom is
// called on the target. Every row is also evaluated by the .NET reference runner.
export const typePairs=[
  ['string','object',true], ['object','string',false], ['int','object',true],
  ['CastFixtures.Derived','CastFixtures.Base',true], ['CastFixtures.Base','CastFixtures.Derived',false],
  ['CastFixtures.Derived','CastFixtures.Derived',true], ['CastFixtures.Derived','CastFixtures.Other',false],
  ['First.Widget','Second.Widget',false], ['First.Widget','object',true],
  ['CastFixtures.Base','CastFixtures.IRoot',true], ['CastFixtures.Derived','CastFixtures.IChild',true],
  ['CastFixtures.Derived','CastFixtures.IRoot',true], ['CastFixtures.Base','CastFixtures.IChild',false],
  ['CastFixtures.IChild','CastFixtures.IRoot',true], ['CastFixtures.IRoot','CastFixtures.IChild',false],
  ['CastFixtures.IRoot','object',true], ['CastFixtures.Other','CastFixtures.IRoot',false],
  ['string','System.IComparable',true], ['int','System.IComparable`1<int>',true], ['int','System.IComparable`1<long>',false],
  ['bool','System.IFormattable',false], ['char','System.IFormattable',true],
  ['string[]','object[]',true], ['object[]','string[]',false], ['int[]','object[]',false],
  ['int[]','System.Array',true], ['int[]','object',true], ['string[,]','object[,]',true],
  ['string[]','object[,]',false], ['int[,]','int[,,]',false], ['int[,]','int[,]',true],
  ['int[]','int[*]',true], ['int[*]','int[]',false], ['int[][]','object[]',true],
  ['int[][]','object[][]',false], ['string[][]','object[][]',true],
  ['int[]','uint[]',true], ['uint[]','int[]',true], ['byte[]','sbyte[]',true],
  ['bool[]','byte[]',false], ['char[]','ushort[]',false], ['float[]','int[]',false],
  ['string[]','System.Collections.Generic.IEnumerable`1<object>',true],
  ['string[]','System.Collections.Generic.IList`1<object>',true],
  ['int[]','System.Collections.Generic.IList`1<uint>',true],
  ['int[]','System.Collections.Generic.IEnumerable`1<object>',false],
  ['string[,]','System.Collections.Generic.IEnumerable`1<string>',false],
  ['string[,]','System.Collections.IEnumerable',true],
  ['CastFixtures.ICov`1<string>','CastFixtures.ICov`1<object>',true],
  ['CastFixtures.ICov`1<object>','CastFixtures.ICov`1<string>',false],
  ['CastFixtures.ICov`1<int>','CastFixtures.ICov`1<object>',false],
  ['CastFixtures.IContra`1<object>','CastFixtures.IContra`1<string>',true],
  ['CastFixtures.IContra`1<string>','CastFixtures.IContra`1<object>',false],
  ['CastFixtures.IInvariant`1<string>','CastFixtures.IInvariant`1<object>',false],
  ['CastFixtures.Producer','CastFixtures.ICov`1<object>',true],
  ['CastFixtures.Consumer','CastFixtures.IContra`1<string>',true],
  ['System.Collections.Generic.List`1<string>','System.Collections.Generic.IEnumerable`1<object>',true],
  ['System.Collections.Generic.List`1<string>','System.Collections.Generic.List`1<object>',false],
  ['System.Collections.Generic.List`1<int>','System.Collections.Generic.IEnumerable`1<object>',false],
  ['System.Collections.Generic.IList`1<string>','System.Collections.Generic.IList`1<object>',false],
  ['System.Action`1<object>','System.Action`1<string>',true],
  ['System.Func`1<string>','System.Func`1<object>',true],
  ['System.Func`1<int>','System.Func`1<object>',false],
  ['System.Func`2<object, string>','System.Func`2<string, object>',true],
  ['System.Collections.Generic.List`1<string>','System.Collections.Generic.List`1',false],
  ['System.Collections.Generic.List`1','System.Collections.Generic.List`1',true],
  ['int','System.Nullable`1<int>',true], ['System.Nullable`1<int>','int',false],
  ['System.Nullable`1<int>','object',true], ['System.Nullable`1<int>','System.ValueType',true],
  ['System.Nullable`1<int>','System.Nullable`1<long>',false], ['System.Nullable`1<int>','System.IComparable',false],
  ['CastFixtures.Color','System.Enum',true], ['CastFixtures.Color','System.ValueType',true],
  ['CastFixtures.Color','object',true], ['CastFixtures.Color','int',false], ['int','CastFixtures.Color',false],
  ['CastFixtures.Color','CastFixtures.OtherColor',false], ['CastFixtures.Color','System.IComparable',true],
  ['CastFixtures.Color','System.Nullable`1<CastFixtures.Color>',true],
  ['CastFixtures.Color','System.Nullable`1<int>',false], ['System.Nullable`1<CastFixtures.Color>','System.Enum',false],
  ['CastFixtures.Color[]','int[]',true], ['int[]','CastFixtures.Color[]',true],
  ['CastFixtures.Color[]','CastFixtures.OtherColor[]',true], ['CastFixtures.ByteColor[]','byte[]',true],
];

const csType=name=>{
  if(name.endsWith('[*]'))return csType(name.slice(0,-3))+'.MakeArrayType(1)';
  if(/`\d+$/.test(name))return 'typeof('+name.replace(/`(\d+)$/,(_,count)=>'<'+','.repeat(Number(count)-1)+'>')+')';
  return 'typeof('+name.replace(/`\d+/g,'')+')';
};
export const nativeCastSource=`using System;
namespace CastFixtures {
 public interface IRoot {} public interface IChild : IRoot {}
 public class Base : IRoot {} public class Derived : Base, IChild {} public class Other {}
 public enum Color : int { A } public enum OtherColor : int { A } public enum ByteColor : byte { A }
 public interface ICov<out T> {} public interface IContra<in T> {} public interface IInvariant<T> {}
 public class Box<T> {} public class Producer : ICov<string> {} public class Consumer : IContra<object> {}
}
namespace First { public class Widget {} } namespace Second { public class Widget {} }
static class Program { static void Main() {
${typePairs.map(([source,target])=>' Console.WriteLine('+csType(target)+'.IsAssignableFrom('+csType(source)+'));').join('\n')}
} }
`;

/** Genuine TypeDef namespaces with distinct same-named virtual declarations. */
export function namespaceAssembly() {
  const md=new MetadataBuilder('NamespacedMethodTables'),object=md.typeRef('System.Object'),resolve=name=>md.typeRef(name);
  md.add(2,[0,md.string('<Module>'),0,0,1,1]);
  md.add(2,[0x100001,md.string('Widget'),md.string('First'),codedIndex('TypeDefOrRef',object),1,1]);
  md.add(2,[0x100001,md.string('Widget'),md.string('Second'),codedIndex('TypeDefOrRef',object),1,3]);
  md.add(2,[0x100001,md.string('Program'),0,codedIndex('TypeDefOrRef',object),1,5]);
  const objectCtor=md.member(object,'.ctor',methodSignature('void',[],false,resolve));
  const definitions=[
    {name:'.ctor',flags:0x1886,result:'void',body:w=>w.op('ldarg.0').op('call',objectCtor).op('ret')},
    {name:'F',flags:0x1c6,result:'int',body:w=>w.op('ldc.i4.1').op('ret')},
    {name:'.ctor',flags:0x1886,result:'void',body:w=>w.op('ldarg.0').op('call',objectCtor).op('ret')},
    {name:'F',flags:0x1c6,result:'int',body:w=>w.op('ldc.i4.2').op('ret')},
    {name:'Main',flags:0x96,result:'int',body:w=>w.op('newobj',token(6,1)).op('callvirt',token(6,2)).op('ldc.i4',10).op('mul').op('newobj',token(6,3)).op('callvirt',token(6,4)).op('add').op('ret')}
  ];
  for(const method of definitions)md.add(6,[0,0,method.flags,md.string(method.name),md.blob(methodSignature(method.result,[],!!(method.flags&0x10),resolve)),1]);
  const section=new Writer().zero(72);
  for(const [index,method] of definitions.entries()) {
    const writer=new CilWriter();method.body(writer);const code=writer.finish();
    section.pad(4);md.rows[6][index][0]=TEXT_RVA+section.length;
    section.u16(0x3013).u16(8).u32(code.length).u32(0).bytes(code);
  }
  section.pad(4);const offset=section.length,metadata=md.finish(undefined,new Uint8Array([7,1,8]));section.bytes(metadata);
  return writePE(section.finish(),offset,metadata.length,token(6,5));
}
