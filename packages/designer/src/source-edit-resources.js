import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {XAML, CONTROLS, canonicalType} from '@sharpforge/framework';
import {propertySchema} from './model.js';
import {generateDesignCode, csharpValue} from './codegen.js';
import {sourceMethods} from './source-symbols.js';
import {sourceLiteralEdit} from './source-literals.js';
import {failSource} from './source-errors.js';
import {sourceSpanLookup as intervalLookup} from './source-spans.js';
import {
  sameSourceValue, sourceInsertion, sourceComments, inferSourceStyle,
  removeSourceStatement, removeSourceInitializer,
} from './source-text.js';

const axes = Object.freeze([
  {key: 'rows', property: 'RowDefinitions', member: 'Height', type: 'RowDefinition'},
  {key: 'columns', property: 'ColumnDefinitions', member: 'Width', type: 'ColumnDefinition'},
]);
const referenceKinds = Object.freeze([['style', 'Style'], ['template', 'Template']]);
const spanKey = (span, uri) => `${span.uri ?? uri}:${span.start}:${span.end}`;

function resourceContext(base, next, names) {
  const entries = new Map();
  const occupied = new Set([...base.fields, ...names.values(), ...(base.method.parameters ?? []).map(parameter => parameter.name)]);
  const owned = [];
  for (const statement of base.method.body.statements) {
    for (const declaration of statement.declarations ?? []) occupied.add(declaration.name);
  }
  for (const [name, resource] of base.resources ?? []) {
    const key = `${resource.kind}:${resource.key}`;
    if (entries.has(key)) failSource('Resource identity is ambiguous: ' + resource.key, resource.declaration, 'SFSYNC_SYMBOL');
    entries.set(key, {...resource, name});
    occupied.add(name);
    owned.push(...resource.statements);
  }
  for (const binding of Object.values(base.bindings)) {
    for (const [, property] of referenceKinds) {
      const origin = binding.properties[property];
      if (origin) owned.push(...[...(origin.previous ?? []), origin].filter(entry => !entry.dynamic).map(entry => entry.statement));
    }
  }
  const aliases = new Map();
  for (const [kind] of referenceKinds) {
    for (const key of Object.keys(next[kind === 'style' ? 'styles' : 'templates'])) {
      const entry = entries.get(`${kind}:${key}`);
      const proposed = `${kind}_${key}`;
      if (!entry && occupied.has(proposed)) failSource('Resource identifier already exists: ' + proposed, null, 'SFSYNC_SYMBOL');
      const statement = entry?.statements[0];
      const declaration = statement?.declarations?.find(item => item.name === entry.name);
      const location = declaration?.nameSpan ?? statement?.expression?.left;
      aliases.set(`${kind}:${key}`, location ? base.text.slice(location.start, location.end) : entry?.name ?? proposed);
      occupied.add(proposed);
    }
  }
  const tokens = new Map();
  for (const token of base.parsed.tokens) {
    if (token.kind !== 'identifier') continue;
    if (!tokens.has(token.value)) tokens.set(token.value, []);
    tokens.get(token.value).push({start: token.start, end: token.end, uri: base.uri});
  }
  return {base, next, names, entries, aliases, tokens, owns: intervalLookup(owned, base.uri), edits: [], external: [], insertions: new Map()};
}

function references(context, entry) {
  const {base} = context;
  const statement = entry.statements[0];
  const declaration = statement?.declarations?.find(item => item.name === entry.name);
  const location = declaration?.nameSpan ?? statement?.expression?.left;
  const symbol = base.context?.symbols.find(candidate => candidate.name === entry.name
    && candidate.uri === base.uri && (location ? candidate.start === location.start : candidate.start >= statement.start
      && candidate.start < entry.declaration.start));
  return symbol ? base.context.referencesBySymbol.get(symbol.id) ?? [] : context.tokens.get(entry.name) ?? [];
}

function assertOwned(context, entry) {
  if (!entry?.statements?.length) failSource('Resource has no proven source ownership', null, 'SFSYNC_OWNERSHIP');
  const {base} = context;
  for (const statement of entry.statements) {
    if (statement.kind === 'Local' && statement.declarations.length !== 1) {
      failSource('Split this resource declaration before editing it', statement, 'SFSYNC_OWNERSHIP');
    }
    const protectedRegion = base.ownership?.regions.find(region => region.span.start === statement.start && region.kind !== 'designer');
    if (protectedRegion || base.unmanaged.some(item => item.statement.start === statement.start)) {
      failSource('Resource construction contains protected user code', statement, 'SFSYNC_OWNERSHIP');
    }
  }
  const external = references(context, entry).filter(reference => !reference.declaration && !context.owns(reference));
  if (external.length) failSource('Resource is referenced by handwritten C#', entry.declaration, 'SFSYNC_REFERENCE', {references: external});
}

