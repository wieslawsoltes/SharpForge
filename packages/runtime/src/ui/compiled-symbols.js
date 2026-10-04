import {frameworkType} from '@sharpforge/framework';
import {CompiledBindingCompileError} from '@sharpforge/winui-properties';
import {castCacheFor} from '../execution/casting.js';
import {managedBindingTypeName as canonicalType} from './member-access.js';

/** An assembly-scoped symbol index used only while compiling XAML descriptors. */
export class ManagedCompiledSymbols {
  constructor(context, members, xamlContext) {
    this.context = context;
    this.members = members;
    this.xamlContext = xamlContext;
    this.metadata = members.metadata;
    if (!this.metadata) throw new CompiledBindingCompileError('SFXB003', 'x:Bind requires authoritative assembly metadata');
    this.references = new Map();
    this.types = new Map();
    this.fields = new Map();
    const metadata = this.metadata.metadata;
    for (const table of [1, 2, 27]) {
      for (let row = 1; row <= (metadata.rows[table]?.length ?? 0); row++) {
        const token = table * 0x1000000 + row;
        const name = canonicalType(metadata.typeName(token));
        this.types.set(name, {name, token});
      }
    }
    const count = metadata.rows[10]?.length ?? 0;
    if (count > members.maxMembers) throw new CompiledBindingCompileError('SFXB003', 'Compiled reference index budget exceeded');
    for (let row = 1; row <= count; row++) {
      const member = this.metadata.resolveToken(0x0a000000 + row);
      if (member.kind !== 'method') continue;
      const key = canonicalType(member.owner) + '::' + member.name;
      const values = this.references.get(key) ?? [];
      values.push({...member, parameters: member.signature.parameters.map(canonicalType),
        returnType: canonicalType(member.signature.returnType), isStatic: member.signature.isStatic});
      this.references.set(key, values);
    }
    for (const type of this.metadata.types) for (const field of type.fields) {
      if (this.fields.size >= members.maxMembers) throw new CompiledBindingCompileError('SFXB003', 'Compiled field index budget exceeded');
      this.fields.set(canonicalType(type.name) + '::' + field.name, field);
    }
  }

  get reconstructible() { return true; }
  scope(xamlContext) {
    const scoped = Object.create(this);
    scoped.xamlContext = xamlContext;
    return scoped;
  }

  *owners(type) {
    let table = this.context.platform.heap.methodTables.get(type);
    if (!table) { yield canonicalType(type); return; }
    const seen = new Set();
    while (table) {
      if (seen.has(table) || seen.size >= this.members.maxDepth) throw new CompiledBindingCompileError('SFXB003', 'Compiled owner depth exceeded');
      seen.add(table);
      yield canonicalType(table.name);
      table = table.base;
    }
  }

  type(name) {
    const direct = this.types.get(canonicalType(name));
    if (direct) return direct;
    let resolved = this.context.services.resolveBindingType?.(name, this.xamlContext);
    if (!resolved && this.xamlContext?.resolveType) {
      try { resolved = this.xamlContext.resolveType(name); } catch { return null; }
    }
    return resolved ? this.types.get(canonicalType(resolved.name ?? resolved)) ?? null : null;
  }

