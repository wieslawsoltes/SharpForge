import { token } from '@sharpforge/cil';
import { fullNameOf } from './serialized-type-names.js';
import { valueOf } from './attribute-values.js';
import { marshalDescriptor } from './marshal-encoding.js';

const TABLE = Object.freeze({ TypeDef: 2, Field: 4, MethodDef: 6, Param: 8, Event: 20, Property: 23, ModuleRef: 26 });
const INTEROP = 'System.Runtime.InteropServices.';
const COMPILER = 'System.Runtime.CompilerServices.';
const attributes = new Set([
  'System.SerializableAttribute', 'System.NonSerializedAttribute',
  ...['StructLayout', 'FieldOffset', 'DllImport', 'MarshalAs', 'In', 'Out', 'Optional', 'ComImport', 'PreserveSig']
    .map(name => INTEROP + name + 'Attribute'),
  COMPILER + 'MethodImplAttribute', COMPILER + 'SpecialNameAttribute',
]);

/** Pseudo-custom attributes are CLI flags and layout/interop rows, so no CustomAttribute row is emitted. */
export class PseudoAttributeWriter {
  constructor(writer) {
    this.writer = writer;
    this.builder = writer.builder;
    this.types = writer.types;
    this.modules = new Map();
  }
  apply(parent, attribute) {
    const fullName = fullNameOf(attribute.attributeClass);
    if (!attributes.has(fullName)) return false;
    const row = this.builder.rows[parent >>> 24]?.[(parent & 0xffffff) - 1];
    if (!row) return true;
    const named = Object.fromEntries(attribute.named.map(({ name, member, value }) => [name, valueOf(value, member.type, this.types)]));
    const fixed = attribute.arguments.map(value => valueOf(value, value.type, this.types));
    switch (fullName) {
      case 'System.SerializableAttribute': row[0] |= 0x2000; break;
      case 'System.NonSerializedAttribute': row[0] |= 0x80; break;
      case INTEROP + 'ComImportAttribute': row[0] |= 0x1000; break;
      case INTEROP + 'InAttribute': row[0] |= 1; break;
      case INTEROP + 'OutAttribute': row[0] |= 2; break;
      case INTEROP + 'OptionalAttribute': row[0] |= 0x10; break;
      case INTEROP + 'PreserveSigAttribute': row[1] |= 0x80; break;
      case INTEROP + 'StructLayoutAttribute': this.layout(parent, row, Number(fixed[0]), named); break;
      case INTEROP + 'FieldOffsetAttribute':
        this.builder.addRow('FieldLayout', { Offset: Number(fixed[0]), Field: parent });
        break;
      case INTEROP + 'DllImportAttribute': this.import(parent, row, fixed[0], named); break;
      case INTEROP + 'MarshalAsAttribute':
        row[0] |= parent >>> 24 === TABLE.Field ? 0x1000 : 0x2000;
        this.builder.addRow('FieldMarshal', { Parent: parent, NativeType: marshalDescriptor(fixed[0], named) });
        break;
      case COMPILER + 'MethodImplAttribute':
        row[1] |= Number(fixed[0] ?? 0) & 0xffff;
        if (Object.hasOwn(named, 'MethodCodeType')) row[1] = (row[1] & ~3) | Number(named.MethodCodeType);
        break;
      case COMPILER + 'SpecialNameAttribute': this.specialName(parent, row); break;
    }
    return true;
  }
  layout(parent, row, kind, named) {
    const layout = kind === 2 ? 0x10 : kind === 0 ? 8 : 0;
    const charSet = Number(named.CharSet ?? 2), stringFormat = charSet === 3 ? 0x10000 : charSet === 4 ? 0x20000 : 0;
    row[0] = (row[0] & ~0x30018) | layout | stringFormat;
    const existing = this.builder.rows[15]?.find(entry => entry[2] === (parent & 0xffffff));
    const packing = Number(named.Pack ?? 0), size = Number(named.Size ?? existing?.[1] ?? 0);
    if (existing) {
      existing[0] = packing;
      existing[1] = size || existing[1];
    } else if (packing || size) this.builder.addRow('ClassLayout', { PackingSize: packing, ClassSize: size, Parent: parent });
  }
  module(name) {
    if (!this.modules.has(name)) {
      const handle = this.builder.string(name), index = this.builder.rows[TABLE.ModuleRef]?.findIndex(row => row[0] === handle) ?? -1;
      this.modules.set(name, index >= 0 ? token(TABLE.ModuleRef, index + 1) : this.builder.addRow('ModuleRef', { Name: name }));
    }
    return this.modules.get(name);
  }
  import(parent, row, library, named) {
    row[2] |= 0x2000; // MethodAttributes.PinvokeImpl
    if (named.PreserveSig === false) row[1] &= ~0x80;
    else row[1] |= 0x80;
    const convention = Number(named.CallingConvention ?? 1), charSet = Number(named.CharSet ?? 1);
    let flags = convention << 8;
    if (charSet >= 2 && charSet <= 4) flags |= (charSet - 1) << 1;
    if (named.ExactSpelling === true) flags |= 1;
    if (named.SetLastError === true) flags |= 0x40;
    if (Object.hasOwn(named, 'BestFitMapping')) flags |= named.BestFitMapping ? 0x10 : 0x20;
    if (Object.hasOwn(named, 'ThrowOnUnmappableChar')) flags |= named.ThrowOnUnmappableChar ? 0x1000 : 0x2000;
    this.builder.addRow('ImplMap', {
      MappingFlags: flags, MemberForwarded: parent,
      ImportName: named.EntryPoint ?? this.methodName(parent), ImportScope: this.module(library),
    });
  }
  methodName(parent) {
    for (const type of this.writer.writer.types) {
      const method = this.writer.writer.plans.get(type).methods.find(method => method.token === parent);
      if (method) return method.name;
    }
    return '';
  }
  specialName(parent, row) {
    switch (parent >>> 24) {
      case TABLE.TypeDef: row[0] |= 0x400; break;
      case TABLE.MethodDef: row[2] |= 0x800; break;
      case TABLE.Field: case TABLE.Event: case TABLE.Property: row[0] |= 0x200; break;
    }
  }
}