function insert(context, offset, lines) {
  if (!lines.length) return;
  if (!context.insertions.has(offset)) context.insertions.set(offset, []);
  context.insertions.get(offset).push(...lines);
}

function resourceBoundary(base) {
  return Math.min(...Object.values(base.bindings).map(binding => binding.statement.start), base.method.body.end - 1);
}

function verifyMetadata(before, after, allowed) {
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (!allowed.includes(key) && !sameSourceValue(before?.[key], after?.[key])) {
      failSource('This source profile cannot synchronize resource metadata: ' + key, null, 'SFSYNC_OWNERSHIP');
    }
  }
}

function styleLines(context, key, entry) {
  const style = context.next.styles[key];
  const name = context.aliases.get(`style:${key}`);
  const statement = entry?.statements[0];
  const type = statement?.kind === 'Local' ? statement.declarations[0].type : context.base.style.usesVar ? 'var' : XAML + 'Style';
  if (typeof type !== 'string' || !type.length) failSource('Resource declaration type is unavailable', statement, 'SFSYNC_OWNERSHIP');
  const declaration = statement && statement.kind !== 'Local' ? name : `${type} ${name}`;
  const usesType = entry?.declaration.args[0]?.kind === 'TypeOfExpression'
    || !entry && [...context.entries.values()].some(resource => resource.kind === 'style'
      && resource.declaration.args[0]?.kind === 'TypeOfExpression');
  const target = usesType ? `typeof(${style.targetType})` : JSON.stringify(style.targetType);
  const lines = [`${declaration} = new ${XAML}Style(${target});`];
  if (style.basedOn) lines.push(`${name}.BasedOn = ${context.aliases.get(`style:${style.basedOn}`)};`);
  const properties = propertySchema(style.targetType);
  for (const [property, value] of Object.entries(style.setters)) {
    if (!properties[property]) failSource('Unsupported style setter: ' + property, entry?.declaration, 'SFSYNC_OWNERSHIP');
    const expression = csharpValue(value, properties[property].type);
    lines.push(`${name}.Setters.Add(new ${XAML}Setter(${style.targetType}.${property}Property, ${expression}));`);
  }
  return lines;
}

function styleEdits(context) {
  const {base, next} = context;
  const changed = new Set();
  const deleting = [];
  for (const key of new Set([...Object.keys(base.document.styles), ...Object.keys(next.styles)])) {
    const before = base.document.styles[key];
    const after = next.styles[key];
    if (sameSourceValue(before, after)) continue;
    verifyMetadata(before, after, ['targetType', 'basedOn', 'setters']);
    const entry = context.entries.get(`style:${key}`);
    if (before) {
      assertOwned(context, entry);
      deleting.push(...entry.statements);
    }
    if (after) changed.add(key);
  }
  const removed = intervalLookup(deleting, base.uri);
  const order = [];
  const visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    if (next.styles[key].basedOn) visit(next.styles[key].basedOn);
    order.push(key);
  }
  for (const key of Object.keys(next.styles)) visit(key);
  const anchors = new Map();
  const lower = new Map();
  for (const key of order.filter(key => changed.has(key))) {
    const entry = context.entries.get(`style:${key}`);
    const dependency = next.styles[key].basedOn;
    const baseEntry = context.entries.get(`style:${dependency}`);
    const earliest = !dependency ? base.method.body.start + 1 : changed.has(dependency) ? lower.get(dependency)
      : Math.max(...baseEntry.statements.map(statement => statement.end));
    const usages = entry ? references(context, entry).filter(reference => !removed(reference)) : [];
    const statements = base.method.body.statements.filter(statement => usages.some(reference => reference.start >= statement.start
      && reference.end <= statement.end));
    const latest = entry ? Math.min(...statements.map(statement => statement.start), base.method.body.end - 1) : resourceBoundary(base);
    if (earliest > latest) failSource('Style dependencies must be initialized before resource usage', entry?.declaration, 'SFSYNC_OWNERSHIP');
    const preferred = entry?.statements[0].start ?? resourceBoundary(base);
    lower.set(key, earliest);
    anchors.set(key, Math.min(latest, Math.max(earliest, preferred)));
  }
  for (const key of [...order].reverse()) {
    const dependency = next.styles[key].basedOn;
    if (changed.has(key) && changed.has(dependency)) anchors.set(dependency, Math.min(anchors.get(dependency), anchors.get(key)));
  }
  for (const key of order.filter(key => changed.has(key))) {
    insert(context, anchors.get(key), styleLines(context, key, context.entries.get(`style:${key}`)));
  }
  for (const statement of deleting) context.edits.push(removeSourceStatement(base, statement));
}

