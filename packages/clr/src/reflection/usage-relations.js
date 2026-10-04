import { RuntimeModule } from '../assembly.js';
import { LoadErrorCode } from '../load-errors.js';
import { UsageRelationBudget } from './usage-budget.js';
import { UsageMethodMetadata } from './usage-metadata.js';
import { UsageInterfaceMaps } from './usage-interface-maps.js';

const recoverable = new Set([LoadErrorCode.TypeLoad, LoadErrorCode.MissingAssembly, LoadErrorCode.UnsupportedFramework]);

class RelationCollector {
  entries = [];
  diagnostics = [];
  #diagnostics = new Set();
  #budget;
  #module;
  constructor(module, budget) { this.#module = module; this.#budget = budget; }

  add(relation, source, target, type, implementationKind) {
    this.#budget.work();
    if (source.module !== this.#module || target.module !== this.#module) return;
    if (this.entries.length >= this.#budget.maxRelations) this.#budget.exceeded('entries');
    this.entries.push(Object.freeze({ relation, sourceToken: source.metadataToken, targetToken: target.metadataToken,
      implementingTypeToken: type.metadataToken, implementationKind }));
  }

  failure(relation, token, error) {
    if (!recoverable.has(error.code)) throw error;
    this.#budget.check();
    const reason = error.message.slice(0, 1024);
    const identity = `${relation}:${token}:${error.code}:${reason}`;
    if (this.#diagnostics.has(identity)) return;
    if (this.diagnostics.length >= this.#budget.maxDiagnostics) this.#budget.exceeded('diagnostics');
    this.#diagnostics.add(identity);
    this.diagnostics.push(Object.freeze({ relation, token, code: error.code, reason }));
  }
}

async function overrides(module, metadata, budget, collector) {
  const methods = [];
  const roots = new Map();
  for (let rid = 1; rid <= module.rowCount(6); rid++) {
    budget.work();
    const method = module.methodDefinition(0x06000000 + rid);
    if (method.isStatic || !method.isVirtual || method.declaringType.isInterface) continue;
    try {
      const root = await metadata.root(method);
      methods.push(method);
      roots.set(method, root);
    } catch (error) { collector.failure('overridden-by', method.metadataToken, error); }
  }
  for (const method of methods) {
    budget.work();
    const root = roots.get(method);
    if (root === method) continue;
    try {
      const declaring = await metadata.load(method.declaringType);
      for (const ancestor of metadata.ancestry(declaring.baseType)) {
        const declaration = metadata.knownSlot(ancestor, root);
        if (declaration) collector.add('overridden-by', method, declaration, declaring, 'override');
      }
    } catch (error) { collector.failure('overridden-by', method.metadataToken, error); }
  }
}

async function implementations(module, metadata, budget, collector) {
  const maps = new UsageInterfaceMaps(metadata, budget);
  for (let rid = 2; rid <= module.rowCount(2); rid++) {
    budget.work();
    const definition = module.typeDefinition(0x02000000 + rid);
    if (definition.isInterface) continue;
    let type;
    try { type = await metadata.load(definition); }
    catch (error) { collector.failure('implemented-by', definition.metadataToken, error); continue; }
    for (const contract of type.interfaces) {
      budget.work();
      if (contract.module !== module) continue;
      try {
        const map = await maps.get(type, contract);
        for (const [declaration, entry] of map) {
          collector.add('implemented-by', entry.implementation, declaration, type, entry.implementationKind);
        }
      } catch (error) { collector.failure('implemented-by', type.metadataToken, error); }
    }
  }
}

/**
 * Build an owned local-module declaration snapshot for AssemblyUsageAnalysis, without reading method bodies.
 * Canonical CLR descriptors establish identities. Unsupported binding yields per-relation diagnostics;
 * malformed metadata, cancellation and budget exhaustion reject with the original stable loader error code.
 */
export async function createAssemblyMethodRelations(module, options = {}) {
  if (!(module instanceof RuntimeModule)) throw new TypeError('Expected RuntimeModule');
  const budget = new UsageRelationBudget(options);
  budget.include(module);
  const metadata = new UsageMethodMetadata(module.assembly.loadContext.types, budget);
  const collector = new RelationCollector(module, budget);
  await overrides(module, metadata, budget, collector);
  await implementations(module, metadata, budget, collector);
  budget.check();
  return Object.freeze({ format: 'sharpforge.method-relations', version: 1, moduleVersionId: module.moduleVersionId,
    methodCount: module.rowCount(6), typeCount: module.rowCount(2), entries: Object.freeze(collector.entries),
    diagnostics: Object.freeze(collector.diagnostics), storage: Object.freeze(budget.storage) });
}
