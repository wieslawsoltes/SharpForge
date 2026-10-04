import {TableId, FieldAttributes, TypeAttributes, decodeSignature, cliSystemName, resolveExecutionField} from '@sharpforge/cil';
import {ManagedFault} from './fault.js';
import {primitiveStorage} from './primitive-storage.js';

function badField(message) {
  return new ManagedFault('ArgumentException', message);
}

function uniqueRows(rows, key) {
  const index = new Map();
  for (const row of rows ?? []) index.set(row[key], index.has(row[key]) ? null : row);
  return index;
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

/** Derived PE indexes; bounded value layouts reject managed references and external structs. */
export class StaticDataMetadata {
  constructor(inspector, pointerSize) {
    this.inspector = inspector;
    this.pointerSize = pointerSize;
    this.metadata = inspector.metadata;
    this.types = new Map(inspector.types.map(type => [type.name, type]));
    this.rvas = uniqueRows(this.metadata.rows[TableId.FieldRVA], 1);
    this.classLayouts = uniqueRows(this.metadata.rows[TableId.ClassLayout], 2);
    this.fieldLayouts = uniqueRows(this.metadata.rows[TableId.FieldLayout], 1);
    this.fields = new Map();
    this.layouts = new Map();
    const module = this.metadata.rows[TableId.Module]?.[0];
    this.moduleId = [...this.metadata.guid(module?.[2] ?? 0)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  field(vm, handle) {
    if (!handle || !Object.isFrozen(handle) || handle.runtimeHandle !== 'field' || handle.owner !== vm.snapshotOwner
      || handle.table?.registry !== vm.heap.methodTables) throw badField('A runtime field handle from this VM is required');
    let field;
    try {
      field = resolveExecutionField(this.inspector, handle.definitionToken ?? handle.token);
      if (vm.heap.methodTables.get(field.owner) !== handle.table) throw badField('Runtime field owner does not match its declaration');
    } catch (error) {
      if (error instanceof ManagedFault) throw error;
      throw badField('The runtime field handle has no valid internal declaration');
    }
    const definition = field.resolvedToken;
    if (!field.isStatic || !(field.flags & FieldAttributes.HasFieldRVA)) throw badField('The field has no static RVA data');
    if (this.fields.has(definition)) return this.fields.get(definition);
    const row = this.rvas.get(definition & 0xffffff);
    if (!row || row[0] === 0) throw badField('The field needs one valid FieldRVA row');
    const declared = decodeSignature(this.metadata.blob(this.metadata.row(definition)[2])).type;
    const layout = this.layout(declared, new Set(), {visited: 0});
    if (!Number.isSafeInteger(layout.size) || layout.size < 1 || layout.size > 0xffffffff) throw badField('Invalid RVA field byte size');
    let offset;
    try {
      offset = this.inspector.pe.offsetOf(row[0], layout.size);
    } catch {
      throw badField('The RVA field data extends outside its PE section');
    }
    const result = Object.freeze({token: definition, byteLength: layout.size, offset, key: `${this.moduleId}:${definition}`});
    this.fields.set(definition, result);
    return result;
  }

  layout(node, active, budget) {
    if (++budget.visited > 100_000 || active.size >= 64) throw badField('Static field layout complexity limit exceeded');
    if (node.kind === 'modreq' || node.kind === 'modopt') return this.layout(node.element, active, budget);
    if (node.kind === 'pointer') return {size: this.pointerSize, alignment: this.pointerSize};
    const name = node.kind === 'primitive' ? cliSystemName(node.name)
      : node.kind === 'valuetype' ? this.metadata.typeName(node.token) : null;
    const primitive = name && primitiveStorage(name, this.pointerSize);
    if (primitive) return {size: primitive.size, alignment: primitive.size};
    if (node.kind !== 'valuetype') throw badField('Static RVA data cannot contain managed references');
    const type = this.types.get(name);
    if (!type) throw new ManagedFault('NotSupportedException', 'External RVA value-type layout is unavailable');
    if (this.layouts.has(type.token)) return this.layouts.get(type.token);
    if (active.has(type.token)) throw badField('Cyclic static field value layout');
    const base = type.baseToken ? this.metadata.typeName(type.baseToken) : null;
    if (base !== 'System.ValueType' && base !== 'System.Enum') throw badField('RVA layout requires a value type');
    active.add(type.token);
    try {
      const result = this.valueLayout(type, active, budget, base === 'System.Enum');
      this.layouts.set(type.token, result);
      return result;
    } finally {
      active.delete(type.token);
    }
  }

  valueLayout(type, active, budget, isEnum) {
    const rid = type.token & 0xffffff;
    const declared = this.classLayouts.get(rid);
    if (this.classLayouts.has(rid) && !declared) throw badField('Duplicate ClassLayout rows');
    const fields = type.fields.filter(field => !field.isStatic);
    const kind = type.flags & TypeAttributes.LayoutMask;
    if (!isEnum && fields.length && kind === TypeAttributes.AutoLayout) {
      throw new ManagedFault('NotSupportedException', 'RVA data with automatic value-type layout is unsupported');
    }
    const packing = declared?.[0] || 8;
    if (![1, 2, 4, 8, 16, 32, 64, 128].includes(packing)) throw badField('Invalid static data packing size');
    let size = 0;
    let alignment = 1;
    for (const field of fields) {
      const node = decodeSignature(this.metadata.blob(this.metadata.row(field.token)[2])).type;
      const layout = this.layout(node, active, budget);
      const fieldAlignment = Math.min(packing, layout.alignment);
      alignment = Math.max(alignment, fieldAlignment);
      let offset = align(size, fieldAlignment);
      if (kind === TypeAttributes.ExplicitLayout) {
        const row = this.fieldLayouts.get(field.token & 0xffffff);
        if (!row) throw badField('Explicit RVA layout needs one offset for each field');
        offset = row[0];
      }
      size = Math.max(size, offset + layout.size);
      if (size > 0xffffffff) throw badField('Static field layout exceeds its addressable size');
    }
    size = Math.max(1, align(size, alignment), declared?.[1] ?? 0);
    return Object.freeze({size, alignment});
  }
}
