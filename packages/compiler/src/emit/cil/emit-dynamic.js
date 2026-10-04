/** Direct .NET dynamic emission; bytecode/browser execution retains its explicit unsupported diagnostic (SF-A02-T55). */
import { emitDynamicSite } from './dynamic-sites.js';
import { isDynamicType, isDynamicBinary, isDynamicConversion } from './dynamic-arguments.js';
import { DynamicMutationEmission } from './dynamic-mutations.js';
import { DynamicControlEmission } from './dynamic-control.js';
import { emitDynamicAwait } from './dynamic-await.js';
import { needsBox } from './type-facts.js';

/** Class mixin: late-bound calls and operations use the call sites planned before token allocation. */
export const DynamicEmission = Base =>
  class extends DynamicControlEmission(DynamicMutationEmission(Base)) {
    dynamicSite(node, mode = 'value', operands = null) {
      const site = this.program.dynamicSites.of(node, mode);
      if (!site) return this.unsupported(`an unplanned dynamic ${node.kind} operation`, node.syntax);
      return emitDynamicSite(this, site, operands);
    }
    exprDynamicInvocation(node, isUsed) {
      return this.dynamicSite(node, isUsed ? 'value' : 'effect');
    }
    exprDynamicMemberAccess(node) {
      return this.dynamicSite(node);
    }
    exprDynamicElementAccess(node) {
      return this.dynamicSite(node);
    }
    exprDynamicCondition(node) {
      return this.dynamicSite(node);
    }
    exprDynamicObjectCreation(node) {
      this.dynamicSite(node);
      if (node.initializers?.length || node.collectionInitializers?.length) this.objectInitializers(node);
    }
    exprConversion(node) {
      return isDynamicConversion(node) ? this.dynamicSite(node) : super.exprConversion(node);
    }
    exprUnary(node) {
      return isDynamicType(node.operand.type) ? this.dynamicSite(node) : super.exprUnary(node);
    }
    exprBinary(node) {
      if (!isDynamicBinary(node)) return super.exprBinary(node);
      return this.program.dynamicSites.of(node, 'test') ? this.dynamicShortCircuit(node) : this.dynamicSite(node);
    }
    dynamicShortCircuit(node) {
      const il = this.il;
      const type = node.left.type ?? this.core.object;
      const left = this.temp(type);
      const decided = il.newLabel();
      const end = il.newLabel();
      this.expression(node.left);
      il.emit('stloc', left);
      const pushLeft = () => il.emit('ldloc', left);
      this.dynamicSite(node, 'test', [pushLeft]);
      il.emit('brtrue', decided);
      this.dynamicSite(node, 'value', [pushLeft]);
      il.emit('br', end).mark(decided).emit('ldloc', left);
      if (needsBox(type)) il.emit('box', this.tokens.type(type));
      il.mark(end);
    }
    exprAwait(node, isUsed) {
      return node.isDynamic ? emitDynamicAwait(this, node, isUsed) : super.exprAwait(node, isUsed);
    }
  };