function fileAnalysis(base, method) {
  const uri = method.uri ?? base.uri;
  const parsed = base.context?.parsedFiles.find(file => file.source.uri === uri) ?? (uri === base.uri ? base.parsed : null);
  if (!parsed) failSource('Template source is no longer available', method, 'SFSYNC_CONFLICT');
  return {...base, uri, text: parsed.source.text, parsed, method, style: inferSourceStyle(parsed.source.text, method)};
}

function factoryBody(generated, method, source) {
  const style = source.style;
  const lines = generated.slice(method.body.start, method.body.end).split('\n');
  const body = lines.map((line, index) => {
    if (!index) return line;
    const indentation = line.match(/^ */)[0].length;
    return style.methodIndent + style.unit.repeat(Math.max(0, indentation / 4 - 1)) + line.trimStart();
  });
  const comments = sourceComments(source.text.slice(source.method.body.start, source.method.body.end));
  if (comments.length) body.splice(1, 0, ...comments.map(comment => style.methodIndent + style.unit + comment));
  return body.join(style.newline);
}

function route(context, source, edit) {
  if (source.uri === context.base.uri) context.edits.push(edit);
  else context.external.push({uri: source.uri, ...edit});
}

function assertFactoryRemovable(context, method) {
  const known = [method, ...[...context.entries.values()].filter(entry => entry.kind === 'template').flatMap(entry => entry.statements)];
  const owns = intervalLookup(known, context.base.uri);
  const files = context.base.context?.parsedFiles ?? [context.base.parsed];
  const uses = files.flatMap(parsed => parsed.tokens.filter(token => token.kind === 'identifier' && token.value === method.name)
    .map(token => ({uri: parsed.source.uri, start: token.start, end: token.end}))).filter(location => !owns(location));
  if (uses.length) failSource('Template factory is referenced outside owned resource declarations', method, 'SFSYNC_REFERENCE', {references: uses});
}

function templateEdits(context) {
  const {base, next} = context;
  const groups = new Map();
  const updated = new Set();
  let generated;
  let methods;
  const generatedMethod = key => {
    if (!methods) {
      generated = generateDesignCode(next);
      methods = new Map(sourceMethods([parse(new SourceText(generated))]).map(item => [item.method.name, item.method]));
    }
    return methods.get('Template_' + key);
  };
  for (const [key, method] of base.templateMethods) {
    const identity = spanKey(method, base.uri);
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(key);
  }
  for (const key of new Set([...Object.keys(base.document.templates), ...Object.keys(next.templates)])) {
    const before = base.document.templates[key];
    const after = next.templates[key];
    if (sameSourceValue(before, after)) continue;
    verifyMetadata(before, after, ['targetType', 'root']);
    const entry = context.entries.get(`template:${key}`);
    const method = base.templateMethods.get(key);
    if (before) {
      assertOwned(context, entry);
      if (!method) failSource('Custom template factory is not designer-owned', entry.declaration, 'SFSYNC_OWNERSHIP');
    }
    if (!after) {
      for (const statement of entry.statements) context.edits.push(removeSourceStatement(base, statement));
    }
    if (!method) {
      addTemplate(context, key, generatedMethod(key), generated);
      continue;
    }
    const identity = spanKey(method, base.uri);
    if (updated.has(identity)) continue;
    updated.add(identity);
    const remaining = groups.get(identity).filter(peer => next.templates[peer]);
    const source = fileAnalysis(base, method);
    if (!remaining.length) {
      assertFactoryRemovable(context, method);
      route(context, source, removeSourceStatement(source, method));
      continue;
    }
    const desired = next.templates[remaining[0]];
    if (remaining.some(peer => !sameSourceValue(next.templates[peer], desired))) {
      failSource('Shared template factory must retain one definition for all its resource aliases', method, 'SFSYNC_OWNERSHIP');
    }
    if (sameSourceValue(base.document.templates[remaining[0]], desired)) continue;
    const canonical = generatedMethod(remaining[0]);
    route(context, source, {start: method.body.start, end: method.body.end, text: factoryBody(generated, canonical, source)});
  }
}

