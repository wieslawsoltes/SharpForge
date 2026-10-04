import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {SemanticModel} from '@sharpforge/compiler';
import {frameworkType} from '@sharpforge/framework';
import {mapDesignInitializers} from './source-initializers.js';
import {checkSourceCancellation, failSource} from './source-errors.js';
import {sourceSyntaxCancellationToken} from './source-cancellation.js';

export function isDesignControl(type) {
  return ['control', 'shape', 'window'].includes(frameworkType(type)?.kind);
}

export function sourceMethods(parsedFiles) {
  return parsedFiles.flatMap(parsed => parsed.root.members.flatMap(owner => owner.kind === 'Class'
    ? owner.members.filter(method => method.kind === 'Method').map(method => ({method, owner, parsed}))
    : owner.kind === 'Method' ? [{method: owner, owner: null, parsed}] : []));
}

/** Bounded semantic analysis over all partial files; compiler symbols are never serialized. */
export function prepareDesignSources(input, options = {}) {
  checkSourceCancellation(options.signal);
  const sources = typeof input === 'string' ? [{uri: options.uri ?? 'DesignedView.g.cs', text: input}] : input;
  if (!Array.isArray(sources) || !sources.length || sources.length > (options.maxFiles ?? 256)) {
    failSource('Design analysis requires between 1 and 256 source documents', null, 'SFSYNC_LIMIT');
  }
  const uris = new Set();
  let length = 0;
  for (const file of sources) {
    if (typeof file.uri !== 'string' || typeof file.text !== 'string' || uris.has(file.uri)) {
      failSource('Source URIs must be unique and source text must be a string', null, 'SFSYNC_SYMBOL');
    }
    uris.add(file.uri);
    length += file.text.length;
    if (file.text.length > (options.maxBytes ?? 2_000_000) || length > (options.maxTotalBytes ?? 8_000_000)) {
      failSource('C# design source size limit exceeded', null, 'SFSYNC_LIMIT');
    }
  }
  if (reusableSourceAnalysis(options.reuseAnalysis, sources, options)) {
    return selectSourceConstruction(options.reuseAnalysis.context, options);
  }
  const cancellationToken = sourceSyntaxCancellationToken(options.signal);
  const parsedFiles = sources.map(file => {
    checkSourceCancellation(options.signal);
    return parse(new SourceText(file.text, file.uri, file.version ?? 0), undefined, {cancellationToken});
  });
  const supportedInitializers = new Map(parsedFiles.map(parsed => [parsed.source.uri, mapDesignInitializers(parsed)]));
  const syntaxErrors = parsedFiles.flatMap(parsed => parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error'
    // Inheritance does not invalidate the parsed construction body; its compiler errors still block executable plans.
    && diagnostic.code !== 'SF1014'
    && !(diagnostic.code === 'SF1018' && supportedInitializers.get(parsed.source.uri).some(span => span.start <= diagnostic.start
      && span.end >= diagnostic.start + diagnostic.length))));
  if (syntaxErrors.length) {
    const first = syntaxErrors[0];
    failSource(syntaxErrors.map(diagnostic => diagnostic.message).join('\n'),
      {start: first.start, end: first.start + first.length, uri: first.uri}, 'SFSYNC_PARSE', {diagnostics: syntaxErrors});
  }
  const semantic = options.semanticContext ?? SemanticModel.create(parsedFiles, {outputKind: 'library', ...options.compilationOptions});
  checkSourceCancellation(options.signal);
  const symbols = semantic.result.symbols ?? [];
  const references = semantic.result.references ?? [];
  const symbolsByLocation = new Map();
  const symbolsByName = new Map();
  for (const symbol of symbols) {
    symbolsByLocation.set(symbol.uri + ':' + symbol.start + ':' + symbol.name, symbol);
    const key = symbol.uri + ':' + symbol.name;
    if (!symbolsByName.has(key)) symbolsByName.set(key, []);
    symbolsByName.get(key).push(symbol);
  }
  const referencesBySymbol = new Map();
  for (const reference of references) {
    if (!referencesBySymbol.has(reference.symbolId)) referencesBySymbol.set(reference.symbolId, []);
    referencesBySymbol.get(reference.symbolId).push(reference);
  }
  return selectSourceConstruction({sources: sources.map(file => ({...file})), parsedFiles, methods: sourceMethods(parsedFiles),
    model: semantic.model, result: semantic.result, symbols, symbolsByLocation, symbolsByName, referencesBySymbol,
    compilationOptionsKey: JSON.stringify({outputKind: 'library', ...options.compilationOptions})}, options);
}

function reusableSourceAnalysis(analysis, sources, options) {
  if (!analysis?.context || options.semanticContext || analysis.sources.length !== sources.length) return false;
  const nextOptions = {outputKind: 'library', ...options.compilationOptions};
  if (analysis.context.compilationOptionsKey !== JSON.stringify(nextOptions)) return false;
  const previous = new Map(analysis.sources.map(source => [source.uri, source]));
  return sources.every(source => {
    const old = previous.get(source.uri);
    return old?.text === source.text && old.version === source.version
      && !!(old.readOnly || old.readonly) === !!(source.readOnly || source.readonly);
  });
}

