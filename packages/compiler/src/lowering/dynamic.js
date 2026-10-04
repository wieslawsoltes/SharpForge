/**
 * `dynamic` in code generation (SF-A02-T55).
 *
 * A value of type `dynamic` is an `object` in the image: declaring one, storing into it, converting it to `object`
 * and passing it on need nothing from the runtime and are generated like the same code over `object`.
 *
 * An operation on it is late bound: Roslyn emits a call site that asks Microsoft.CSharp.RuntimeBinder for the member,
 * overload, operator or conversion once the actual types are known. The runtime has no such binder and no type
 * information to bind with (no reflection over image classes, no type test on an `object`), so every dynamic
 * operation is SF2200 naming it; nothing is emitted for the program (bound/dynamic-operations.js says which nodes
 * are operations).
 */
import { TypeKind } from '../symbols/types.js';
import { dynamicOperation, dynamicOperationNames as operationNames } from '../bound/dynamic-operations.js';

export { dynamicOperation };

const isDynamic = type => type?.typeKind === TypeKind.Dynamic;

const describe = operation => `${operation} on a value of type 'dynamic' (the runtime has no late binder: Microsoft.CSharp.RuntimeBinder)`;

/** Class mixin: dynamic operations are reported, dynamic values are objects. */
export const DynamicLowering = Base =>
  class extends Base {
    expression(node) {
      const operation = node.hasErrors ? null : dynamicOperation(node);
      return operation ? this.unsupported(describe(operation), node.syntax) : super.expression(node);
    }
    effect(node) {
      const operation = node.hasErrors ? null : dynamicOperation(node);
      return operation ? this.unsupported(describe(operation), node.syntax) : super.effect(node);
    }
    stmtForEach(node) {
      if (isDynamic(node.collection?.type)) return this.unsupported(describe(operationNames.ForEach), node.collection.syntax);
      return super.stmtForEach(node);
    }
    stmtUsing(node) {
      // The resource is an expression or a declaration; a dynamic one is converted to IDisposable at run time.
      const resources = node.resources,
        locals = (resources?.declarators ?? []).map(declarator => declarator.local);
      if (isDynamic(resources?.type) || locals.some(local => isDynamic(local?.type)))
        return this.unsupported(describe(operationNames.Using), node.syntax.usingKeyword ?? node.syntax);
      return super.stmtUsing(node);
    }
  };