function addTemplate(context, key, method, generated) {
  const {base} = context;
  if (!base.owner || !method) failSource('Template factories require a containing class', null, 'SFSYNC_OWNERSHIP');
  const name = 'Template_' + key;
  if ((base.methods ?? []).some(item => item.method.name === name) || base.owner.members.some(member => member.name === name)) {
    failSource('An existing custom member owns template factory name ' + name, null, 'SFSYNC_OWNERSHIP');
  }
  const style = base.style;
  const synthetic = {...base, method: {body: {start: 0, end: 0}}};
  const body = factoryBody(generated, method, synthetic);
  const signature = generated.slice(method.start, method.body.start).trim();
  const separator = style.braceOnNewLine ? style.newline + style.methodIndent : ' ';
  const text = style.newline + style.methodIndent + signature + separator + body + style.newline;
  context.edits.push({start: base.owner.end - 1, end: base.owner.end - 1, text});
  const type = style.usesVar ? 'var' : CONTROLS + 'ControlTemplate';
  insert(context, resourceBoundary(base), [`${type} ${context.aliases.get(`template:${key}`)} = ${name}();`]);
}

function referenceEdits(context, before, node, statements) {
  const binding = context.base.bindings[node.id];
  for (const [kind, property] of referenceKinds) {
    if (before?.[kind] === node[kind]) continue;
    const origin = binding?.properties[property];
    const entries = origin ? [...(origin.previous ?? []), origin] : [];
    if (entries.some(entry => entry.dynamic)) failSource('Dynamic resource expressions are protected', origin.expression, 'SFSYNC_DYNAMIC');
    if (node[kind]) {
      const name = context.aliases.get(`${kind}:${node[kind]}`);
      if (!name) failSource('Resource has no generated source identifier', origin?.expression, 'SFSYNC_SYMBOL');
      if (origin) context.edits.push({start: origin.expression.start, end: origin.expression.end, text: name});
      else statements.push(`${context.names.get(node.id)}.${property} = ${name};`);
    } else {
      if (!origin) failSource('Resource reference has no proven source span', binding?.creation, 'SFSYNC_OWNERSHIP');
      for (const entry of entries) context.edits.push(entry.initializer
        ? removeSourceInitializer(context.base, entry) : removeSourceStatement(context.base, entry.statement));
    }
  }
}

function trackValueEdit(context, entry, value, axis) {
  const expression = entry.expression;
  if (expression.kind !== 'New' || canonicalType(expression.type) !== CONTROLS + axis.type || expression.args.length) {
    failSource('Shared or custom track definitions must be edited in C#', expression, 'SFSYNC_OWNERSHIP');
  }
  const member = expression.initializers?.find(initializer => initializer.name === axis.member);
  if (member) return sourceLiteralEdit(context.base.text, member.expression, value, XAML + 'GridLength');
  const text = csharpValue(value, XAML + 'GridLength');
  if (context.base.text[expression.end - 1] !== '}') {
    return {start: expression.end, end: expression.end, text: ` { ${axis.member} = ${text} }`};
  }
  const tokens = context.base.parsed.tokens;
  const previous = tokens.filter(token => token.end < expression.end && token.start >= expression.start).at(-1);
  const separator = expression.initializers?.length && previous?.kind !== ',' ? ', ' : ' ';
  return {start: expression.end - 1, end: expression.end - 1, text: `${separator}${axis.member} = ${text} `};
}

function trackEdits(context, before, node, statements) {
  const binding = context.base.bindings[node.id];
  for (const axis of axes) {
    const previous = before?.[axis.key] ?? [];
    const current = node[axis.key] ?? [];
    if (sameSourceValue(previous, current)) continue;
    const entries = binding?.tracks?.[axis.key] ?? [];
    if (entries.length !== previous.length) failSource('Grid tracks have incomplete source ownership', binding?.creation, 'SFSYNC_OWNERSHIP');
    for (let index = 0; index < Math.max(previous.length, current.length); index++) {
      if (sameSourceValue(previous[index], current[index])) continue;
      if (index >= current.length) context.edits.push(removeSourceStatement(context.base, entries[index].statement));
      else if (index < previous.length) context.edits.push(trackValueEdit(context, entries[index], current[index], axis));
      else {
        const value = csharpValue(current[index], XAML + 'GridLength');
        statements.push(`${context.names.get(node.id)}.${axis.property}.Add(new ${CONTROLS}${axis.type}() { ${axis.member} = ${value} });`);
      }
    }
  }
}

/** Appends minimal owned resource/track edits atomically; sibling template edits carry their source URI. */
export function sourceResourceEdits(base, next, names, edits, external) {
  const context = resourceContext(base, next, names);
  styleEdits(context);
  templateEdits(context);
  const before = new Map(base.document.nodes.map(node => [node.id, node]));
  const statements = [];
  for (const node of next.nodes) {
    referenceEdits(context, before.get(node.id), node, statements);
    trackEdits(context, before.get(node.id), node, statements);
  }
  for (const [offset, lines] of context.insertions) context.edits.push(sourceInsertion(base, lines, offset));
  context.edits.push(sourceInsertion(base, statements));
  edits.push(...context.edits.filter(Boolean));
  external.push(...context.external);
}