  member(type, name, {staticOnly = false, arguments: argumentTypes = []} = {}) {
    for (const owner of this.owners(type)) {
      const declared = this.members.types.get(owner);
      const property = declared?.properties.get(name);
      if (property && (!staticOnly || property.get?.isStatic || property.set?.isStatic)) {
        const token = property.token ?? property.get?.token ?? property.set?.token;
        const accessor = property.get ?? property.set;
        const parameters = property.get ? accessor.parameters : accessor.parameters.slice(0, -1);
        const valid = parameters.length === argumentTypes.length
          && parameters.every((parameter, index) => this.assignabilityScore(parameter, argumentTypes[index]) >= 0);
        if (token && valid) return {token, type: canonicalType(property.type), readable: !!property.get, writable: !!property.set};
      }
      const field = declared?.fields.get(name);
      if (field && !argumentTypes.length && (!staticOnly || field.isStatic)) {
        const metadata = this.fields.get(owner + '::' + name);
        if (metadata) return {token: metadata.token, type: canonicalType(field.type), readable: true, writable: !(metadata.flags & 96)};
      }
      const get = this.select(this.candidates(owner, 'get_' + name), argumentTypes, staticOnly);
      const set = this.candidates(owner, 'set_' + name).find(candidate => (!staticOnly || candidate.isStatic)
        && candidate.parameters.length === argumentTypes.length + 1
        && candidate.parameters.slice(0, -1).every((parameter, index) => this.assignabilityScore(parameter, argumentTypes[index]) >= 0)
        && (!get || canonicalType(candidate.parameters.at(-1)) === canonicalType(get.returnType)));
      if (get || set) return {token: get?.token ?? set.token, type: get?.returnType ?? set.parameters.at(-1), readable: !!get, writable: !!set};
    }
    return null;
  }

  candidates(owner, name) {
    const values = [...(this.references.get(owner + '::' + name) ?? [])];
    for (const [key, methods] of this.members.types.get(owner)?.methods ?? []) {
      if (key.startsWith(name + ':')) values.push(...methods.filter(method => method.token));
    }
    return [...new Map(values.map(method => [method.resolvedToken ?? method.token, method])).values()];
  }

  method(type, name, argumentTypes, {staticOnly = false} = {}) {
    for (const owner of this.owners(type)) {
      const method = this.select(this.candidates(owner, name), argumentTypes, staticOnly);
      if (method) return method;
    }
    return null;
  }

  select(candidates, argumentTypes, staticOnly) {
    const matches = [];
    for (const candidate of candidates) {
      if (staticOnly && !candidate.isStatic || candidate.parameters.length !== argumentTypes.length) continue;
      const scores = candidate.parameters.map((type, index) => this.assignabilityScore(type, argumentTypes[index]));
      if (scores.some(score => score < 0)) continue;
      matches.push({candidate, score: scores.reduce((total, score) => total + score, 0)});
    }
    matches.sort((left, right) => left.score - right.score);
    if (matches.length > 1 && matches[0].score === matches[1].score) {
      throw new CompiledBindingCompileError('SFXB005', 'Compiled method overload is ambiguous');
    }
    return matches[0]?.candidate ?? null;
  }

  assignabilityScore(target, source) {
    target = canonicalType(target);
    source = canonicalType(source);
    if (target === source) return 0;
    if (target === 'object' && source !== 'void') return 10;
    if (source === 'null') {
      const kind = frameworkType(target)?.kind;
      return ['value', 'enum'].includes(kind) || ['int', 'bool', 'double', 'float', 'long', 'uint', 'ulong', 'char'].includes(target) ? -1 : 1;
    }
    if (['int:long', 'int:double', 'int:float', 'float:double', 'uint:long', 'uint:double'].includes(source + ':' + target)) return 1;
    const tables = this.context.platform.heap.methodTables;
    return castCacheFor(tables).isAssignableFrom(tables.get(target), tables.get(source)) ? 2 : -1;
  }

  target(type, name, kind = 'property') {
    if (kind !== 'event') {
      const property = this.member(type, name);
      if (!property?.token || !property.writable) throw new CompiledBindingCompileError('SFXB006', 'Compiled target is not a writable metadata member');
      return property;
    }
    for (const owner of this.owners(type)) {
      const event = this.members.types.get(owner)?.events.get(name);
      if (event?.token) return {token: event.token, type: event.type};
      const add = this.candidates(owner, 'add_' + name).find(candidate => candidate.parameters.length === 1);
      if (add) return {token: add.token, type: add.parameters[0]};
    }
    throw new CompiledBindingCompileError('SFXB006', 'Compiled target event has no metadata token');
  }
}
