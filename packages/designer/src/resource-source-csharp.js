import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {SemanticModel} from '@sharpforge/compiler';
import {resourceSourceCheck, resourceSourceFail, resourceSourceLocation} from './resource-source-errors.js';
import {sourceSyntaxCancellationToken} from './source-cancellation.js';

const dictionaryType = 'Microsoft.UI.Xaml.ResourceDictionary';
const loaderName = 'Microsoft.UI.Xaml.Markup.XamlReader.Load';
const pathOf = node => node?.kind === 'Name' ? node.name : node?.kind === 'Member' && pathOf(node.target)
  ? pathOf(node.target) + '.' + node.name : null;

function resourceMethod(method) {
  if (method.kind !== 'Method' || method.name !== 'Create' || method.returnType !== dictionaryType
    || !method.modifiers?.includes('static') || method.parameters.length || method.body?.kind !== 'Block') return null;
  const statements = method.body.statements;
  if (statements.length !== 1 || statements[0].kind !== 'Return') return null;
  const cast = statements[0].expression;
  if (cast?.kind !== 'Cast' || cast.type !== dictionaryType) return null;
  const call = cast.expression;
  if (call?.kind !== 'Call' || pathOf(call.target) !== loaderName || call.args.length !== 1) return null;
  const literal = call.args[0];
  return literal.kind === 'Literal' && literal.type === 'string' && typeof literal.value === 'string' ? literal : null;
}

/** Syntax owns the exact literal span; the semantic model records the actual unsupported compiler diagnostics. */
export function discoverResourceSource(input, options = {}) {
  if (!Array.isArray(input) || !input.length || input.length > (options.maxFiles ?? 256)) {
    resourceSourceFail('SFD1881', 'Resource analysis requires between 1 and 256 source files.');
  }
  const sources = input.map(source => ({...source}));
  let characters = 0;
  const uris = new Set();
  const cancellationToken = sourceSyntaxCancellationToken(options.signal);
  const parsed = sources.map(source => {
    resourceSourceCheck(options.signal);
    if (typeof source.uri !== 'string' || !/\.cs$/i.test(source.uri) || uris.has(source.uri) || typeof source.text !== 'string') {
      resourceSourceFail('SFD1880', 'Resource sources require unique C# URIs and source text.');
    }
    uris.add(source.uri);
    characters += source.text.length;
    if (source.text.length > (options.maxCharacters ?? 2_000_000) || characters > (options.maxTotalCharacters ?? 8_000_000)) {
      resourceSourceFail('SFD1881', 'Resource source character limit exceeded.', {uri: source.uri});
    }
    const result = parse(new SourceText(source.text, source.uri, source.version ?? 0), undefined, {cancellationToken});
    const diagnostic = result.diagnostics.find(item => item.severity === 'error');
    if (diagnostic) resourceSourceFail('SFD1880', diagnostic.message, {
      uri: source.uri, span: {start: diagnostic.start, length: diagnostic.length}});
    return result;
  });
  const candidates = [];
  for (const file of parsed) {
    if (options.uri && file.source.uri !== options.uri) continue;
    for (const owner of file.root.members) {
      if (owner.kind !== 'Class') continue;
      const className = [owner.namespace, owner.name].filter(Boolean).join('.');
      if (options.className && ![className, owner.name].includes(options.className)) continue;
      for (const method of owner.members) {
        const literal = resourceMethod(method);
        if (literal) candidates.push({owner, method, literal, className, uri: file.source.uri});
      }
    }
  }
  if (candidates.length !== 1) resourceSourceFail('SFD1880', candidates.length
    ? 'Select one generated resource class; the resource construction method is ambiguous.'
    : 'No supported generated ResourceDictionary Create/XamlReader.Load literal was found.', {uri: options.uri});
  const selected = candidates[0];
  resourceSourceCheck(options.signal);
  const semantic = options.probe ? null : SemanticModel.create(parsed, {outputKind: 'library'});
  resourceSourceCheck(options.signal);
  const constant = semantic?.model.getConstantValue(selected.literal);
  if (constant?.hasValue && constant.value !== selected.literal.value) {
    resourceSourceFail('SFD1880', 'The semantic constant disagrees with the owned resource literal.',
      resourceSourceLocation(selected.uri, selected.literal));
  }
  return {...selected, sources, parsed, semantic};
}

