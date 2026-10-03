import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';

const baseControl = 'Microsoft.UI.Xaml.Controls.UserControl';
const qualifiedName = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*$/;

function previewEvidence(descriptor) {
  const evidence = descriptor.rootAssignment;
  const span = value => value && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) &&
    value.start >= 0 && value.end >= value.start && value.end <= 16_000_000;
  if (descriptor.readOnly !== true || descriptor.compilationSucceeded !== false || !descriptor.uri || !evidence ||
      evidence.receiver !== 'this' || !['Content', 'Child'].includes(evidence.property) || evidence.owner !== descriptor.type ||
      evidence.uri !== descriptor.uri || evidence.baseType !== baseControl || !span(evidence.span) || !span(evidence.baseSpan) ||
      typeof evidence.childId !== 'string' || evidence.childId.length > 128 || typeof evidence.methodName !== 'string' ||
      evidence.methodName.length > 256 || typeof evidence.baseUri !== 'string' || evidence.baseUri.length > 4096 ||
      !Array.isArray(evidence.capabilities) || !evidence.capabilities.includes('preview') ||
      evidence.capabilities.some(value => !['preview', 'navigate'].includes(value))) {
    throw new TypeError('Preview-only controls require explicit read-only source ownership evidence');
  }
  return {
    receiver: 'this', property: evidence.property, childId: evidence.childId, uri: evidence.uri,
    owner: evidence.owner, methodName: evidence.methodName, baseType: baseControl, baseUri: evidence.baseUri,
    span: {start: evidence.span.start, end: evidence.span.end}, baseSpan: {start: evidence.baseSpan.start, end: evidence.baseSpan.end},
    capabilities: [...new Set(evidence.capabilities)]
  };
}

/** Checks the serializable, non-executing descriptor used by project toolbox items. */
export function validateProjectControl(descriptor) {
  if (!descriptor || typeof descriptor.type !== 'string' || !qualifiedName.test(descriptor.type)) {
    throw new TypeError('Project control type must be a qualified C# identifier');
  }
  if (descriptor.type.length > 512 || descriptor.baseType !== baseControl) {
    throw new TypeError('Project controls require a supported UserControl preview base');
  }
  if (descriptor.uri !== undefined && (typeof descriptor.uri !== 'string' || descriptor.uri.length > 4096)) {
    throw new TypeError('Project control source URI is invalid');
  }
  if (descriptor.displayName !== undefined && (typeof descriptor.displayName !== 'string' || descriptor.displayName.length > 128) ||
      descriptor.analysisVersion !== undefined && (!Number.isSafeInteger(descriptor.analysisVersion) || descriptor.analysisVersion < 0)) {
    throw new TypeError('Project control display name or analysis version is invalid');
  }
  if (descriptor.previewOnly !== undefined && typeof descriptor.previewOnly !== 'boolean' ||
      descriptor.previewOnly !== true && (descriptor.readOnly === true || descriptor.compilationSucceeded === false)) {
    throw new TypeError('Read-only project metadata must retain its explicit preview-only marker');
  }
  return {
    type: descriptor.type,
    baseType: baseControl,
    displayName: descriptor.displayName || descriptor.type.split('.').at(-1),
    ...(descriptor.uri ? {uri: descriptor.uri} : {}),
    ...(descriptor.analysisVersion !== undefined ? {analysisVersion: descriptor.analysisVersion} : {}),
    ...(descriptor.previewOnly === true ? {previewOnly: true, readOnly: true, compilationSucceeded: false,
      rootAssignment: previewEvidence(descriptor)} : {})
  };
}

function usingScope(node, inherited) {
  const imports = new Set(inherited.imports);
  const aliases = new Map(inherited.aliases);
  for (const directive of node.usings ?? []) {
    const name = directive.namespaceOrType?.toString().trim().replace(/^global::/, '');
    if (directive.alias) aliases.set(directive.alias.name.toString().trim(), name);
    else if (!directive.staticKeyword?.text) imports.add(name);
  }
  return {imports, aliases};
}

