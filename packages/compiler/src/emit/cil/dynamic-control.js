/** Dynamic enumeration and resource conversion composed with the existing control-flow emitters (SF-A02-T55). */
import { isDynamicType } from './dynamic-arguments.js';

/** Class mixin: runtime conversions at foreach/using boundaries, with the existing disposal and exception regions. */
export const DynamicControlEmission = Base =>
  class extends Base {
    stmtForEach(node) {
      if (!isDynamicType(node.collection?.type)) return super.stmtForEach(node);
      if (!node.local || node.isAwait) return this.unsupported('this dynamic foreach form', node.syntax);
      const collection = { kind: 'DynamicEnumerable', type: this.core.ienumerable };
      this.substitutions.set(collection, { value: () => this.dynamicSite(node, 'enumerable') });
      try {
        return this.forEachEnumerator({ ...node, collection, dynamicIteration: node });
      } finally {
        this.substitutions.delete(collection);
      }
    }
    iterationValue(node, elementType) {
      const original = node.dynamicIteration;
      if (!original) return super.iterationValue(node, elementType);
      if (this.program.dynamicSites.of(original, 'element')) {
        const slot = this.temp(this.core.object);
        this.il.emit('stloc', slot);
        this.dynamicSite(original, 'element', [() => this.il.emit('ldloc', slot)]);
      }
      this.initializeLocal(node.local);
    }
    stmtUsing(node) {
      if (Array.isArray(node.resources)) {
        if (!node.resources.some(resource => isDynamicType(resource.local?.type))) return super.stmtUsing(node);
        return this.dynamicResources(node.resources, 0, () => this.statement(node.body), node);
      }
      if (!isDynamicType(node.resources?.type)) return super.stmtUsing(node);
      const type = node.isAwait ? this.core.iasyncDisposable : this.core.idisposable;
      const slot = this.temp(type);
      this.dynamicSite(node, 'dispose');
      this.il.emit('stloc', slot);
      return this.disposeAround([{ slot, type }], () => this.statement(node.body), node);
    }
    usingDeclaration(node, statements, next) {
      if (!node.declarations.some(resource => isDynamicType(resource.local?.type))) return super.usingDeclaration(node, statements, next);
      return this.dynamicResources(node.declarations, 0, () => this.statementsFrom(statements, next), node);
    }
    /** Acquire each resource inside the previous one's try, so later acquisition failures still dispose earlier ones. */
    dynamicResources(resources, index, emitBody, statement) {
      if (index === resources.length) return emitBody();
      const resource = resources[index];
      this.declare(resource.local, resource.value);
      let type = resource.local.type;
      let slot = this.resourceSlot(resource.local);
      if (isDynamicType(type)) {
        type = statement.isAwait ? this.core.iasyncDisposable : this.core.idisposable;
        slot = this.temp(type);
        this.dynamicSite(resource, 'dispose');
        this.il.emit('stloc', slot);
      }
      return this.disposeAround([{ slot, type }], () => this.dynamicResources(resources, index + 1, emitBody, statement), statement);
    }
  };
