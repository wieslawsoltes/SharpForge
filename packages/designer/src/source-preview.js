import {canonicalType, frameworkType} from '@sharpforge/framework';
import {childSlot, validateDesign} from './model.js';
import {failSource} from './source-errors.js';
import {hasSourceConstructorEvidence} from './source-constructor-preview.js';

const inheritanceErrors = Object.freeze({
  SF1014: 'Only the IDisposable interface is supported by this class profile',
  SF2200: 'The program is valid C# but is not executable on this runtime profile: it uses class inheritance'
});

/** This exact runtime-profile exception grants no compilation or source-writing capability. */
export function designInheritancePreviewProfile(diagnostics) {
  if (!Array.isArray(diagnostics)) return false;
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  return Object.keys(inheritanceErrors).every(code => errors.some(diagnostic => diagnostic.code === code))
    && errors.every(diagnostic => inheritanceErrors[diagnostic.code] === diagnostic.message);
}

function importsOf(declaration) {
  const scopes = [];
  for (let scope = declaration; scope; scope = scope.parent) scopes.unshift(scope);
  const aliases = new Map();
  const imports = new Set();
  for (const scope of scopes) {
    for (const directive of scope.usings ?? []) {
      const name = directive.namespaceOrType?.toString().trim().replace(/^global::/, '');
      if (directive.alias) aliases.set(directive.alias.name.toString().trim(), name);
      else if (!directive.staticKeyword?.text) imports.add(name);
    }
  }
  return {aliases, imports};
}

function directFrameworkBase(type, declaration, owner, context) {
  const text = type.toString().trim();
  const scope = importsOf(declaration);
  const qualified = text.startsWith('global::');
  const spelling = text.replace(/^global::/, '');
  const [head, ...tail] = spelling.split('.');
  const aliased = scope.aliases.has(head);
  const name = aliased ? [scope.aliases.get(head), ...tail].join('.') : spelling;
  const sourceTypes = new Set(context.parsedFiles.flatMap(parsed => parsed.root.members.filter(member => member.kind === 'Class')
    .map(member => [member.namespace, member.name].filter(Boolean).join('.'))));
  if (!qualified && !aliased) {
    const namespace = owner.namespace?.split('.') ?? [];
    while (namespace.length) {
      if (sourceTypes.has([...namespace, spelling].join('.'))) return null;
      namespace.pop();
    }
    if (sourceTypes.has(spelling)) return null;
  }
  const candidates = new Set([name, ...[...scope.imports].map(prefix => prefix + '.' + name)]
    .filter(candidate => frameworkType(candidate)?.name === candidate));
  return candidates.size === 1 ? [...candidates][0] : null;
}

/** Attaches a direct framework base to an actual instance-root assignment, including sibling partial declarations. */
export function sourceRootBaseEvidence(context, assignment) {
  const owner = context.chosen.owner;
  if (!owner) return null;
  const declarations = context.parsedFiles.flatMap(parsed => parsed.root.members
    .filter(member => member.kind === 'Class' && member.name === owner.name && member.namespace === owner.namespace)
    .map(member => ({owner: member, parsed})));
  const evidence = [];
  for (const declaration of declarations) {
    const syntax = declaration.parsed.syntax.findNode(declaration.owner.start, declaration.owner.end);
    const bases = syntax.baseList?.types ?? [];
    if (!bases.length) continue;
    if (bases.length !== 1) return null;
    const baseType = directFrameworkBase(bases[0].type, syntax, declaration.owner, context);
    const slot = childSlot(baseType);
    if (!['control', 'window'].includes(frameworkType(baseType)?.kind) || slot?.many || slot?.property !== assignment.property) return null;
    evidence.push({baseType, baseUri: declaration.parsed.source.uri, baseSpan: {...bases[0].type.span}});
  }
  return evidence.length && evidence.every(item => item.baseType === evidence[0].baseType) ? evidence[0] : null;
}

function unavailable(reason) {
  return {previewAvailable: false, readOnly: true, sourceWrites: false, reason};
}

/** A closed, typed component body may be inspected while class inheritance remains an executable-profile error. */
export function designPreviewCapability(analysis) {
  if (!analysis || analysis.compilationSucceeded !== false) return unavailable('This capability applies only to a blocked inheritance profile.');
  const diagnostics = analysis.compilerDiagnostics ?? analysis.diagnostics;
  if (!designInheritancePreviewProfile(diagnostics)) return unavailable('The source has errors beyond the supported inheritance preview profile.');
  const ownership = analysis.ownership;
  const assignment = ownership?.rootAssignment;
  const document = analysis.document;
  if (!analysis.structuralEditable || !document?.nodes?.length || document.previewOnly) {
    return unavailable('Preview requires a closed construction containing only owned, typed statements.');
  }
  if (ownership?.methodName === '.ctor' && !hasSourceConstructorEvidence(analysis)) {
    return unavailable('A constructor preview requires a parameterless instance body without chained calls or field, property, or static initialization.');
  }
  if (!assignment || assignment.receiver !== 'this' || assignment.owner !== ownership.className
    || assignment.methodName !== ownership.methodName || assignment.childId !== document.root || assignment.uri !== analysis.uri) {
    return unavailable('The selected construction does not prove an instance Content or Child assignment.');
  }
  const slot = childSlot(assignment.baseType);
  if (!assignment.baseType || !slot || slot.many || slot.property !== assignment.property) {
    return unavailable('A direct registered framework base with the assigned content property is required.');
  }
  const root = document.nodes.find(node => node.id === document.root);
  if (!root || frameworkType(root.type)?.kind === 'window' || document.nodes.some(node => node.projectType)) {
    return unavailable('Nested project controls require their own qualified preview before composition.');
  }
  const descriptor = {type: ownership.className, baseType: assignment.baseType, uri: analysis.uri,
    displayName: ownership.className.split('.').at(-1), previewOnly: true, readOnly: true, compilationSucceeded: false,
    rootAssignment: structuredClone(assignment)};
  return {previewAvailable: true, kind: 'component', readOnly: true, sourceWrites: false, descriptor,
    reason: 'Class inheritance is not executable on this runtime profile. The owned component body is available as a read-only preview.'};
}

/** Creates a separate preview host; its synthetic node can never be submitted to the C# source planner. */
export function wrapDesignPreviewRoot(analysis, descriptor = designPreviewCapability(analysis).descriptor) {
  const capability = designPreviewCapability(analysis);
  if (!capability.previewAvailable) failSource(capability.reason, null, 'SFSYNC_OWNERSHIP');
  if (!descriptor || descriptor.type !== capability.descriptor.type
    || canonicalType(descriptor.baseType) !== capability.descriptor.baseType
    || descriptor.uri !== undefined && descriptor.uri !== capability.descriptor.uri) {
    failSource('The preview descriptor does not match the source-proven component owner.', null, 'SFSYNC_OWNERSHIP');
  }
  const document = structuredClone(analysis.document);
  const ids = new Set(document.nodes.map(node => node.id));
  let previewRootId = '__preview_root';
  let suffix = 1;
  while (ids.has(previewRootId)) previewRootId = '__preview_root_' + suffix++;
  const sourceRootId = document.root;
  document.nodes.unshift({id: previewRootId, type: capability.descriptor.baseType,
    properties: {}, children: [sourceRootId], events: {}});
  document.root = previewRootId;
  document.previewOnly = true;
  return {document: validateDesign(document), sourceRootId, previewRootId, readOnly: true, sourceWrites: false};
}
