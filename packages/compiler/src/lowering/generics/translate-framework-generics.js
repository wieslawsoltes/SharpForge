/**
 * Lowering of members of framework generics over type parameters and user types (SF-A02-T02).
 *
 * The binder binds `List<T>` and `List<Animal>` against the open members the registry bridge derives
 * (symbols/registry-open-members.js). An open member is not callable: the registry has contracts for closed
 * instantiations only. Here the containing type is closed under the construction being lowered and the member is
 * replaced by the contract of the registry instantiation that executes it:
 *
 *   List<T>.Add(T)        with T = int      ->  List<int>.Add(int)
 *   List<Animal>.Add      (not listed)      ->  List<object>.Add(object)      the construction over `object` is shared
 *   List<Animal>[i]                         ->  List<object>.get_Item(int), read through a temporary of type Animal
 *
 * Sharing is sound because the binder checked every argument against the open signature and the runtime's objects
 * carry no type arguments. Where it would not be - a result that is an array of the shared argument, sorting - or
 * where the registry has no instantiation to run the construction on, the program is refused (SF2200) with the
 * missing contract named.
 */
import { ArrayTypeSymbol, typeOf } from '../../symbols/types.js';
import { contractOfInstance } from '../../symbols/registry-open-members.js';
import { n } from '../../codegen/semantic/node-factory.js';

/** Members whose result depends on an ordering of the elements, which the construction over `object` does not have. */
const orderingMembers = new Set(['Sort']);

const definitionOf = member => member?.originalDefinition ?? member ?? null;
const isOpen = member => !!definitionOf(member)?.openContract;

/** Class mixin for the body translator. */
export const FrameworkGenericTranslation = Base =>
  class extends Base {
    /**
     * The contract that executes an open member of a framework generic.
     * @returns {null|{member:object, shared:boolean}} null for a member that is not an open framework member;
     *   `member` carries the contract, `shared` tells that its `object` positions stand for another type
     */
    closedFrameworkMember(member, syntax) {
      const definition = definitionOf(member);
      if (!definition?.openContract) return null;
      const owner = this.g.generics.closed(member.containingType, syntax),
        construction = this.g.frameworkConstructions.registryConstruction(owner);
      if (!construction) {
        const missing = this.g.frameworkConstructions.missingContract(owner) ?? owner.toDisplayString();
        return this.unsupported(`type '${owner.toDisplayString()}' (the framework registry has no '${missing}' contracts)`, syntax);
      }
      const target = contractOfInstance(this.g.bridge, definition, construction.type),
        shared = construction.erased ? this.sharedParameters(owner, construction.type) : null;
      if (!target) {
        const name = `${construction.type.toDisplayString()}.${definition.name}`;
        return this.unsupported(`'${name}' (not in the framework registry)`, syntax);
      }
      if (shared) this.checkSharedMember(definition, owner, shared, syntax);
      return { member: target, shared: !!shared && shared.includes(typeOf(definition.returnType)) };
    }
    /** The type parameters of a framework generic whose arguments are replaced by `object` in the shared construction. */
    sharedParameters(owner, registryType) {
      return owner.originalDefinition.typeParameters.filter((parameter, i) => {
        return !typeOf(owner.typeArguments[i]).equals(typeOf(registryType.typeArguments[i]));
      });
    }
    checkSharedMember(definition, owner, shared, syntax) {
      const result = typeOf(definition.returnType),
        display = `'${owner.toDisplayString()}.${definition.name}'`;
      if (result instanceof ArrayTypeSymbol && shared.includes(result.elementType)) {
        return this.unsupported(`${display} (the framework registry has no contract that returns an array of this element type)`, syntax);
      }
      if (orderingMembers.has(definition.name)) {
        return this.unsupported(`${display} (the framework registry has no comparer contract for this element type)`, syntax);
      }
      return null;
    }
    /** A value a shared contract yields as `object`, read through a temporary of the type the program gives it. */
    typedResult(value, type) {
      if (type === 'object' || type === 'void') return value;
      const result = this.temp(type, 'element');
      return n.sequence([result], [n.assign(n.local(result), value)], n.local(result));
    }
    /** A property or indexer whose accessors are the contracts of the closed containing type. */
    closedAccessors(property, syntax) {
      if (!isOpen(property.getMethod) && !isOpen(property.setMethod)) return null;
      const get = property.getMethod ? this.closedFrameworkMember(property.getMethod, syntax) : null,
        set = property.setMethod ? this.closedFrameworkMember(property.setMethod, syntax) : null;
      return {
        property: Object.create(property, { getMethod: { value: get?.member ?? null }, setMethod: { value: set?.member ?? null } }),
        shared: !!get?.shared,
      };
    }
    frameworkInvocation(node, method) {
      const closed = this.closedFrameworkMember(method, node.syntax);
      if (!closed) return super.frameworkInvocation(node, method);
      const call = super.frameworkInvocation(node, closed.member);
      return closed.shared ? this.typedResult(call, call.legacyType) : call;
    }
    memberCall(method, receiver, args, syntax) {
      const closed = this.closedFrameworkMember(method, syntax);
      if (!closed) return super.memberCall(method, receiver, args, syntax);
      const call = n.frameworkCall(closed.member, receiver, args, this.imageType(method.returnType, syntax));
      return closed.shared ? this.typedResult(call, call.legacyType) : call;
    }
    frameworkCreation(node) {
      const closed = this.closedFrameworkMember(node.constructor, node.syntax);
      return super.frameworkCreation(closed ? { ...node, constructor: closed.member } : node);
    }
    propertyReference(node) {
      const closed = node.property && !this.g.isSource(node.property) ? this.closedAccessors(node.property, node.syntax) : null;
      return super.propertyReference(closed ? { ...node, property: closed.property } : node);
    }
    exprPropertyAccess(node) {
      const value = super.exprPropertyAccess(node),
        property = node.property;
      if (!property || this.g.isSource(property) || !this.closedAccessors(property, node.syntax)?.shared) return value;
      return this.typedResult(value, value.legacyType);
    }
    indexerReference(node) {
      const closed = this.closedAccessors(node.property, node.syntax);
      return super.indexerReference(closed ? { ...node, property: closed.property } : node);
    }
    exprIndexerAccess(node) {
      const value = super.exprIndexerAccess(node),
        property = node.property;
      if (this.g.isSource(property) || !this.closedAccessors(property, node.syntax)?.shared) return value;
      return this.typedResult(value, value.legacyType);
    }
    /** True for a member of a framework generic that the registry instantiation of its closed containing type executes. */
    isFrameworkGenericMember(member) {
      return isOpen(member);
    }
  };
