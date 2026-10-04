import { rowWriterGroup } from './row-writer.js';
import { constantValueWriter } from './constant-rows.js';

export const TypeAttributes = Object.freeze({
  NotPublic: 0, Public: 1, NestedPublic: 2, NestedPrivate: 3, NestedFamily: 4, NestedAssembly: 5,
  NestedFamANDAssem: 6, NestedFamORAssem: 7, VisibilityMask: 7, AutoLayout: 0, SequentialLayout: 8,
  ExplicitLayout: 16, LayoutMask: 24, Class: 0, Interface: 32, Abstract: 128, Sealed: 256,
  SpecialName: 1024, RTSpecialName: 2048, Import: 4096, Serializable: 8192, WindowsRuntime: 16384,
  AnsiClass: 0, UnicodeClass: 65536, AutoClass: 131072, CustomFormatClass: 196608,
  StringFormatMask: 196608, HasSecurity: 262144, BeforeFieldInit: 1048576, Forwarder: 2097152,
});
export const FieldAttributes = Object.freeze({
  PrivateScope: 0, Private: 1, FamANDAssem: 2, Assembly: 3, Family: 4, FamORAssem: 5, Public: 6,
  FieldAccessMask: 7, Static: 16, InitOnly: 32, Literal: 64, NotSerialized: 128, HasFieldRVA: 256,
  SpecialName: 512, RTSpecialName: 1024, HasFieldMarshal: 4096, PinvokeImpl: 8192, HasDefault: 32768,
});
export const MethodAttributes = Object.freeze({
  PrivateScope: 0, Private: 1, FamANDAssem: 2, Assembly: 3, Family: 4, FamORAssem: 5, Public: 6,
  MemberAccessMask: 7, UnmanagedExport: 8, Static: 16, Final: 32, Virtual: 64, HideBySig: 128,
  ReuseSlot: 0, NewSlot: 256, Strict: 512, Abstract: 1024, SpecialName: 2048, RTSpecialName: 4096,
  PinvokeImpl: 8192, HasSecurity: 16384, RequireSecObject: 32768,
});
export const MethodImplAttributes = Object.freeze({
  IL: 0, Native: 1, OPTIL: 2, Runtime: 3, CodeTypeMask: 3, Managed: 0, Unmanaged: 4,
  NoInlining: 8, ForwardRef: 16, Synchronized: 32, NoOptimization: 64, PreserveSig: 128,
  AggressiveInlining: 256, AggressiveOptimization: 512, InternalCall: 4096,
});

/** Definition and layout row writers; all members take one named-column object. */
export function definitionRowWriters(builder) {
  return rowWriterGroup(builder, {
    typeDef: 'TypeDef', field: 'Field', method: 'MethodDef', parameter: 'Param',
    nestedClass: 'NestedClass', classLayout: 'ClassLayout', fieldLayout: 'FieldLayout',
    fieldRVA: 'FieldRVA', constant: 'Constant', methodImpl: 'MethodImpl', constantValue: constantValueWriter,
  });
}
