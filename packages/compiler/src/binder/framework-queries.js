/**
 * Framework member queries of the method-body binder (SF-A02-T19): receivers, properties, indexers, calls,
 * constructors and method-group conversions to framework delegates.
 *
 * Members are found as symbols and overloads are chosen by overload resolution (./framework-members.js). The
 * queries hand the registry contract of the selected symbol to the binder, which still describes types with the
 * legacy type names. The diagnostics are those of the string-typed profile (CS0121, CS1501, CS1729, CS1921,
 * CS0123), so the bound pipeline and the legacy compiler keep reporting the same errors.
 *
 * All queries are side-effect free unless `report` is passed.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { canonicalType, frameworkType, frameworkAssignable, enumValue } from '@sharpforge/framework';
import { Conversion, ConversionKind } from '../conversions/classify.js';
import { typeText } from '../type-utils.js';
import { memberPath as pathOf } from './member-path.js';

const valueKeywords = ['int', 'double', 'bool', 'void'];
const collectionFamilies = ['List', 'HashSet'];
const methodGroupConversion = new Conversion(ConversionKind.MethodGroup);
const objectCreationConversion = new Conversion(ConversionKind.ObjectCreation);
const collectionConversion = new Conversion(ConversionKind.CollectionExpression);

const isTargetTypedNew = node => node?.kind === 'New' && node.type === '<target>';
const contractOf = symbol => symbol?.contract;

export const FrameworkQueries = Base =>
  class FrameworkQueries extends Base {
    get framework() {
      return this.sym.framework;
    }

    /** Whether a target-typed expression (`new()`, a collection expression) can take the legacy type `type`. */
    canTarget(node, type) {
      if (isTargetTypedNew(node)) return type !== 'object';
      if (node?.kind !== 'CollectionExpression') return false;
      return !!type?.endsWith('[]') || collectionFamilies.includes(frameworkType(type)?.family);
    }

    /** The framework type a member access is made on: `{type, isStatic, node}` or null. */
    frameworkReceiver(node) {
      if (node?.kind !== 'Member') return null;
      const path = pathOf(node.target),
        staticType = path && !this.c.findType(path, this.m) && frameworkType(path === 'string' ? 'System.String' : path);
      if (staticType) return { type: staticType.name, isStatic: true, node: null };
      const inferred = this.infer(node.target),
        type = frameworkType(inferred === 'string' ? 'System.String' : canonicalType(inferred));
      return type ? { type: type.name, isStatic: false, node: node.target } : null;
    }

    /** The contract of the nearest method called `name` on a framework type, or undefined. */
    frameworkMethod(owner, name, isStatic) {
      return contractOf(this.framework.method(owner, name, isStatic));
    }

    /** The accessors of the indexer of a framework type: `{get, set}` contracts, or null. */
    frameworkIndexer(owner) {
      const indexer = this.framework.indexer(owner);
      return indexer ? { get: contractOf(indexer.getter), set: contractOf(indexer.setter) } : null;
    }

    frameworkProperty(node) {
      const receiver = this.frameworkReceiver(node);
      if (!receiver) return null;
      const property = this.framework.property(receiver.type, node.name, receiver.isStatic);
      if (!property) return null;
      const get = contractOf(property.getter),
        set = contractOf(property.setter);
      return { receiver, get, set, type: get?.result ?? set.parameters[0] };
    }

    /** The string-typed profile's conversion between a user method's signature and a framework delegate's. */
    frameworkConversion(target, source) {
      if (target === source || (target === 'double' && source === 'int')) return true;
      if (source === 'null' && !valueKeywords.includes(target)) return true;
      return frameworkAssignable(target, source);
    }

    /** The user methods a method group names, with the receiver expression of an instance group. */
    methodGroup(target) {
      if (target.kind === 'Name') {
        const visible = m => (m.owner === this.m.owner || !m.owner) && (!this.m.isStatic || m.isStatic);
        return { methods: this.c.methodIndex.named(target.name).filter(visible), receiver: null };
      }
      if (target.kind !== 'Member') return { methods: [], receiver: null };
      const owner = this.c.findType(pathOf(target.target), this.m);
      if (owner) return { methods: owner.methods.filter(m => m.isStatic && m.name === target.name), receiver: null };
      const receiver = target.target,
        type = this.c.findType(this.infer(receiver), this.m);
      return { methods: type?.methods.filter(m => !m.isStatic && m.name === target.name) ?? [], receiver };
    }

    /** The single user method a method group converts to for a framework delegate type, or null (CS0123 when `report`). */
    delegateMethod(node, type, report = false) {
      const signature = frameworkType(type);
      if (signature?.kind !== 'delegate') return null;
      const target = node.kind === 'New' && node.args.length === 1 ? node.args[0] : node,
        group = this.methodGroup(target);
      const returns = m =>
        signature.result === m.returnType || (!valueKeywords.includes(m.returnType) && frameworkAssignable(signature.result, m.returnType));
      let methods = group.methods.filter(
        m =>
          m.parameters.length === signature.parameters.length &&
          m.parameters.every((p, i) => this.frameworkConversion(p.type, signature.parameters[i])) &&
          returns(m),
      );
      const exact = methods.filter(m => m.returnType === signature.result);
      if (exact.length === 1) methods = exact;
      if (methods.length !== 1) {
        if (report) this.c.report(node, DiagnosticId.CS0123, [target.name ?? '<expression>', typeText(type)]);
        return null;
      }
      return { method: methods[0], receiver: group.receiver, node: target };
    }

    /**
     * An argument as overload resolution sees it. Target-typed expressions and method groups have no type of their
     * own; their `convert` decides per parameter type.
     */
    frameworkArgument(node, targetTyped = true) {
      const legacyType = this.infer(node);
      if (legacyType === 'null') return { literal: 'null', type: null };
      const type = this.type(legacyType);
      if (!targetTyped || (legacyType !== 'error' && node.kind !== 'New' && node.kind !== 'CollectionExpression')) return { type };
      const typed = { type },
        conversions = this.framework.conversions;
      const convert = to => {
        const natural = conversions.classifyFromExpression(typed, to);
        if (natural.exists) return natural;
        const target = this.framework.bridge.registryName(to) ?? this.sym.nameOf(to);
        if (this.canTarget(node, target)) return isTargetTypedNew(node) ? objectCreationConversion : collectionConversion;
        return this.delegateMethod(node, target) ? methodGroupConversion : null;
      };
      const form = isTargetTypedNew(node) ? 'implicitNew' : node.kind === 'CollectionExpression' ? 'collection' : 'methodGroup';
      return { type, form, convert };
    }

    /** True when every delegate parameter of the candidate gets a method whose return type is the delegate's. */
    bindsDelegatesExactly(method, args) {
      const parameters = method.contract.parameters;
      if (parameters.length !== args.length) return false;
      return parameters.every((type, i) => {
        const signature = frameworkType(type);
        return signature?.kind !== 'delegate' || this.delegateMethod(args[i], type)?.method.returnType === signature.result;
      });
    }

    /** Overload selection among framework methods; reports CS0121/CS1501 when `report` is set. */
    frameworkCall(node, report = false) {
      const receiver = this.frameworkReceiver(node.target);
      if (!receiver) return null;
      const name = node.target.name,
        candidates = this.framework.methods(receiver.type, name, receiver.isStatic),
        args = node.args.map(arg => this.frameworkArgument(arg));
      // Candidates whose delegate parameters match the method groups' return types exactly are preferred as a set.
      const exact = this.framework.hasDelegateParameters(candidates) ? candidates.filter(m => this.bindsDelegatesExactly(m, node.args)) : candidates;
      let result = exact.length && exact.length < candidates.length ? this.framework.resolve(exact, args, { name }) : null;
      if (!result || (!result.succeeded && result.error.code !== DiagnosticId.CS0121)) result = this.framework.resolve(candidates, args, { name });
      if (result.succeeded) return { receiver, contract: result.method.contract };
      if (!report) return null;
      if (result.error.code === DiagnosticId.CS0121) {
        const [first, second] = result.ambiguous.map(m => typeText(m.contract.owner) + '.' + m.contract.name);
        this.c.report(node, DiagnosticId.CS0121, [first, second]);
      } else {
        // Roslyn reports the argument count on the member name, not on the whole invocation.
        const nameSpan = node.target.nameSpan;
        this.c.report(nameSpan ? { uri: node.uri, ...nameSpan } : node, DiagnosticId.CS1501, [name, args.length]);
      }
      return null;
    }

    /** The constructor of a framework type for an object creation, or null (CS1729 unless exactly one is applicable). */
    frameworkConstructor(typeName, node) {
      const args = node.args.map(arg => this.frameworkArgument(arg)),
        result = this.framework.resolve(this.framework.constructors(typeName), args, { name: '.ctor', isConstructor: true });
      return result.succeeded ? result.method.contract : null;
    }

    /** The Add method of a framework collection for one collection-initializer element, or null. */
    frameworkAdd(typeName, values) {
      const args = values.map(value => this.frameworkArgument(value, false)),
        result = this.framework.resolve(this.framework.methods(typeName, 'Add', false), args, { name: 'Add' });
      return result.succeeded ? result.method.contract : null;
    }

    /** The static framework method whose first parameter type is exactly the type of the first operand. */
    frameworkExactMethod(owner, name, legacyTypes) {
      return contractOf(this.framework.exactStaticMethod(owner, name, legacyTypes.map(type => this.type(type)))) ?? undefined;
    }

    /** The type of a framework expression, or undefined when the expression is not a framework one. */
    frameworkInfer(node) {
      switch (node.kind) {
        case 'Index':
          return this.frameworkMethod(this.infer(node.target), 'get_Item', false)?.result;
        case 'Member':
          return enumValue(pathOf(node))?.type ?? this.frameworkProperty(node)?.type;
        case 'New':
          return this.c.findType(node.type, this.m) ? undefined : frameworkType(node.type)?.name;
        case 'Call':
          return this.frameworkCall(node)?.contract.result;
        default:
          return undefined;
      }
    }
  };
