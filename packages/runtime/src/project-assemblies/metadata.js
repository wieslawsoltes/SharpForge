import {CilError, metadataSchemas, codedIndex, decodeCoded, token} from '@sharpforge/cil';

const heapKinds = new Set(['str', 'blob', 'guid']);

/** A read-only execution view maps original module tokens into disjoint, bounded CLI table ranges. */
export class ProjectMetadata {
  constructor(modules, typeName) {
    this.modules = modules;
    this.resolveTypeName = typeName;
    this.ranges = new Map();
    this.offsets = new Map();
    this.userStrings = [];
    this.heaps = Object.fromEntries([...heapKinds].map(kind => [kind, {keys: new Map(), values: [null]}]));
    this.rows = Object.create(null);
    this.counts = Object.create(null);
    this.streams = modules[0].inspector.metadata.streams;
    this.version = modules[0].inspector.metadata.version;
    let totalRows = 0;
    let userStringBytes = 0;
    for (const module of modules) {
      const offsets = new Map(Array.from({length: 64}, (_, table) => [table, this.counts[table] ?? 0]));
      const metadata = module.inspector.metadata;
      for (const [key, rows] of Object.entries(metadata.rows)) {
        const table = Number(key);
        const start = this.counts[table] ?? 0;
        offsets.set(table, start);
        this.counts[table] = start + rows.length;
        totalRows += rows.length;
        if (this.counts[table] > 0xffffff || totalRows > 1_000_000) throw new CilError('Project metadata row limit exceeded');
        if (!rows.length) continue;
        const ranges = this.ranges.get(table) ?? [];
        ranges.push({start: start + 1, end: start + rows.length + 1, module});
        this.ranges.set(table, ranges);
      }
      const length = metadata.streams.get('#US')?.length ?? 0;
      offsets.set(0x70, userStringBytes);
      if (length) this.userStrings.push({start: userStringBytes, end: userStringBytes + length, module});
      userStringBytes += length;
      if (userStringBytes > 0xffffff) throw new CilError('Project user-string token space exceeded');
      this.offsets.set(module, offsets);
    }
    for (const module of modules) {
      for (const [key, sourceRows] of Object.entries(module.inspector.metadata.rows)) {
        const table = Number(key);
        const schema = metadataSchemas[table];
        if (!schema) throw new CilError('Unsupported project metadata table: ' + table);
        const rows = this.rows[table] ??= [];
        for (const row of sourceRows) rows.push(Object.freeze(row.map((value, index) =>
          this.column(module, schema[index], value, table, index))));
      }
    }
    for (const rows of Object.values(this.rows)) Object.freeze(rows);
    Object.freeze(this.rows);
    Object.freeze(this.counts);
  }

  column(module, kind, value, table, index) {
    if (!value) return value;
    if (heapKinds.has(kind)) return this.heapIndex(module, kind, value);
    if (kind.startsWith('t')) return value + (this.offsets.get(module).get(Number(kind.slice(1))) ?? 0);
    if (kind !== 'u16' && kind !== 'u32') return codedIndex(kind, this.mapToken(module, decodeCoded(kind, value)));
    if ((table === 30 || table === 31) && index === 0) return this.mapToken(module, value);
    return value;
  }

  heapIndex(module, kind, local) {
    const heap = this.heaps[kind];
    const key = module.index + ':' + local;
    if (!heap.keys.has(key)) {
      heap.keys.set(key, heap.values.length);
      heap.values.push({module, local});
    }
    return heap.keys.get(key);
  }

  heapValue(kind, index) {
    const location = this.heaps[kind].values[index];
    if (!location) throw new CilError('Invalid project metadata heap index');
    const method = kind === 'str' ? 'string' : kind;
    return location.module.inspector.metadata[method](location.local);
  }

  string(index) { return index ? this.heapValue('str', index) : ''; }
  blob(index) { return index ? this.heapValue('blob', index) : new Uint8Array(); }
  guid(index) { return index ? this.heapValue('guid', index) : new Uint8Array(16); }

  mapToken(module, local) {
    if (!local) return 0;
    const table = local >>> 24;
    const offset = this.offsets.get(module).get(table) ?? 0;
    const row = (local & 0xffffff) + offset;
    if (row > 0xffffff) throw new CilError('Project metadata token space exceeded');
    return token(table, row);
  }

  location(value) {
    const table = value >>> 24;
    const row = value & 0xffffff;
    const ranges = table === 0x70 ? this.userStrings : this.ranges.get(table) ?? [];
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const range = ranges[middle];
      if (row < range.start) high = middle - 1;
      else if (row >= range.end) low = middle + 1;
      else return {module: range.module, local: token(table, row - (this.offsets.get(range.module).get(table) ?? 0))};
    }
    throw new CilError('Invalid project metadata token: 0x' + value.toString(16));
  }

  row(value) {
    const row = this.rows[value >>> 24]?.[(value & 0xffffff) - 1];
    if (!row) throw new CilError('Invalid project metadata row');
    return row;
  }

  list(owner, column) {
    const {module, local} = this.location(owner);
    return module.inspector.metadata.list(local, column).map(value => this.mapToken(module, value));
  }

  typeName(value, depth = 0) {
    const {module, local} = this.location(value);
    return this.resolveTypeName(module, local, depth);
  }

  userString(value) {
    const {module, local} = this.location(value);
    if (value >>> 24 !== 0x70) throw new CilError('Expected a project user-string token');
    return module.inspector.metadata.userString(local);
  }
}