function selectSourceConstruction(context, options) {
  const {methods, parsedFiles, model} = context;
  const methodMatches = candidate => !options.methodName || candidate.method.name === options.methodName
    && (options.methodName !== '.ctor' || !candidate.method.parameters.length && !candidate.method.modifiers?.includes('static'));
  let preferred = methods.filter(candidate => (!options.uri || candidate.parsed.source.uri === options.uri)
    && (!options.className || ownerName(candidate.owner) === options.className || candidate.owner?.name === options.className)
    && methodMatches(candidate));
  if (options.uri && !preferred.some(candidate => ['Create', 'InitializeComponent', 'Main'].includes(candidate.method.name)
    || options.methodName && candidate.method.name === options.methodName)) {
    const active = parsedFiles.find(parsed => parsed.source.uri === options.uri);
    const activeOwners = new Set((active?.root.members ?? []).filter(member => member.kind === 'Class').map(ownerName));
    preferred = methods.filter(candidate => activeOwners.has(ownerName(candidate.owner))
      && (!options.className || ownerName(candidate.owner) === options.className || candidate.owner?.name === options.className)
      && methodMatches(candidate));
  }
  const chosen = chooseMethod(preferred, options.methodName);
  if (!chosen) failSource('Select a C# file with a declarative Create, InitializeComponent, Main or parameterless constructor',
    null, 'SFSYNC_SYMBOL');
  if (chosen.method.body?.kind !== 'Block') failSource('A block-bodied construction method is required', chosen.method);
  const ownerSymbol = model.getDeclaredSymbol(chosen.owner);
  const methodSymbol = model.getDeclaredSymbol(chosen.method);
  // The semantic-analysis symbols need not carry execution records. Preserve all parsed parts of the chosen owner.
  const partials = chosen.owner ? parsedFiles.flatMap(parsed => parsed.root.members.filter(member =>
    member.kind === 'Class' && ownerName(member) === ownerName(chosen.owner))) : [];
  const fields = new Map(partials.flatMap(partial => partial.members.filter(member => member.kind === 'Field')
    .map(field => [field.name, field])));
  return {...context, chosen, ownerSymbol, methodSymbol, partials, fields};
}

function directlyConstructsControl(method) {
  return method.body?.statements?.some(statement => statement.kind === 'Local'
    ? statement.declarations.some(declaration => isDesignControl(declaration.initializer?.type))
    : statement.expression?.kind === 'Assignment' && isDesignControl(statement.expression.right?.type));
}

function chooseMethod(candidates, requested) {
  let selected = requested ? candidates : [];
  if (!requested) {
    for (const name of ['Create', 'InitializeComponent', 'Main', '.ctor']) {
      selected = candidates.filter(candidate => candidate.method.name === name
        && (name !== '.ctor' || !candidate.method.parameters.length && !candidate.method.modifiers?.includes('static')
          && directlyConstructsControl(candidate.method)));
      if (selected.length) break;
    }
  }
  if (!selected.length) {
    selected = candidates.filter(candidate => candidate.method.body?.statements?.some(statement => statement.kind === 'Local'
      && statement.declarations.some(declaration => isDesignControl(declaration.initializer?.type))));
  }
  if (selected.length > 1) failSource('Construction method is ambiguous; select the containing class and method', null, 'SFSYNC_SYMBOL');
  return selected[0] ?? null;
}

export function ownerName(owner) {
  return owner ? [owner.namespace, owner.name].filter(Boolean).join('.') : '<global>';
}

/** Symbol keys deliberately omit offsets; declaration location remains separate navigation metadata. */
export function sourceSymbolIdentity(symbol, context) {
  if (!symbol) return null;
  const owner = symbol.owner ?? symbol.containingSymbol?.legacyName ?? ownerName(context.chosen.owner);
  const method = symbol.method ?? context.chosen.method.name;
  return [owner, symbol.kind, symbol.kind === 'local' || symbol.kind === 'Local' ? method : '', symbol.name].join('|');
}

export function controlSourceSymbol(context, name, expression, declaration) {
  const field = context.fields.get(name);
  const syntax = field ?? declaration;
  const semantic = context.model.getDeclaredSymbol(syntax) ?? context.model.getSymbolInfo(expression).symbol;
  const span = field?.nameSpan ?? declaration?.nameSpan;
  const uri = field?.uri ?? declaration?.uri ?? context.chosen.parsed.source.uri;
  const record = span ? context.symbolsByLocation.get(uri + ':' + span.start + ':' + name)
    : context.symbolsByName.get(uri + ':' + name)?.find(symbol => ['local', 'field'].includes(symbol.kind));
  return {semantic, record, key: sourceSymbolIdentity(record ?? semantic, context), field,
    references: record ? context.referencesBySymbol.get(record.id) ?? [] : [],
    location: span ? {uri, ...span} : {uri, start: declaration?.start ?? expression.start, end: declaration?.end ?? expression.end}};
}
