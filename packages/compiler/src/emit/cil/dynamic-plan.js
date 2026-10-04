/** Static CallSite<T> storage declared before metadata tokens are allocated (SF-A02-T55). */
import { FieldAttributes } from '@sharpforge/cil';
import { walk } from '../../bound/semantic-walker.js';
import { MethodKind } from '../../symbols/members.js';
import { SymbolKind } from '../../symbols/types.js';
import { SynthesizedTypes } from './synthesized-types.js';
import { DynamicRuntime } from './dynamic-runtime.js';
import { dynamicOperations, dynamicStore } from './dynamic-operations.js';
import { dynamicArgument, dynamicAssignmentValue, isDynamicLocation } from './dynamic-arguments.js';
import { dynamicDelegate } from './dynamic-delegates.js';
import { dynamicControlOperations } from './dynamic-control-operations.js';
import { UnsupportedInCil } from './unsupported.js';

export class DynamicSitePlan extends SynthesizedTypes {
  constructor(analysis) {
    super(analysis.core);
    this.analysis = analysis;
    this.sites = new Map();
    this.runtime = null;
    this.containerOrdinal = 0;
    this.delegateOrdinal = 0;
  }
  /** A planned call site for an expression and its use, or null for a statically bound expression. */
  of(node, mode = 'value') {
    return this.sites.get(node)?.get(mode) ?? null;
  }
  planRoot(root, context) {
    let container = null;
    const seen = new Set();
    const visit = node => {
      if (seen.has(node)) return false;
      seen.add(node);
      if (node.kind === 'Lambda' || node.kind === 'LocalFunction') return false;
      const descriptions = [...dynamicOperations(node, this.core, context), ...dynamicControlOperations(node, this.core)];
      for (const initializer of node.initializers ?? []) {
        if (isDynamicLocation(initializer.target) && initializer.value?.kind !== 'ObjectInitializer') {
          const value = dynamicArgument(dynamicAssignmentValue(initializer.value), this.core);
          descriptions.push(['initializer', { ...dynamicStore(initializer.target, value, this.core), key: initializer }]);
        }
      }
      for (const [mode, description] of descriptions) {
        const key = description.key ?? node;
        if (this.of(key, mode)) continue;
        if (['UnaryOperation', 'BinaryOperation'].includes(description.operation) && description.operator === undefined)
          throw new UnsupportedInCil(`the dynamic operator '${node.operator}'`, node.syntax, context.uri);
        this.runtime ??= new DynamicRuntime(this.analysis, { syntax: node.syntax, uri: context.uri });
        this.runtime.factory(description.operation);
        container ??= this.nestedClass(context.owner, `<>DynamicSites${this.containerOrdinal++}`, {
          typeParameters: context.typeParameters, hasDefaultConstructor: false,
        });
        const delegate = dynamicDelegate(this, description, context);
        const siteType = this.runtime.genericCallSite.construct(delegate.type);
        const fields = this.additionsTo(container.definition).fields;
        const field = this.field(container.definition, '<>p__' + fields.length, siteType, FieldAttributes.Public | FieldAttributes.Static);
        const site = { ...description, delegate, field, siteType, container, contextType: context.owner, runtime: this.runtime };
        let variants = this.sites.get(key);
        if (!variants) this.sites.set(key, (variants = new Map()));
        variants.set(mode, site);
      }
      if (node.operation) walk(node.operation, visit);
      return true;
    };
    walk(root, visit);
  }
}

/** Plan each executable lexical scope separately, including initializers, lambdas and generic local functions. */
export function planDynamicSites(analysis, closures, topLevel) {
  const plan = new DynamicSitePlan(analysis);
  if (!analysis.hasDynamicExpressions) return plan;
  for (const [key, body] of analysis.bound) {
    if (topLevel && body === topLevel.body) {
      plan.planRoot(body, { owner: topLevel.type, isStatic: true, typeParameters: [], uri: topLevel.file.source.uri });
      continue;
    }
    if (!key?.containingType || key.methodKind === MethodKind.LocalFunction) continue;
    const context = {
      owner: key.containingType, isStatic: !!key.isStatic, typeParameters: key.kind === SymbolKind.Method ? key.typeParameters ?? [] : [],
      uri: key.uri ?? key.locations?.[0]?.uri ?? null,
    };
    plan.planRoot(body, context);
    if (key.initializerCall) plan.planRoot(key.initializerCall, context);
  }
  for (const functionPlan of closures.functions.values()) {
    plan.planRoot(functionPlan.body, {
      owner: functionPlan.owner, isStatic: functionPlan.isStatic, uri: functionPlan.uri,
      typeParameters: [...functionPlan.contextTypeParameters, ...(functionPlan.symbol?.typeParameters ?? [])],
    });
  }
  return plan;
}
