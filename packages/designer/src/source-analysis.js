import {XAML, canonicalType} from '@sharpforge/framework';
import {validateDesign, childSlot} from './model.js';
import {prepareDesignSources, ownerName} from './source-symbols.js';
import {SourceConstructionReader} from './source-reader.js';
import {retainSourceIdentities} from './source-identity.js';
import {retainSourceDesignMetadata} from './source-design-metadata.js';
import {inferSourceStyle} from './source-text.js';
import {designSourceDiagnostics, failSource} from './source-errors.js';
import {sourceRootBaseEvidence} from './source-preview.js';
import {sourceConstructorEvidence} from './source-constructor-preview.js';
import {readSourceResponsive} from './source-responsive.js';

/** Analyze all files together; reuseAnalysis may share immutable compiler data for another owner in the exact same source context. */
export function analyzeDesignSources(sources, options = {}) {
  const context = prepareDesignSources(sources, options);
  const reader = new SourceConstructionReader(context, options).read();
  const remap = retainSourceIdentities(reader, options.previous, options.identityHints);
  const responsiveSource = readSourceResponsive(reader);
  const children = new Set(reader.nodes.flatMap(node => node.children));
  const root = reader.root ?? reader.nodes.find(node => node.type === XAML + 'Window')?.id
    ?? reader.nodes.find(node => !children.has(node.id))?.id;
  if (!root) failSource('No supported controls were found in the construction method');
  const reachable = new Set();
  const stack = [root];
  while (stack.length) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    stack.push(...(reader.nodeMap.get(id)?.children ?? []));
  }
  const detached = reader.nodes.filter(node => !reachable.has(node.id));
  for (const node of detached) reader.warnings.push({code: 'SFSYNC_DETACHED', node: node.id,
    message: 'Control is constructed but not attached to the chosen root'});
  const nodes = reader.nodes.filter(node => reachable.has(node.id));
  const detachedAdaptive = responsiveSource?.resets.find(reset => !reachable.has(reset.id));
  if (detachedAdaptive) failSource('Adaptive helper targets a control outside the selected visual root',
    detachedAdaptive.statement, 'SFSYNC_OWNERSHIP');
  for (const node of nodes) {
    if (node.children.length && ['Content', 'Child'].includes(childSlot(node.type)?.property)) delete node.properties[childSlot(node.type).property];
    if (node.style && !reader.explicitResourceTypes.has(node.style)) reader.styles[node.style].targetType = node.type;
    if (node.template) reader.templates[node.template].targetType = node.type;
  }
  const previous = options.previous?.document ?? options.previous;
  const window = reader.nodeMap.get(root);
  const content = window.type === XAML + 'Window' ? reader.nodeMap.get(window.children[0]) : null;
  const size = key => {
    const value = window.properties[key] ?? content?.properties[key] ?? previous?.[key.toLowerCase()] ?? (key === 'Width' ? 960 : 640);
    return Number.isFinite(value) ? Math.max(100, value) : key === 'Width' ? 960 : 640;
  };
  const document = validateDesign(retainSourceDesignMetadata({version: 1, name: previous?.name ?? context.chosen.owner?.name ?? 'CSharpView',
    width: responsiveSource?.width ?? size('Width'), height: size('Height'), root, nodes, styles: reader.styles, templates: reader.templates,
    ...(responsiveSource ? {responsive: responsiveSource.value} : {}),
    ...(options.projectTypes ? {projectTypes: Array.isArray(options.projectTypes) ? options.projectTypes
      : Object.entries(options.projectTypes).map(([type, baseType]) => ({type, baseType}))} : {})}, previous));
  const {method, owner, parsed} = context.chosen;
  const ownership = {version: 1, uri: parsed.source.uri, className: ownerName(owner), methodName: method.name,
    methodSymbol: context.methodSymbol?.name ?? method.name, span: {start: method.body.start, end: method.body.end}, regions: reader.regions};
  if (method.name === '.ctor') {
    const construction = sourceConstructorEvidence(context);
    if (construction) ownership.construction = construction;
  }
  if (reader.rootAssignment) ownership.rootAssignment = {...reader.rootAssignment, ...sourceRootBaseEvidence(context, reader.rootAssignment),
    owner: ownerName(owner), methodName: method.name,
    childId: remap[reader.rootAssignment.childId] ?? reader.rootAssignment.childId};
  const analysis = {text: parsed.source.text, uri: parsed.source.uri, document, bindings: reader.bindings, method, owner,
    methods: context.methods, templateMethods: reader.templateMethods, resources: reader.resources, responsiveSource,
    unmanaged: reader.unmanaged, warnings: reader.warnings, detached, fields: new Set(context.fields.keys()), parsed,
    style: inferSourceStyle(parsed.source.text, method), ownership, identityRemap: remap, sources: context.sources,
    compilerDiagnostics: context.result.diagnostics ?? [], compilationSucceeded: context.result.success,
    structuralEditable: !reader.unmanaged.length && !reader.warnings.some(warning => ['SFSYNC_DYNAMIC', 'SFSYNC_EVENT'].includes(warning.code))
      && !detached.length, options: {...options, previous: undefined, reuseAnalysis: undefined, semanticContext: undefined, signal: undefined}};
  Object.defineProperty(analysis, 'context', {value: context, enumerable: false});
  return analysis;
}