function walk(root, action, signal) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    if (seen.size > 500000) resourceSourceFail('SFD1881', 'Resource reference scan node limit exceeded.');
    seen.add(node);
    resourceSourceCheck(signal);
    if (node.kind) action(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value === 'object') stack.push(value);
    }
  }
}

function dictionaryAliases(context, signal) {
  const names = new Set();
  const aliases = new Map();
  const types = new Set([dictionaryType, 'ResourceDictionary']);
  const factories = new Set([context.className + '.Create', context.owner.name + '.Create']);
  const register = (name, type, expression) => {
    if (!name) return;
    const actualType = expression && context.semantic?.model.getTypeInfo(expression).type;
    const semanticName = actualType?.legacy?.fullName ?? actualType?.name;
    if (types.has(type) || types.has(semanticName) || expression?.kind === 'New' && types.has(expression.type)
      || expression?.kind === 'Cast' && types.has(expression.type)
      || expression?.kind === 'Call' && factories.has(pathOf(expression.target))) {
      names.add(name);
    } else {
      const source = pathOf(expression);
      if (!source) return;
      if (!aliases.has(source)) aliases.set(source, []);
      aliases.get(source).push(name);
    }
  };
  for (const file of context.parsed) walk(file.root, node => {
    if (node.kind === 'Method') for (const parameter of node.parameters) register(parameter.name, parameter.type);
    if (node.kind === 'Local') for (const declaration of node.declarations) {
      register(declaration.name, declaration.type, declaration.initializer);
    }
    if (node.kind === 'Field') register(node.name, node.type, node.initializer);
    if (node.kind === 'Assignment' && node.operator === '=') register(pathOf(node.left), null, node.right);
  }, signal);
  const pending = [...names];
  for (let index = 0; index < pending.length; index++) {
    for (const alias of aliases.get(pending[index]) ?? []) {
      if (!names.has(alias)) {
        names.add(alias);
        pending.push(alias);
      }
    }
  }
  return names;
}

/** Refuse matching index/lookup keys outside the owned literal instead of guessing which dictionary they address. */
export function externalResourceReferences(context, keys, {signal} = {}) {
  const references = [];
  const wanted = new Set(keys);
  const aliases = dictionaryAliases(context, signal);
  const accessors = new Set(['Lookup', 'TryGetValue', 'ContainsKey', 'FindResource', 'Remove']);
  const inspect = (node, uri) => {
    let argument = null;
    if (node.kind === 'Index' || node.kind === 'ConditionalIndex') argument = node.index;
    else if (node.kind === 'Call' && accessors.has(node.target?.name)) argument = node.args[0];
    if (!argument) return;
    const location = resourceSourceLocation(uri, argument);
    if (argument.kind === 'Literal' && typeof argument.value === 'string' && wanted.has(argument.value)) {
      references.push({...location, key: argument.value, reason: 'matching-unowned-key'});
    } else if (argument.kind !== 'Literal' && (aliases.has(pathOf(node.kind === 'Call' ? node.target.target : node.target))
      || pathOf(node.target)?.includes('Resources') || pathOf(node.target)?.includes('resources'))) {
      references.push({...location, key: null, reason: 'dynamic-resource-key'});
    }
  };
  for (const file of context.parsed) walk(file.root, node => inspect(node, file.source.uri), signal);
  return references.sort((left, right) => left.uri.localeCompare(right.uri) || left.span.start - right.span.start);
}
