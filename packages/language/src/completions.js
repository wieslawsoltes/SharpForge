import { types as frameworkTypes, frameworkType, propertiesFor, eventsFor, contracts } from '@sharpforge/framework';
import { keywords } from '@sharpforge/syntax';
import { Builtins } from '@sharpforge/bytecode';
import { intrinsicDocs, symbolDetail } from './symbol-details.js';

function registryMembers(type, local) {
  const items = [];
  const external = frameworkType(type);
  if (external) {
    for (const [label, property] of Object.entries(propertiesFor(external.name))) {
      if (Boolean(property.isStatic) !== !local) continue;
      const accessors = property.readOnly ? ' { get; }' : ' { get; set; }';
      items.push({ label, kind: 'property', detail: `${property.type} ${label}${accessors}`, insertText: label });
    }
    if (local) {
      for (const [label, delegate] of Object.entries(eventsFor(external.name))) {
        items.push({ label, kind: 'event', detail: `event ${delegate} ${label}`, insertText: label });
      }
    }
    const seen = new Set();
    for (let owner = external; owner && !seen.has(owner.name); owner = frameworkType(owner.base)) {
      seen.add(owner.name);
      for (const contract of contracts) {
        if (contract.owner !== owner.name || contract.kind !== 'method' || contract.isStatic !== !local) continue;
        items.push({ label: contract.name, kind: 'method',
          detail: `${contract.result} ${contract.name}(${contract.parameters.join(', ')})`, insertText: contract.name });
      }
    }
  }
  for (const builtin of Builtins.filter(builtin => builtin.name.startsWith(type + '.'))) {
    const name = builtin.name.slice(type.length + 1);
    items.push({ label: name, kind: 'method', detail: `${builtin.result} ${builtin.name}(…)`, insertText: name });
  }
  if (type === 'string' || type.endsWith('[]')) items.push({ label: 'Length', kind: 'property', detail: 'int Length', insertText: 'Length' });
  if (local) items.push({ label: 'ToString', kind: 'method', detail: 'string ToString()', insertText: 'ToString' });
  return items;
}

function sourceMembers(result, uri, offset, member) {
  const receiver = member[1].replace(/^System\./, '');
  const local = result.symbols.filter(symbol => symbol.uri === uri && symbol.name === receiver && symbol.start <= offset
    && (symbol.scopeEnd ?? Infinity) >= offset).at(-1);
  const type = local?.type ?? receiver;
  const members = result.symbols.filter(symbol => symbol.owner === type && ['method', 'field', 'property'].includes(symbol.kind)
    && (!local ? symbol.isStatic : !symbol.isStatic));
  return [...members.map(symbol => ({ label: symbol.name, kind: symbol.kind, detail: symbolDetail(symbol), insertText: symbol.name })),
    ...registryMembers(type, local)];
}

/** Query metadata first for a resolvable receiver, then the established source/runtime completion sources. */
export function languageCompletions(service, uri, offset) {
  const source = service.workspace.documents.get(uri)?.source ?? service.workspace.generatedDocuments.get(uri)?.source;
  if (!source) return [];
  const before = source.text.slice(0, offset);
  const member = before.match(/((?:global::)?[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*)\.([\p{L}\p{N}_]*)$/u);
  const model = service.metadata.current();
  if (member) {
    const imported = model?.members(uri, member[1], { position: offset, receiverStart: member.index, prefix: member[2] });
    if (imported) return service.unique(imported);
    const items = sourceMembers(service.workspace.compile(), uri, offset, member);
    return service.unique(items).filter(item => item.label.toLowerCase().startsWith(member[2].toLowerCase()));
  }
  const prefix = before.match(/[\p{L}_][\p{L}\p{N}_]*$/u)?.[0] ?? '';
  const result = service.workspace.compile();
  const symbols = result.symbols.filter(symbol => !symbol.name?.startsWith('<') && (symbol.kind !== 'local'
    || symbol.uri === uri && symbol.start <= offset && (symbol.scopeEnd ?? Infinity) >= offset));
  const items = symbols.map(symbol => ({ label: symbol.name, kind: symbol.kind, detail: symbolDetail(symbol), insertText: symbol.name }));
  for (const type of frameworkTypes.values()) {
    if (type.name.startsWith('SharpForge.Runtime.') || type.name.includes('`')) continue;
    const label = type.name.split('.').at(-1);
    items.push({ label, kind: type.kind === 'enum' ? 'enum' : 'class', detail: type.name + ' · supported web framework API', insertText: label });
  }
  for (const [label, detail] of Object.entries(intrinsicDocs)) items.push({ label, kind: 'class', detail, insertText: label });
  for (const word of keywords) {
    items.push({ label: word, kind: 'keyword', detail: 'C# keyword (some syntax is outside the executable profile)', insertText: word });
  }
  items.push(...model?.types(uri, prefix, offset) ?? []);
  return service.unique(items).filter(item => item.label.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((left, right) => left.kind === 'keyword' ? 1 : right.kind === 'keyword' ? -1 : left.label.localeCompare(right.label)).slice(0, 100);
}
