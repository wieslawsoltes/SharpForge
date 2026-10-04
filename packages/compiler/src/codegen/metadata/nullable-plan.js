/** Plans Nullable/NullableContext attributes before Param rows are allocated (SF-A02-T05.3, SF-A02-T29). */
import { NullableAnnotation, TypeKind } from '../../symbols/types.js';
import { compactNullableFlags, encodeNullableFlags, nullableContextFlag } from '../../nullable/metadata-flags.js';
import { nullableConstraintType, nullableMethodSignature, nullableTypeParameterFlag, nullableTypeUse } from './nullable-signatures.js';

const compact = type => type ? compactNullableFlags(encodeNullableFlags(type)) : [];
const scope = (owner, kind) => ({ owner, kind, children: [], entries: [], context: null, contextAttribute: null });
const entry = (scope, target, flags) => {
  const result = { ...target, flags };
  if (flags.length) scope.entries.push(result);
  return result;
};

/**
 * Every nullable type use is encoded once. Scope compression counts scalar transforms and child contexts, then
 * removes attributes equal to the inherited context. Mixed vectors remain explicit and never vote byte-by-byte.
 */
export class NullableMetadataPlan {
  constructor(writer, analysis) {
    this.writer = writer;
    this.analysis = analysis;
    this.scopes = new Map();
    this.roots = [];
    this.returns = new Map();
    this.uriByRoot = new Map(analysis.files.map(file => [file.syntax, file.source.uri]));
    for (const type of writer.types) this.scopes.set(type, scope(type, 'type'));
    for (const type of writer.types) {
      const current = this.scopes.get(type), parent = this.scopes.get(type.containingType);
      (parent ? parent.children : this.roots).push(current);
      this.typeEntries(type, current);
    }
    for (const root of this.roots) this.chooseContexts(root);
    for (const root of this.roots) this.finishContexts(root, 0);
  }
  /** Whether a return Param row is required for an explicit NullableAttribute. */
  needsReturn(method) {
    return !!this.returns.get(method)?.flags?.length;
  }
  annotationsEnabled(parameter) {
    const syntax = parameter.primaryConstraintSyntax ?? parameter.syntax;
    let root = syntax;
    while (root?.parent) root = root.parent;
    const location = parameter.locations?.[0];
    const uri = this.uriByRoot.get(root) ?? location?.uri;
    const position = syntax?.spanStart ?? syntax?.span?.start ?? location?.start ?? 0;
    return !!this.analysis.nullableAt(uri, position).annotations;
  }
  typeEntries(type, current) {
    const plan = this.writer.plans.get(type), core = this.writer.core;
    const events = new Map(), eventFields = new Map();
    for (const planned of plan.events) {
      events.set(planned.adder, planned.symbol);
      events.set(planned.remover, planned.symbol);
      eventFields.set(planned.symbol.name, planned.symbol);
    }
    if (type.typeKind !== TypeKind.Interface && type.baseType) {
      const base = type.baseSyntax?.typeWithAnnotations ?? nullableTypeUse(type.baseType, core);
      entry(current, { kind: 'base', type }, compact(base.withAnnotation(NullableAnnotation.Oblivious)));
    }
    for (const implemented of [...(type.interfaces ?? []), ...(plan.interfaces ?? [])]) {
      const use = type.interfaceSyntax?.get(implemented)?.typeWithAnnotations ?? nullableTypeUse(implemented, core);
      entry(current, { kind: 'interface', type, interface: implemented }, compact(use.withAnnotation(NullableAnnotation.Oblivious)));
    }
    for (const field of plan.fields) {
      const use = field.symbol?.typeWithAnnotations ?? eventFields.get(field.name)?.typeWithAnnotations ?? nullableTypeUse(field.type, core);
      entry(current, { kind: 'field', field }, compact(use));
    }
    for (const { symbol } of plan.properties) entry(current, { kind: 'property', symbol }, compact(symbol.typeWithAnnotations));
    for (const { symbol } of plan.events) entry(current, { kind: 'event', symbol }, compact(symbol.typeWithAnnotations));
    this.typeParameters(current, this.writer.allTypeParameters(type));
    for (const method of plan.methods) this.methodEntries(type, method, current, events);
  }
  methodEntries(type, method, parent, events) {
    const current = scope(method, 'method');
    this.scopes.set(method, current);
    parent.children.push(current);
    const signature = nullableMethodSignature(type, method, events, this.writer.core);
    const returned = entry(current, { kind: 'return', method }, compact(signature.returned));
    this.returns.set(method, returned);
    signature.parameters.forEach((parameter, index) => entry(current, { kind: 'parameter', method, index }, compact(parameter)));
    this.typeParameters(current, method.symbol?.typeParameters ?? method.typeParameters ?? []);
  }
  typeParameters(current, parameters) {
    for (const parameter of parameters) {
      entry(current, { kind: 'genericParameter', symbol: parameter }, [nullableTypeParameterFlag(parameter, this.annotationsEnabled(parameter))]);
      for (const constraint of parameter.constraintTypes ?? []) {
        const type = constraint.type ?? constraint;
        if (type.specialType === 'System_Object') continue;
        const use = nullableConstraintType(parameter, constraint);
        entry(current, { kind: 'constraint', symbol: parameter, type }, compact(use));
      }
    }
  }
  chooseContexts(current) {
    const candidates = current.entries.filter(item => item.flags.length === 1).map(item => item.flags);
    for (const child of current.children) {
      this.chooseContexts(child);
      if (child.context !== null) candidates.push([child.context]);
    }
    current.context = candidates.length ? nullableContextFlag(candidates) : null;
  }
  finishContexts(current, inherited) {
    current.context ??= inherited;
    if (current.context !== inherited) current.contextAttribute = current.context;
    for (const item of current.entries) {
      if (item.flags.length === 1 && item.flags[0] === current.context) item.flags = [];
    }
    for (const child of current.children) this.finishContexts(child, current.context);
  }
}