/** Compatibility reader; `sources` may supply sibling partial documents. Offsets are UTF-16 code units. */
export function readDesignSource(text, options = {}) {
  const uri = options.uri ?? 'DesignedView.g.cs';
  const sources = options.sources ? options.sources.map(file => file.uri === uri ? {...file, text} : file) : [{uri, text}];
  if (!sources.some(file => file.uri === uri)) sources.push({uri, text});
  return analyzeDesignSources(sources, {...options, uri});
}

/** Serializable worker response excluding syntax/compiler object graphs and text duplication. */
export function designSourceSnapshot(analysis) {
  return {version: 1, uri: analysis.uri, text: analysis.text,
    method: {name: analysis.method.name, start: analysis.method.start, end: analysis.method.end,
      owner: analysis.owner?.name ?? null}, document: structuredClone(analysis.document), ownership: structuredClone(analysis.ownership),
    identityRemap: {...analysis.identityRemap}, structuralEditable: analysis.structuralEditable,
    compilationSucceeded: analysis.compilationSucceeded, diagnostics: designSourceDiagnostics(analysis),
    handlers: sourceHandlerCandidates(analysis),
    bindings: Object.fromEntries(Object.entries(analysis.bindings).map(([id, binding]) => [id, {
      id, name: binding.name, symbolKey: binding.symbolKey, uri: binding.uri, declaration: binding.declaration,
      properties: Object.fromEntries(Object.entries(binding.properties).map(([key, property]) => [key, {
        dynamic: !!property.dynamic, span: {start: property.expression.start, end: property.expression.end},
        capability: property.dynamic ? 'navigate' : 'edit'
      }])),
      collections: Object.fromEntries(Object.entries(binding.collections ?? {}).map(([key, collection]) => [key, {
        capability: collection.dynamic ? 'navigate' : 'edit', reason: collection.reason,
        spans: collection.entries.map(entry => ({start: entry.statement.start, end: entry.statement.end}))
      }])),
      events: Object.fromEntries(Object.entries(binding.events).map(([key, event]) => [key, {
        capability: event.capability, reason: event.reason, subscriptions: event.subscriptions.map(subscription => ({
          handler: subscription.handler, protected: subscription.protected, location: subscription.location,
          span: {start: subscription.expression.start, end: subscription.expression.end}
        }))
      }]))
    }]))};
}

/** Source method descriptors for delegate-signature filtering in the Events inspector. */
export function sourceHandlerCandidates(analysis) {
  const owner = analysis.ownership.className;
  const staticConstruction = analysis.method.modifiers?.includes('static');
  return analysis.context.methods.map(candidate => {
    const method = candidate.method;
    const sameOwner = ownerName(candidate.owner) === owner;
    const isStatic = method.modifiers?.includes('static');
    const accessible = (sameOwner || method.modifiers?.includes('public')) && (!staticConstruction || isStatic);
    return {name: sameOwner ? method.name : ownerName(candidate.owner) + '.' + method.name,
      className: ownerName(candidate.owner), methodName: method.name,
      parameters: method.parameters.map(parameter => canonicalType(parameter.type)),
      returnType: canonicalType(method.returnType ?? 'void'), accessible: !!accessible,
      uri: method.uri, start: method.nameSpan?.start ?? method.start, end: method.nameSpan?.end ?? method.end};
  });
}