function declarations(files) {
  const types = [];
  let totalBytes = 0;
  if (files.length > 256) throw new RangeError('Project toolbox file count exceeds 256');
  for (const file of files) {
    if (typeof file.text !== 'string') throw new TypeError('Project toolbox source text is required');
    totalBytes += file.text.length;
    if (totalBytes > 8_000_000) throw new RangeError('Project toolbox source limit exceeded');
    const syntax = parse(new SourceText(file.text, file.uri ?? file.path ?? 'Project.cs')).syntax;
    const pending = [{node: syntax, namespace: '', imports: new Set(), aliases: new Map()}];
    while (pending.length) {
      const current = pending.pop();
      const scope = usingScope(current.node, current);
      for (const member of current.node.members ?? []) {
        if (['NamespaceDeclaration', 'FileScopedNamespaceDeclaration'].includes(member.kind)) {
          const name = member.name.toString().trim();
          pending.push({node: member, namespace: [current.namespace, name].filter(Boolean).join('.'), ...scope});
        } else if (member.kind === 'ClassDeclaration') {
          const modifiers = member.modifiers.map(token => token.valueText ?? token.text);
          if (modifiers.includes('abstract') || modifiers.includes('static') || member.typeParameterList) continue;
          const name = member.identifier.valueText;
          const type = [current.namespace, name].filter(Boolean).join('.');
          const bases = (member.baseList?.types ?? []).map(base => base.type.toString().trim().replace(/^global::/, ''));
          types.push({type, bases, namespace: current.namespace, ...scope, uri: file.uri ?? file.path});
        }
      }
    }
  }
  return types;
}

/**
 * Enumerate direct UserControl declarations for worker-side named-class analysis. Candidates
 * make no compilation or preview support claim; a separate capability analysis must qualify them.
 */
export function projectControlCandidates(files) {
  if (!Array.isArray(files)) throw new TypeError('Project control source files are required');
  const candidates = new Map();
  for (const declaration of declarations(files)) {
    const direct = declaration.bases.some(base => {
      const name = declaration.aliases.get(base) ?? base;
      return name === baseControl || name === 'UserControl' && declaration.imports.has('Microsoft.UI.Xaml.Controls');
    });
    if (direct) candidates.set(declaration.type + '\0' + declaration.uri, {type: declaration.type, uri: declaration.uri});
  }
  if (candidates.size > 512) throw new RangeError('Project control catalog exceeds 512 items');
  return [...candidates.values()].sort((left, right) => left.type.localeCompare(right.type) || String(left.uri).localeCompare(String(right.uri)));
}

/** Accept only worker-qualified inheritance previews; a failed build always remains failed. */
export function discoverPreviewProjectControls({success, previewAvailable, projectTypes, version = 0}) {
  if (success !== false || previewAvailable !== true) return [];
  if (!Array.isArray(projectTypes) || projectTypes.length > 512) throw new RangeError('Project preview catalog exceeds 512 items');
  const seen = new Set();
  return projectTypes.map(descriptor => {
    if (descriptor.previewOnly !== true || seen.has(descriptor.type)) {
      throw new TypeError('Project preview controls require unique explicitly preview-only descriptors');
    }
    seen.add(descriptor.type);
    return validateProjectControl({...descriptor, analysisVersion: version});
  }).sort((left, right) => left.type.localeCompare(right.type));
}

/** Discovers constructible UserControls only from a successful compilation snapshot. */
export function discoverProjectControls({success, files = [], projectTypes, version = 0}) {
  if (!success) return [];
  if (projectTypes) {
    if (!Array.isArray(projectTypes) || projectTypes.length > 512) throw new RangeError('Project control catalog exceeds 512 items');
    if (projectTypes.some(descriptor => descriptor.previewOnly === true || descriptor.compilationSucceeded === false)) {
      throw new TypeError('A successful compilation catalog cannot contain preview-only controls');
    }
    return projectTypes.map(value => validateProjectControl({...value, analysisVersion: version}));
  }
  const types = declarations(files);
  const byName = new Map(types.map(type => [type.type, type]));
  const resolved = new Map();
  const visiting = new Set();
  const resolvesToControl = (type, depth = 0) => {
    if (resolved.has(type.type)) return resolved.get(type.type);
    if (depth > 100 || visiting.has(type.type)) throw new TypeError('Project control inheritance is cyclic or too deep');
    visiting.add(type.type);
    const matches = type.bases.some(base => {
      const name = type.aliases.get(base) ?? base;
      if (name === baseControl || name === 'UserControl' && type.imports.has('Microsoft.UI.Xaml.Controls')) return true;
      const target = byName.get(name) ?? byName.get([type.namespace, name].filter(Boolean).join('.')) ??
        [...type.imports].map(prefix => byName.get(prefix + '.' + name)).find(Boolean);
      return target ? resolvesToControl(target, depth + 1) : false;
    });
    visiting.delete(type.type);
    resolved.set(type.type, matches);
    return matches;
  };
  return types.filter(type => resolvesToControl(type)).map(type => validateProjectControl({
    type: type.type, baseType: baseControl, uri: type.uri, analysisVersion: version
  })).sort((left, right) => left.type.localeCompare(right.type));
}
