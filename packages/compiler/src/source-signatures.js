import {MethodKind} from './symbols/members.js';
import {delegateInvoke} from './overload/type-inference.js';
import {isValidReceiverConversion} from './overload/extension-methods.js';

const definition = method => method?.originalDefinition ?? method;

function canInvoke(method, invocation) {
  const group = invocation.target;
  if (method.methodKind === MethodKind.LocalFunction) return true;
  if (method.isStatic) return group.viaType || group.implicitReceiver;
  return !group.viaType && !(group.implicitReceiver &&
    (invocation.isStatic || invocation.instanceInitializer || group.outer));
}

function extensionCandidates(invocation, analysis) {
  const group = invocation.target;
  const selected = invocation.result.isExtension ? invocation.result.method : null;
  if (selected) {
    const scope = group.extensionScopes?.find(entry => entry.methods.some(method => definition(method) === definition(selected)));
    return (scope?.methods ?? [selected]).filter(method => method === selected ||
      isValidReceiverConversion(analysis.conversions, group.receiver, method.parameters[0].type));
  }
  for (const scope of group.extensionScopes ?? []) {
    const methods = scope.methods.filter(method => method.parameters[0] &&
      isValidReceiverConversion(analysis.conversions, group.receiver, method.parameters[0].type));
    if (methods.length) return methods;
  }
  return [];
}

function candidates(invocation, analysis) {
  const group = invocation.target;
  if (group.hasErrors) return [];
  if (group.kind !== 'MethodGroup') {
    const invoke = delegateInvoke(group.type);
    return invoke ? [{method: invoke, reduced: false}] : [];
  }
  const reduced = Boolean(invocation.result.isExtension || group.isExtensionOnly);
  const methods = reduced ? extensionCandidates(invocation, analysis) : group.methods.filter(method => canInvoke(method, invocation));
  const selected = invocation.result.method;
  const result = [];
  const seen = new Set();
  for (let method of methods) {
    if (selected && definition(method) === definition(selected)) method = selected;
    else if (group.typeArguments) {
      if (method.arity !== group.typeArguments.length) continue;
      method = method.construct(group.typeArguments);
    }
    const original = definition(method);
    if (seen.has(original)) continue;
    seen.add(original);
    result.push({method, reduced});
  }
  return result;
}

function activeParameter(invocation, entry, argumentIndex) {
  const offset = entry.reduced ? 1 : 0;
  const parameters = entry.method.parameters.slice(offset);
  const named = invocation.syntax.argumentList.arguments[argumentIndex]?.nameColon?.name.identifier.valueText;
  if (named) {
    const index = parameters.findIndex(parameter => ((parameter.originalDefinition ?? parameter).callerName ?? parameter.name) === named);
    if (index >= 0) return index;
  }
  if (definition(entry.method) === definition(invocation.result.method)) {
    const mapped = invocation.result.mapping?.parameterOf?.[argumentIndex + offset];
    if (mapped !== undefined) return mapped - offset;
  }
  return parameters.at(-1)?.isParams ? Math.min(argumentIndex, parameters.length - 1) : argumentIndex;
}

function signature(entry, invocation, argumentIndex) {
  const method = entry.method;
  const parameters = method.parameters.slice(entry.reduced ? 1 : 0).map(parameter => ({label: parameter.toDisplayString()}));
  const owner = method.methodKind === MethodKind.LocalFunction ? '' : method.containingType?.toDisplayString();
  const generic = method.arity ? `<${method.typeArguments.map(type => type.toDisplayString()).join(', ')}>` : '';
  const name = `${owner ? owner + '.' : ''}${method.name}${generic}`;
  const label = `${method.returnTypeWithAnnotations.toDisplayString()} ${name}(${parameters.map(parameter => parameter.label).join(', ')})`;
  const active = activeParameter(invocation, entry, argumentIndex);
  return {label, parameters, ...(active === argumentIndex ? {} : {activeParameter: active})};
}

/** Revision-local interval index over the binder's actual invocation candidates, including recovery syntax. */
export class SourceSignatureIndex {
  constructor(analysis) {
    this.analysis = analysis;
    this.byUri = new Map();
    for (const invocation of analysis.invocations.values()) {
      const list = invocation.syntax.argumentList;
      if (!list?.openParenToken || list.openParenToken.isMissing) continue;
      if (!this.byUri.has(invocation.uri)) this.byUri.set(invocation.uri, {entries: [], starts: new Map()});
      const value = this.byUri.get(invocation.uri);
      const entry = {start: list.openParenToken.span.start, end: list.closeParenToken.span.start, invocation, parent: null};
      value.entries.push(entry);
      value.starts.set(entry.start, entry);
    }
    for (const value of this.byUri.values()) {
      value.entries.sort((left, right) => left.start - right.start);
      const stack = [];
      for (const entry of value.entries) {
        while (stack.length && stack.at(-1).end <= entry.start) stack.pop();
        entry.parent = stack.at(-1) ?? null;
        stack.push(entry);
      }
    }
  }

  at(uri, offset, callStart) {
    const value = this.byUri.get(uri);
    if (!value) return null;
    if (callStart !== undefined) {
      const entry = value.starts.get(callStart);
      return entry && entry.start < offset && offset <= entry.end ? entry : null;
    }
    const entries = value.entries;
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (entries[middle].start < offset) low = middle + 1;
      else high = middle;
    }
    let entry = entries[low - 1];
    while (entry && entry.end < offset) entry = entry.parent;
    return entry ?? null;
  }

  help(uri, offset, {callStart, activeParameter: suppliedIndex} = {}) {
    const entry = this.at(uri, offset, callStart);
    if (!entry) return null;
    const invocation = entry.invocation;
    const methods = candidates(invocation, this.analysis);
    if (!methods.length) return null;
    const argumentIndex = suppliedIndex ?? invocation.syntax.argumentList.separators(1).filter(token => token.span.start < offset).length;
    let activeSignature = methods.findIndex(value => definition(value.method) === definition(invocation.result.method));
    if (activeSignature < 0) activeSignature = Math.max(0, methods.findIndex(value =>
      value.method.parameters.length - (value.reduced ? 1 : 0) > argumentIndex || value.method.parameters.at(-1)?.isParams));
    const signatures = methods.map(method => signature(method, invocation, argumentIndex));
    return {activeSignature, activeParameter: activeParameter(invocation, methods[activeSignature], argumentIndex), signatures};
  }
}
