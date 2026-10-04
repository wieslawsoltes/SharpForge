import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {generateResponsiveMethods} from './layout-authoring-responsive.js';
import {csharpValue} from './codegen.js';
import {sourceMethods, ownerName} from './source-symbols.js';
import {inferSourceStyle} from './source-text.js';
import {sourceSpanLookup} from './source-spans.js';
import {sourceSyntaxCancellationToken} from './source-cancellation.js';
import {failSource, checkSourceCancellation} from './source-errors.js';
import {responsiveClassBodyEnd} from './source-responsive-syntax.js';

export function responsiveSourceFile(base, method) {
  const uri = method.uri ?? base.uri;
  const parsed = base.context.parsedFiles.find(file => file.source.uri === uri);
  if (!parsed) failSource('Adaptive source is no longer available', method, 'SFSYNC_CONFLICT');
  return {...base, uri, parsed, text: parsed.source.text, method, style: inferSourceStyle(parsed.source.text, method)};
}

function allocateName(stem, taken) {
  let name = stem;
  let suffix = 1;
  while (taken.has(name)) name = stem + '_' + suffix++;
  taken.add(name);
  return name;
}

function declarationText(files, location, fallback) {
  const file = files.get(location?.uri);
  return location && file ? file.text.slice(location.start, location.end) : fallback;
}

/** Keep existing field-only signatures; pass only the controls that require construction-local access. */
export function responsiveSourceSignature(base, document, names, targetIds) {
  if (!base.owner) failSource('Adaptive helpers require a containing class', base.method, 'SFSYNC_OWNERSHIP');
  const existing = base.responsiveSource;
  const files = new Map(base.sources.map(file => [file.uri, file]));
  const taken = new Set([...base.context.symbols.map(symbol => symbol.name), ...names.values()]);
  for (const partial of base.context.partials) for (const member of partial.members) if (member.name) taken.add(member.name);
  const methodName = existing ? declarationText(files, existing.method.nameSpan &&
    {...existing.method.nameSpan, uri: existing.uri}, existing.method.name) : allocateName('ApplyAdaptive', taken);
  const widthName = existing?.widthName ?? allocateName('width', new Set(names.values()));
  taken.add(widthName);
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const targets = existing?.targets.filter(target => targetIds.has(target.id)).map(target => ({...target})) ?? [];
  const passed = new Set(targets.map(target => target.id));
  for (const target of targets) taken.add(target.name);
  const useFields = Object.values(base.bindings).some(binding => binding.field) && base.method.modifiers?.includes('static');
  for (const id of targetIds) {
    const binding = base.bindings[id];
    if (binding?.inline) failSource('Adaptive source requires named control targets', binding.creation, 'SFSYNC_OWNERSHIP');
    const field = binding ? binding.field && binding.statement.kind !== 'Local'
      && binding.fieldDeclaration.modifiers?.includes('static') : useFields;
    if (field || passed.has(id)) continue;
    targets.push({id, type: nodes.get(id).type, name: allocateName('adaptive' + targets.length, taken)});
    passed.add(id);
  }
  const variables = new Map();
  for (const id of targetIds) {
    const binding = base.bindings[id];
    variables.set(id, binding && binding.name === names.get(id)
      ? declarationText(files, binding.declaration, names.get(id)) : names.get(id));
  }
  const parameters = targets.map(target => ({...target, argument: variables.get(target.id)}));
  const byId = new Map(parameters.map(parameter => [parameter.id, parameter.name]));
  const shadowed = new Set([widthName, ...parameters.map(parameter => parameter.name)]);
  const symbol = id => {
    if (byId.has(id)) return byId.get(id);
    const name = variables.get(id);
    return shadowed.has(names.get(id)) ? ownerName(base.owner) + '.' + name : name;
  };
  const root = nodes.get(document.root);
  const viewport = !parameters.length && root?.type === 'Microsoft.UI.Xaml.Window' && (!existing || existing.viewport)
    ? {window: names.get(root.id), handlerName: existing?.viewport?.handlerName ?? allocateName('OnAdaptiveSizeChanged', taken)} : null;
  return {methodName, widthName, parameters, symbol, viewport};
}

/** Before removing or changing a helper signature, every call must belong to its proved initializer. */
export function assertResponsiveReferencesOwned(base) {
  const adaptive = base.responsiveSource;
  const regions = [adaptive.method, adaptive.initializer,
    ...(adaptive.viewport ? [adaptive.viewport.method, adaptive.viewport.statement] : [])];
  const owns = sourceSpanLookup(regions, base.uri);
  for (const method of [adaptive.method, ...(adaptive.viewport ? [adaptive.viewport.method] : [])]) {
    const span = method.nameSpan;
    const uri = method.uri ?? adaptive.uri;
    const symbol = span && base.context.symbolsByLocation.get(uri + ':' + span.start + ':' + method.name);
    let references;
    if (symbol) references = base.context.referencesBySymbol.get(symbol.id) ?? [];
    else references = base.context.parsedFiles.flatMap(parsed => parsed.tokens
      .filter(token => token.kind === 'identifier' && token.value === method.name)
      .map(token => ({uri: parsed.source.uri, start: token.start, end: token.end})));
    const outside = references.filter(reference => !reference.declaration && !owns(reference));
    if (outside.length) failSource('Adaptive helper is referenced outside its owned construction or viewport adapter', method,
      'SFSYNC_REFERENCE', {references: outside});
  }
}

/** Generate through the shared emitter and parse its method boundary; no source-pattern replacement is used. */
export function emitResponsiveSource(document, signature, signal) {
  checkSourceCancellation(signal);
  const emission = generateResponsiveMethods(document, {...signature, csharpValue});
  const text = 'class AdaptiveSource {\n' + emission.methods.join('\n') + '\n}';
  const parsed = parse(new SourceText(text), undefined, {cancellationToken: sourceSyntaxCancellationToken(signal)});
  const methods = sourceMethods([parsed]);
  const method = methods[0]?.method;
  if (!method || parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    failSource('Adaptive source generator could not represent this helper', null, 'SFSYNC_OWNERSHIP');
  }
  return {text, method, viewportMethod: methods[1]?.method ?? null,
    initializer: emission.initialize[0].trim(), initializers: emission.initialize.map(line => line.trim()), diagnostics: emission.diagnostics};
}

/** Structural changes retain every non-marker comment while adapting indentation to the containing source. */
export function responsiveMethodBody(generated, source, comments = []) {
  const {style} = source;
  const lines = generated.text.slice(generated.method.body.start, generated.method.body.end).split('\n');
  const body = lines.map((line, index) => {
    if (!index) return line;
    const indentation = line.length - line.trimStart().length;
    return style.methodIndent + style.unit.repeat(Math.max(0, indentation / 4 - 1)) + line.trimStart();
  });
  if (comments.length) body.splice(1, 0, ...comments.map(comment => style.methodIndent + style.unit + comment.text));
  return body.join(style.newline);
}

export function responsiveMethodInsertion(base, generated) {
  const body = responsiveMethodBody(generated, base);
  const signature = generated.text.slice(generated.method.start, generated.method.body.start).trim();
  const {style} = base;
  const separator = style.braceOnNewLine ? style.newline + style.methodIndent : ' ';
  const at = responsiveClassBodyEnd(base);
  return {uri: base.uri, start: at, end: at,
    text: style.newline + style.methodIndent + signature + separator + body + style.newline};
}
